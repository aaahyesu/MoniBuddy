import fs from "node:fs";
import path from "node:path";
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

type StoreFile = {
  users: Record<string, StoredUser>;
  /** friendCode → userId */
  codes: Record<string, string>;
};

type Presence = {
  userId: string;
  socketId: string;
  nickname: string;
  character: Character;
  friendCode: string;
};

export class FriendStore {
  private filePath: string;
  private data: StoreFile;
  private presence = new Map<string, Presence>();
  private socketToUser = new Map<string, string>();

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, "friends.json");
    this.data = this.load();
  }

  private load(): StoreFile {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { users: {}, codes: {} };
      }
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as StoreFile;
      return {
        users: raw.users ?? {},
        codes: raw.codes ?? {},
      };
    } catch {
      return { users: {}, codes: {} };
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
    } catch {
      /* ignore disk errors on ephemeral hosts */
    }
  }

  private ensureUniqueCode(): string {
    let code = createFriendCode();
    while (this.data.codes[code]) code = createFriendCode();
    return code;
  }

  upsertUser(input: {
    userId: string;
    friendCode?: string;
    nickname: string;
    character: Character;
  }): StoredUser {
    const existing = this.data.users[input.userId];
    let friendCode = (input.friendCode || existing?.friendCode || "").trim().toUpperCase();
    if (!friendCode || (this.data.codes[friendCode] && this.data.codes[friendCode] !== input.userId)) {
      friendCode = this.ensureUniqueCode();
    }
    if (existing?.friendCode && existing.friendCode !== friendCode) {
      delete this.data.codes[existing.friendCode];
    }
    const user: StoredUser = {
      userId: input.userId,
      friendCode,
      nickname: input.nickname.trim().slice(0, 16) || "Guest",
      character: input.character,
      friends: existing?.friends ? [...existing.friends] : [],
    };
    this.data.users[input.userId] = user;
    this.data.codes[friendCode] = input.userId;
    this.save();
    return user;
  }

  setOnline(socketId: string, user: StoredUser) {
    const prevUser = this.socketToUser.get(socketId);
    if (prevUser && prevUser !== user.userId) {
      this.setOfflineBySocket(socketId);
    }
    // 같은 유저가 다른 소켓으로 재접속하면 이전 소켓 매핑 제거
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

  getUser(userId: string): StoredUser | undefined {
    return this.data.users[userId];
  }

  getUserByFriendCode(code: string): StoredUser | undefined {
    const userId = this.data.codes[code.trim().toUpperCase()];
    if (!userId) return undefined;
    return this.data.users[userId];
  }

  listFriends(userId: string): FriendInfo[] {
    const me = this.data.users[userId];
    if (!me) return [];
    return me.friends
      .map((fid) => {
        const friend = this.data.users[fid];
        if (!friend) return null;
        const online = this.presence.has(fid);
        const live = this.presence.get(fid);
        return {
          userId: friend.userId,
          friendCode: friend.friendCode,
          nickname: live?.nickname ?? friend.nickname,
          character: live?.character ?? friend.character,
          online,
        } satisfies FriendInfo;
      })
      .filter((f): f is FriendInfo => Boolean(f));
  }

  addFriend(myUserId: string, friendCode: string): { ok: true; friends: FriendInfo[] } | { ok: false; error: string } {
    const me = this.data.users[myUserId];
    if (!me) return { ok: false, error: "not registered" };
    const other = this.getUserByFriendCode(friendCode);
    if (!other) return { ok: false, error: "friend code not found" };
    if (other.userId === myUserId) return { ok: false, error: "cannot add yourself" };
    if (!me.friends.includes(other.userId)) me.friends.push(other.userId);
    if (!other.friends.includes(myUserId)) other.friends.push(myUserId);
    this.data.users[me.userId] = me;
    this.data.users[other.userId] = other;
    this.save();
    return { ok: true, friends: this.listFriends(myUserId) };
  }

  removeFriend(myUserId: string, friendUserId: string): { ok: true; friends: FriendInfo[] } | { ok: false; error: string } {
    const me = this.data.users[myUserId];
    if (!me) return { ok: false, error: "not registered" };
    me.friends = me.friends.filter((id) => id !== friendUserId);
    const other = this.data.users[friendUserId];
    if (other) {
      other.friends = other.friends.filter((id) => id !== myUserId);
      this.data.users[friendUserId] = other;
    }
    this.data.users[myUserId] = me;
    this.save();
    return { ok: true, friends: this.listFriends(myUserId) };
  }

  /** 내 친구들의 소켓 ID (온라인만) */
  friendSocketIds(userId: string): string[] {
    const me = this.data.users[userId];
    if (!me) return [];
    const out: string[] = [];
    for (const fid of me.friends) {
      const p = this.presence.get(fid);
      if (p) out.push(p.socketId);
    }
    return out;
  }
}
