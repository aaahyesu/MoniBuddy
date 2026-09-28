import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type Client } from "@libsql/client";
import type { Character, FriendGroup, FriendInfo } from "@monibuddy/shared";
import { createFriendCode } from "@monibuddy/shared";

export type StoredUser = {
  userId: string;
  friendCode: string;
  nickname: string;
  character: Character;
  /** 친구 userId 목록 */
  friends: string[];
};

type Presence = {
  userId: string;
  socketId: string;
  nickname: string;
  character: Character;
  friendCode: string;
};

type StoreFile = {
  users: Record<string, StoredUser>;
  codes: Record<string, string>;
};

function newGroupId() {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 친구 관계 영구 저장.
 * - TURSO_DATABASE_URL(+ AUTH_TOKEN) → Turso 원격 DB
 * - 없으면 로컬 file:DATA_DIR/friends.db (개발용)
 * presence(온라인)는 메모리 전용.
 */
export class FriendStore {
  private db: Client;
  private dataDir: string;
  private backend: "turso" | "local-file";
  private presence = new Map<string, Presence>();
  private socketToUser = new Map<string, string>();

  private constructor(db: Client, dataDir: string, backend: "turso" | "local-file") {
    this.db = db;
    this.dataDir = dataDir;
    this.backend = backend;
  }

  static async create(dataDir: string): Promise<FriendStore> {
    fs.mkdirSync(dataDir, { recursive: true });
    const tursoUrl = (process.env.TURSO_DATABASE_URL || "").trim();
    const authToken = (process.env.TURSO_AUTH_TOKEN || "").trim();

    let db: Client;
    let backend: "turso" | "local-file";
    if (tursoUrl) {
      db = createClient({
        url: tursoUrl,
        authToken: authToken || undefined,
      });
      backend = "turso";
    } else {
      const filePath = path.join(dataDir, "friends.db");
      db = createClient({ url: pathToFileURL(filePath).href });
      backend = "local-file";
    }

    const store = new FriendStore(db, dataDir, backend);
    await store.initSchema();
    await store.migrateFromJsonIfNeeded();
    console.log(`[friends] storage=${backend}${backend === "turso" ? ` (${tursoUrl})` : ` (${dataDir}/friends.db)`}`);
    return store;
  }

  get backendName() {
    return this.backend;
  }

  private async initSchema() {
    await this.db.batch(
      [
        `CREATE TABLE IF NOT EXISTS users (
          user_id TEXT PRIMARY KEY NOT NULL,
          friend_code TEXT NOT NULL UNIQUE,
          nickname TEXT NOT NULL,
          character_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS friendships (
          user_id TEXT NOT NULL,
          friend_id TEXT NOT NULL,
          PRIMARY KEY (user_id, friend_id)
        )`,
        `CREATE TABLE IF NOT EXISTS friend_groups (
          id TEXT PRIMARY KEY NOT NULL,
          owner_id TEXT NOT NULL,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS friend_group_members (
          owner_id TEXT NOT NULL,
          friend_id TEXT NOT NULL,
          group_id TEXT NOT NULL,
          PRIMARY KEY (owner_id, friend_id, group_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_users_friend_code ON users(friend_code)`,
        `CREATE INDEX IF NOT EXISTS idx_friend_groups_owner ON friend_groups(owner_id)`,
        `CREATE INDEX IF NOT EXISTS idx_fgm_owner_friend ON friend_group_members(owner_id, friend_id)`,
      ],
      "write",
    );
    await this.migrateLegacyFriendshipGroupId();
  }

  /** friendships.group_id(단일) → friend_group_members(다대다) 1회 이전 */
  private async migrateLegacyFriendshipGroupId() {
    const info = await this.db.execute(`PRAGMA table_info(friendships)`);
    const hasGroup = info.rows.some(
      (r) => String((r as Record<string, unknown>).name ?? r[1] ?? "") === "group_id",
    );
    if (!hasGroup) return;

    await this.db.execute({
      sql: `INSERT OR IGNORE INTO friend_group_members (owner_id, friend_id, group_id)
            SELECT user_id, friend_id, group_id
            FROM friendships
            WHERE group_id IS NOT NULL AND group_id != ''`,
      args: [],
    });
    // 레거시 컬럼은 남겨 두되 더 이상 쓰지 않음 (SQLite DROP COLUMN 미지원 환경 대비)
  }

  /** 예전 friends.json → SQLite 1회 이전 */
  private async migrateFromJsonIfNeeded() {
    const jsonPath = path.join(this.dataDir, "friends.json");
    if (!fs.existsSync(jsonPath)) return;
    const count = await this.db.execute("SELECT COUNT(*) AS c FROM users");
    const n = Number(count.rows[0]?.c ?? 0);
    if (n > 0) return;

    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as StoreFile;
      const users = Object.values(raw.users ?? {});
      if (users.length === 0) return;

      const stmts: { sql: string; args: (string | number)[] }[] = [];
      for (const u of users) {
        stmts.push({
          sql: `INSERT OR IGNORE INTO users (user_id, friend_code, nickname, character_json, updated_at)
                VALUES (?, ?, ?, ?, ?)`,
          args: [
            u.userId,
            u.friendCode,
            u.nickname,
            JSON.stringify(u.character),
            Date.now(),
          ],
        });
        for (const fid of u.friends ?? []) {
          stmts.push({
            sql: `INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)`,
            args: [u.userId, fid],
          });
        }
      }
      if (stmts.length) await this.db.batch(stmts, "write");
      console.log(`[friends] migrated ${users.length} users from friends.json`);
    } catch (err) {
      console.warn("[friends] json migrate skipped:", err);
    }
  }

  private parseUser(
    row: Record<string, unknown>,
    friendIds: string[] = [],
  ): StoredUser {
    let character: Character;
    try {
      character = JSON.parse(String(row.character_json)) as Character;
    } catch {
      character = {
        kind: "buddy",
        id: "ank_dance",
        displaySize: 80,
        stage: 0,
        scale: 0.55,
      };
    }
    return {
      userId: String(row.user_id),
      friendCode: String(row.friend_code),
      nickname: String(row.nickname),
      character,
      friends: friendIds,
    };
  }

  private async friendIdsOf(userId: string): Promise<string[]> {
    const rs = await this.db.execute({
      sql: `SELECT friend_id FROM friendships WHERE user_id = ?`,
      args: [userId],
    });
    return rs.rows.map((r) => String(r.friend_id));
  }

  private async ensureUniqueCode(prefer?: string): Promise<string> {
    const want = (prefer || "").trim().toUpperCase();
    if (want) {
      const hit = await this.db.execute({
        sql: `SELECT user_id FROM users WHERE friend_code = ?`,
        args: [want],
      });
      if (hit.rows.length === 0) return want;
    }
    for (let i = 0; i < 40; i++) {
      const code = createFriendCode();
      const hit = await this.db.execute({
        sql: `SELECT user_id FROM users WHERE friend_code = ?`,
        args: [code],
      });
      if (hit.rows.length === 0) return code;
    }
    return createFriendCode() + createFriendCode().slice(0, 2);
  }

  async upsertUser(input: {
    userId: string;
    friendCode?: string;
    nickname: string;
    character: Character;
  }): Promise<StoredUser> {
    const nickname = input.nickname.trim().slice(0, 16) || "Guest";
    const characterJson = JSON.stringify(input.character);
    const now = Date.now();
    const requestedCode = (input.friendCode || "").trim().toUpperCase();

    // 1) 같은 userId로 이미 등록된 계정 → 프로필만 갱신, 친구 관계 유지
    const existingById = await this.getUser(input.userId);
    if (existingById) {
      let friendCode = existingById.friendCode;
      if (
        requestedCode &&
        requestedCode !== existingById.friendCode
      ) {
        const owner = await this.db.execute({
          sql: `SELECT user_id FROM users WHERE friend_code = ?`,
          args: [requestedCode],
        });
        const ownerId = owner.rows[0] ? String(owner.rows[0].user_id) : null;
        if (!ownerId || ownerId === input.userId) {
          friendCode = requestedCode;
        }
      }
      await this.db.execute({
        sql: `UPDATE users SET friend_code = ?, nickname = ?, character_json = ?, updated_at = ?
              WHERE user_id = ?`,
        args: [friendCode, nickname, characterJson, now, input.userId],
      });
      const friends = await this.friendIdsOf(input.userId);
      return {
        userId: input.userId,
        friendCode,
        nickname,
        character: input.character,
        friends,
      };
    }

    // 2) userId는 새것인데 friendCode가 기존 계정이면 → 그 계정으로 복구 (친구 목록 유지)
    if (requestedCode) {
      const byCode = await this.getUserByFriendCode(requestedCode);
      if (byCode) {
        await this.db.execute({
          sql: `UPDATE users SET nickname = ?, character_json = ?, updated_at = ?
                WHERE user_id = ?`,
          args: [nickname, characterJson, now, byCode.userId],
        });
        const friends = await this.friendIdsOf(byCode.userId);
        return {
          userId: byCode.userId,
          friendCode: byCode.friendCode,
          nickname,
          character: input.character,
          friends,
        };
      }
    }

    // 3) 완전 신규 계정
    const friendCode = await this.ensureUniqueCode(requestedCode || undefined);
    await this.db.execute({
      sql: `INSERT INTO users (user_id, friend_code, nickname, character_json, updated_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [input.userId, friendCode, nickname, characterJson, now],
    });
    return {
      userId: input.userId,
      friendCode,
      nickname,
      character: input.character,
      friends: [],
    };
  }

  setOnline(socketId: string, user: StoredUser) {
    const prevUser = this.socketToUser.get(socketId);
    if (prevUser && prevUser !== user.userId) {
      this.setOfflineBySocket(socketId);
    }
    const existing = this.presence.get(user.userId);
    if (existing && existing.socketId !== socketId) {
      this.socketToUser.delete(existing.socketId);
    }
    this.presence.set(user.userId, {
      userId: user.userId,
      socketId,
      nickname: user.nickname,
      character: user.character,
      friendCode: user.friendCode,
    });
    this.socketToUser.set(socketId, user.userId);
  }

  setOfflineBySocket(socketId: string): string | null {
    const userId = this.socketToUser.get(socketId);
    if (!userId) return null;
    this.socketToUser.delete(socketId);
    const live = this.presence.get(userId);
    if (live && live.socketId === socketId) {
      this.presence.delete(userId);
      return userId;
    }
    return null;
  }

  getUserIdBySocket(socketId: string): string | null {
    return this.socketToUser.get(socketId) ?? null;
  }

  getPresence(userId: string): Presence | undefined {
    return this.presence.get(userId);
  }

  async getUser(userId: string): Promise<StoredUser | undefined> {
    const rs = await this.db.execute({
      sql: `SELECT user_id, friend_code, nickname, character_json FROM users WHERE user_id = ?`,
      args: [userId],
    });
    const row = rs.rows[0];
    if (!row) return undefined;
    const friends = await this.friendIdsOf(userId);
    return this.parseUser(row as unknown as Record<string, unknown>, friends);
  }

  async getUserByFriendCode(code: string): Promise<StoredUser | undefined> {
    const rs = await this.db.execute({
      sql: `SELECT user_id, friend_code, nickname, character_json FROM users WHERE friend_code = ?`,
      args: [code.trim().toUpperCase()],
    });
    const row = rs.rows[0];
    if (!row) return undefined;
    const userId = String(row.user_id);
    const friends = await this.friendIdsOf(userId);
    return this.parseUser(row as unknown as Record<string, unknown>, friends);
  }

  async listGroups(ownerId: string): Promise<FriendGroup[]> {
    const rs = await this.db.execute({
      sql: `SELECT id, name, sort_order FROM friend_groups
            WHERE owner_id = ?
            ORDER BY sort_order ASC, name ASC`,
      args: [ownerId],
    });
    return rs.rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        id: String(row.id),
        name: String(row.name),
        sortOrder: Number(row.sort_order ?? 0),
      };
    });
  }

  async listFriends(userId: string): Promise<FriendInfo[]> {
    const rs = await this.db.execute({
      sql: `SELECT u.user_id, u.friend_code, u.nickname, u.character_json
            FROM friendships f
            JOIN users u ON u.user_id = f.friend_id
            WHERE f.user_id = ?`,
      args: [userId],
    });
    const mem = await this.db.execute({
      sql: `SELECT friend_id, group_id FROM friend_group_members WHERE owner_id = ?`,
      args: [userId],
    });
    const groupMap = new Map<string, string[]>();
    for (const raw of mem.rows) {
      const row = raw as Record<string, unknown>;
      const fid = String(row.friend_id);
      const gid = String(row.group_id);
      const list = groupMap.get(fid) ?? [];
      list.push(gid);
      groupMap.set(fid, list);
    }

    const out: FriendInfo[] = [];
    for (const raw of rs.rows) {
      const row = raw as Record<string, unknown>;
      const id = String(row.user_id ?? row["u.user_id"] ?? "");
      if (!id) continue;
      const friend = this.parseUser(
        {
          user_id: id,
          friend_code: row.friend_code ?? row["u.friend_code"],
          nickname: row.nickname ?? row["u.nickname"],
          character_json: row.character_json ?? row["u.character_json"],
        },
      );
      const live = this.presence.get(friend.userId);
      out.push({
        userId: friend.userId,
        friendCode: friend.friendCode,
        nickname: live?.nickname ?? friend.nickname,
        character: live?.character ?? friend.character,
        online: this.presence.has(friend.userId),
        groupIds: groupMap.get(friend.userId) ?? [],
      });
    }
    return out;
  }

  private async friendBundle(userId: string): Promise<{
    friends: FriendInfo[];
    groups: FriendGroup[];
  }> {
    const [friends, groups] = await Promise.all([
      this.listFriends(userId),
      this.listGroups(userId),
    ]);
    return { friends, groups };
  }

  async addFriend(
    myUserId: string,
    friendCode: string,
  ): Promise<
    | { ok: true; friends: FriendInfo[]; groups: FriendGroup[] }
    | { ok: false; error: string }
  > {
    const me = await this.getUser(myUserId);
    if (!me) return { ok: false, error: "not registered" };
    const other = await this.getUserByFriendCode(friendCode);
    if (!other) return { ok: false, error: "friend code not found" };
    if (other.userId === myUserId) return { ok: false, error: "cannot add yourself" };

    await this.db.batch(
      [
        {
          sql: `INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)`,
          args: [myUserId, other.userId],
        },
        {
          sql: `INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)`,
          args: [other.userId, myUserId],
        },
      ],
      "write",
    );
    return { ok: true, ...(await this.friendBundle(myUserId)) };
  }

  async removeFriend(
    myUserId: string,
    friendUserId: string,
  ): Promise<
    | { ok: true; friends: FriendInfo[]; groups: FriendGroup[] }
    | { ok: false; error: string }
  > {
    const me = await this.getUser(myUserId);
    if (!me) return { ok: false, error: "not registered" };

    await this.db.batch(
      [
        {
          sql: `DELETE FROM friendships WHERE user_id = ? AND friend_id = ?`,
          args: [myUserId, friendUserId],
        },
        {
          sql: `DELETE FROM friendships WHERE user_id = ? AND friend_id = ?`,
          args: [friendUserId, myUserId],
        },
        {
          sql: `DELETE FROM friend_group_members WHERE owner_id = ? AND friend_id = ?`,
          args: [myUserId, friendUserId],
        },
        {
          sql: `DELETE FROM friend_group_members WHERE owner_id = ? AND friend_id = ?`,
          args: [friendUserId, myUserId],
        },
      ],
      "write",
    );
    return { ok: true, ...(await this.friendBundle(myUserId)) };
  }

  async createGroup(
    ownerId: string,
    name: string,
  ): Promise<
    | { ok: true; friends: FriendInfo[]; groups: FriendGroup[] }
    | { ok: false; error: string }
  > {
    const me = await this.getUser(ownerId);
    if (!me) return { ok: false, error: "not registered" };
    const trimmed = name.trim().slice(0, 24);
    if (!trimmed) return { ok: false, error: "name required" };

    const existing = await this.listGroups(ownerId);
    const id = newGroupId();
    const sortOrder =
      existing.length === 0
        ? 0
        : Math.max(...existing.map((g) => g.sortOrder)) + 1;
    await this.db.execute({
      sql: `INSERT INTO friend_groups (id, owner_id, name, sort_order) VALUES (?, ?, ?, ?)`,
      args: [id, ownerId, trimmed, sortOrder],
    });
    return { ok: true, ...(await this.friendBundle(ownerId)) };
  }

  async renameGroup(
    ownerId: string,
    groupId: string,
    name: string,
  ): Promise<
    | { ok: true; friends: FriendInfo[]; groups: FriendGroup[] }
    | { ok: false; error: string }
  > {
    const me = await this.getUser(ownerId);
    if (!me) return { ok: false, error: "not registered" };
    const trimmed = name.trim().slice(0, 24);
    if (!trimmed) return { ok: false, error: "name required" };

    const rs = await this.db.execute({
      sql: `UPDATE friend_groups SET name = ? WHERE id = ? AND owner_id = ?`,
      args: [trimmed, groupId, ownerId],
    });
    if (rs.rowsAffected === 0) return { ok: false, error: "group not found" };
    return { ok: true, ...(await this.friendBundle(ownerId)) };
  }

  async deleteGroup(
    ownerId: string,
    groupId: string,
  ): Promise<
    | { ok: true; friends: FriendInfo[]; groups: FriendGroup[] }
    | { ok: false; error: string }
  > {
    const me = await this.getUser(ownerId);
    if (!me) return { ok: false, error: "not registered" };

    await this.db.batch(
      [
        {
          sql: `DELETE FROM friend_group_members WHERE owner_id = ? AND group_id = ?`,
          args: [ownerId, groupId],
        },
        {
          sql: `DELETE FROM friend_groups WHERE id = ? AND owner_id = ?`,
          args: [groupId, ownerId],
        },
      ],
      "write",
    );
    return { ok: true, ...(await this.friendBundle(ownerId)) };
  }

  async assignGroups(
    ownerId: string,
    friendUserId: string,
    groupIds: string[],
  ): Promise<
    | { ok: true; friends: FriendInfo[]; groups: FriendGroup[] }
    | { ok: false; error: string }
  > {
    const me = await this.getUser(ownerId);
    if (!me) return { ok: false, error: "not registered" };

    const edge = await this.db.execute({
      sql: `SELECT friend_id FROM friendships WHERE user_id = ? AND friend_id = ?`,
      args: [ownerId, friendUserId],
    });
    if (edge.rows.length === 0) return { ok: false, error: "not a friend" };

    const unique = [...new Set(groupIds.map((id) => String(id).trim()).filter(Boolean))];
    if (unique.length > 0) {
      const owned = await this.listGroups(ownerId);
      const ownedSet = new Set(owned.map((g) => g.id));
      for (const gid of unique) {
        if (!ownedSet.has(gid)) return { ok: false, error: "group not found" };
      }
    }

    const stmts: { sql: string; args: (string | number | null)[] }[] = [
      {
        sql: `DELETE FROM friend_group_members WHERE owner_id = ? AND friend_id = ?`,
        args: [ownerId, friendUserId],
      },
    ];
    for (const gid of unique) {
      stmts.push({
        sql: `INSERT OR IGNORE INTO friend_group_members (owner_id, friend_id, group_id)
              VALUES (?, ?, ?)`,
        args: [ownerId, friendUserId, gid],
      });
    }
    await this.db.batch(stmts, "write");
    return { ok: true, ...(await this.friendBundle(ownerId)) };
  }

  /** 내 친구들의 소켓 ID (온라인만) */
  async friendSocketIdsFor(userId: string): Promise<string[]> {
    const ids = await this.friendIdsOf(userId);
    const out: string[] = [];
    for (const fid of ids) {
      const p = this.presence.get(fid);
      if (p) out.push(p.socketId);
    }
    return out;
  }
}
