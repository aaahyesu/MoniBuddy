import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type Client } from "@libsql/client";
import type { Character, FriendInfo } from "@monibuddy/shared";
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
        `CREATE INDEX IF NOT EXISTS idx_users_friend_code ON users(friend_code)`,
      ],
      "write",
    );
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
    const existing = await this.getUser(input.userId);
    let friendCode = (input.friendCode || existing?.friendCode || "")
      .trim()
      .toUpperCase();

    if (friendCode) {
      const owner = await this.db.execute({
        sql: `SELECT user_id FROM users WHERE friend_code = ?`,
        args: [friendCode],
      });
      const ownerId = owner.rows[0] ? String(owner.rows[0].user_id) : null;
      if (ownerId && ownerId !== input.userId) {
        friendCode = await this.ensureUniqueCode();
      }
    } else {
      friendCode = await this.ensureUniqueCode();
    }

    const nickname = input.nickname.trim().slice(0, 16) || "Guest";
    const characterJson = JSON.stringify(input.character);
    const now = Date.now();

    await this.db.execute({
      sql: `INSERT INTO users (user_id, friend_code, nickname, character_json, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              friend_code = excluded.friend_code,
              nickname = excluded.nickname,
              character_json = excluded.character_json,
              updated_at = excluded.updated_at`,
      args: [input.userId, friendCode, nickname, characterJson, now],
    });

    const friends = existing?.friends ?? (await this.friendIdsOf(input.userId));
    return {
      userId: input.userId,
      friendCode,
      nickname,
      character: input.character,
      friends,
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

  async listFriends(userId: string): Promise<FriendInfo[]> {
    const rs = await this.db.execute({
      sql: `SELECT u.user_id, u.friend_code, u.nickname, u.character_json
            FROM friendships f
            JOIN users u ON u.user_id = f.friend_id
            WHERE f.user_id = ?`,
      args: [userId],
    });
    return rs.rows.map((row) => {
      const friend = this.parseUser(row as unknown as Record<string, unknown>);
      const live = this.presence.get(friend.userId);
      return {
        userId: friend.userId,
        friendCode: friend.friendCode,
        nickname: live?.nickname ?? friend.nickname,
        character: live?.character ?? friend.character,
        online: this.presence.has(friend.userId),
      } satisfies FriendInfo;
    });
  }

  async addFriend(
    myUserId: string,
    friendCode: string,
  ): Promise<{ ok: true; friends: FriendInfo[] } | { ok: false; error: string }> {
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
    return { ok: true, friends: await this.listFriends(myUserId) };
  }

  async removeFriend(
    myUserId: string,
    friendUserId: string,
  ): Promise<{ ok: true; friends: FriendInfo[] } | { ok: false; error: string }> {
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
      ],
      "write",
    );
    return { ok: true, friends: await this.listFriends(myUserId) };
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
