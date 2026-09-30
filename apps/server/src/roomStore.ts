import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type Client, type InStatement } from "@libsql/client";
import {
  type CharState,
  type Character,
  type Member,
  defaultCharState,
} from "@monibuddy/shared";

/**
 * 방·멤버 영구 저장. 서버 프로세스가 바뀌어도 같은 코드로 다시 들어올 수 있게 함.
 * 친구 저장과 같은 Turso(또는 로컬 sqlite)를 쓴다.
 */
export class RoomStore {
  private constructor(private db: Client) {}

  static async create(dataDir: string): Promise<RoomStore> {
    fs.mkdirSync(dataDir, { recursive: true });
    const tursoUrl = (process.env.TURSO_DATABASE_URL || "").trim();
    const authToken = (process.env.TURSO_AUTH_TOKEN || "").trim();
    const db = tursoUrl
      ? createClient({ url: tursoUrl, authToken: authToken || undefined })
      : createClient({
          url: pathToFileURL(path.join(dataDir, "friends.db")).href,
        });
    const store = new RoomStore(db);
    await store.initSchema();
    return store;
  }

  private async initSchema() {
    await this.db.batch(
      [
        `CREATE TABLE IF NOT EXISTS rooms (
          code TEXT PRIMARY KEY NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS room_members (
          room_code TEXT NOT NULL,
          member_id TEXT NOT NULL,
          nickname TEXT NOT NULL,
          character_json TEXT NOT NULL,
          state_json TEXT NOT NULL,
          offset INTEGER NOT NULL,
          status_message TEXT,
          PRIMARY KEY (room_code, member_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_code)`,
      ],
      "write",
    );
  }

  async saveRoom(code: string, members: Member[]): Promise<void> {
    const stmts: InStatement[] = [
      {
        sql: `INSERT INTO rooms (code, updated_at) VALUES (?, ?)
              ON CONFLICT(code) DO UPDATE SET updated_at = excluded.updated_at`,
        args: [code, Date.now()],
      },
      {
        sql: `DELETE FROM room_members WHERE room_code = ?`,
        args: [code],
      },
    ];
    for (const member of members) {
      stmts.push({
        sql: `INSERT INTO room_members (
                room_code, member_id, nickname, character_json, state_json, offset, status_message
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          code,
          member.id,
          member.nickname,
          JSON.stringify(member.character),
          JSON.stringify(member.state),
          member.offset,
          member.statusMessage ?? "",
        ],
      });
    }
    await this.db.batch(stmts, "write");
  }

  async deleteRoom(code: string): Promise<void> {
    await this.db.batch(
      [
        { sql: `DELETE FROM room_members WHERE room_code = ?`, args: [code] },
        { sql: `DELETE FROM rooms WHERE code = ?`, args: [code] },
      ],
      "write",
    );
  }

  async loadRooms(): Promise<{ code: string; members: Member[] }[]> {
    const rs = await this.db.execute(
      `SELECT r.code AS code,
              m.member_id AS member_id,
              m.nickname AS nickname,
              m.character_json AS character_json,
              m.state_json AS state_json,
              m.offset AS offset,
              m.status_message AS status_message
       FROM rooms r
       LEFT JOIN room_members m ON m.room_code = r.code`,
    );
    const byCode = new Map<string, Member[]>();
    for (const raw of rs.rows) {
      const row = raw as Record<string, unknown>;
      const code = String(row.code ?? "").trim().toUpperCase();
      if (!code) continue;
      if (!byCode.has(code)) byCode.set(code, []);
      const memberId = String(row.member_id ?? "").trim();
      if (!memberId) continue;
      const character = parseCharacter(row.character_json);
      if (!character) continue;
      const status = String(row.status_message ?? "").trim();
      byCode.get(code)!.push({
        id: memberId,
        nickname: String(row.nickname ?? "").slice(0, 16) || "친구",
        character,
        state: parseState(row.state_json),
        offset: Number(row.offset ?? 8) || 8,
        ...(status ? { statusMessage: status.slice(0, 40) } : {}),
      });
    }
    return [...byCode.entries()].map(([code, members]) => ({ code, members }));
  }
}

function parseCharacter(raw: unknown): Character | null {
  try {
    const value = JSON.parse(String(raw ?? "")) as Character;
    if (!value || typeof value !== "object" || !("kind" in value)) return null;
    return value;
  } catch {
    return null;
  }
}

function parseState(raw: unknown): CharState {
  try {
    const value = JSON.parse(String(raw ?? "")) as CharState;
    if (
      value &&
      (value.edge === "top" ||
        value.edge === "right" ||
        value.edge === "bottom" ||
        value.edge === "left") &&
      typeof value.progress === "number"
    ) {
      return value;
    }
  } catch {
    /* default */
  }
  return defaultCharState(0.12);
}
