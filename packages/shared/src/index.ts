export const MAX_ROOM_MEMBERS = 8;
export const MAX_CHAT_LENGTH = 80;
export const BUBBLE_TTL_MS = 2000;
export const INVITE_CODE_LENGTH = 6;
export const FRIEND_CODE_LENGTH = 6;
export const PNG_MAX_BYTES = 128 * 1024;
export const GIF_MAX_BYTES = 512 * 1024;
export const UPLOAD_MAX_EDGE = 128;
export const DEFAULT_SERVER_URL = "http://127.0.0.1:3847";
export const APP_NAME = "MoniBuddy";
export const APP_NAME_KO = "모니버디";

export type Edge = "top" | "right" | "bottom" | "left";
export type CharMotion = "idle" | "walk";

export type PartsCharacter = {
  kind: "parts";
  layers: {
    head: string;
    body: string;
    outfit: string;
    accessory?: string;
  };
  palette?: string;
};

export type UploadCharacter = {
  kind: "upload";
  imageId: string;
  mime: "image/png" | "image/gif";
  displaySize: 32 | 64 | 80 | 128;
};

/** Bundled default GIF from apps/desktop/public/buddies/ */
export type BuddyCharacter = {
  kind: "buddy";
  id: string;
  displaySize: 32 | 64 | 80 | 128;
  /** 0=baby, 1=teen, 2=adult */
  stage: 0 | 1 | 2;
  /** Visual size multiplier (synced to peers) */
  scale: number;
};

export type Character = PartsCharacter | UploadCharacter | BuddyCharacter;

/** 오버레이 버디 최소 표시 크기 */
export const BUDDY_MIN_DISPLAY_SIZE = 80 as const;

export type GrowthStage = 0 | 1 | 2;

export const GROWTH_XP_THRESHOLDS = [0, 12, 30] as const;

export function stageFromXp(xp: number): GrowthStage {
  if (xp >= GROWTH_XP_THRESHOLDS[2]) return 2;
  if (xp >= GROWTH_XP_THRESHOLDS[1]) return 1;
  return 0;
}

export function defaultScaleForStage(stage: GrowthStage): number {
  if (stage === 0) return 0.55;
  if (stage === 1) return 0.78;
  return 1;
}

export type PathMode = "all" | "top" | "bottom" | "left" | "right";

export type CharState = {
  motion: CharMotion;
  edge: Edge;
  progress: number;
  facing: 1 | -1;
  /** 테두리 이동 속도 (progress/sec). 피어 동기화용 */
  speed?: number;
  /** 이동 가능 변. 피어 동기화용 */
  pathMode?: PathMode;
};

export type Member = {
  id: string;
  nickname: string;
  character: Character;
  state: CharState;
  offset: number;
  /** 캐릭터 위 상시 상태메시지 (피어 동기화) */
  statusMessage?: string;
};

export type ChatMessage = {
  id: string;
  memberId: string;
  nickname: string;
  text: string;
  at: number;
  /** 없으면 일반 채팅 */
  kind?: "chat" | "letter" | "egg";
  /** 편지/계란 대상 닉네임 (없으면 방 전원) */
  targetNickname?: string;
};

export type EffectChatParse = {
  kind: "chat" | "letter" | "egg";
  text: string;
  /** 지정 시 해당 닉만 (없으면 전원) */
  targetNickname?: string;
};

function stripTargetToken(token: string) {
  return token.replace(/^@/, "").trim().normalize("NFC");
}

function matchNickname(candidate: string, nicknames: string[]) {
  const key = stripTargetToken(candidate).toLowerCase();
  if (!key) return undefined;
  const normalized = nicknames
    .map((n) => n.trim().normalize("NFC"))
    .filter(Boolean);
  const exact = normalized.find((n) => n.toLowerCase() === key);
  if (exact) return exact;
  // 유일한 접두/포함 매치면 허용 (짧은 닉 오타·일부 입력)
  if (key.length >= 2) {
    const prefixed = normalized.filter((n) => n.toLowerCase().startsWith(key));
    if (prefixed.length === 1) return prefixed[0];
    const includes = normalized.filter((n) => n.toLowerCase().includes(key));
    if (includes.length === 1) return includes[0];
  }
  return undefined;
}

/**
 * `/편지 [닉] 내용`, `/계란 [닉]`
 * - `/편지 안녕` → 전원 (토큰 1개 = 본문)
 * - `/편지 닉 내용` → 닉은 항상 대상으로 분리. 방에 없으면 drop(빈 text)
 * - `/계란` / `/계란 닉` 동일
 */
export function parseEffectChat(
  raw: string,
  memberNicknames: string[] = [],
): EffectChatParse {
  const trimmed = String(raw ?? "").trim().normalize("NFC");
  const nicks = memberNicknames.map((n) => n.trim()).filter(Boolean);

  const egg = trimmed.match(/^\/(?:계란|egg)(?:\s+(@?\S+))?\s*$/i);
  if (egg) {
    if (!egg[1]) return { kind: "egg", text: "계란" };
    const token = stripTargetToken(egg[1]);
    const hit = matchNickname(token, nicks);
    if (hit) return { kind: "egg", text: "계란", targetNickname: hit };
    return { kind: "egg", text: "", targetNickname: token };
  }

  const letterBody = trimmed.match(/^\/(?:편지|letter)\s+([\s\S]*)$/i);
  if (letterBody) {
    const rest = letterBody[1].trim();
    if (!rest) return { kind: "letter", text: "" };
    const parts = rest.match(/^(@?\S+)\s+([\s\S]+)$/);
    if (parts) {
      const token = stripTargetToken(parts[1]);
      const body = parts[2].trim();
      if (!body) return { kind: "letter", text: "" };
      const hit = matchNickname(token, nicks);
      // 두 토큰 이상이면 첫 토큰은 항상 닉으로 분리 (본문에 닉 포함 금지)
      if (hit) {
        return { kind: "letter", text: body, targetNickname: hit };
      }
      // 방에 없는 닉 → drop (본문으로 합치지 않음)
      return { kind: "letter", text: "", targetNickname: token };
    }
    return { kind: "letter", text: rest };
  }
  if (/^\/(?:편지|letter)\s*$/i.test(trimmed)) {
    return { kind: "letter", text: "" };
  }
  return { kind: "chat", text: trimmed };
}

/** @deprecated parseEffectChat 사용 */
export function parseLetterChat(raw: string): {
  kind: "chat" | "letter";
  text: string;
} {
  const parsed = parseEffectChat(raw);
  if (parsed.kind === "egg") return { kind: "chat", text: raw.trim() };
  return { kind: parsed.kind, text: parsed.text };
}

export function isLetterChatDraft(raw: string): boolean {
  return /^\/(?:편지|letter)(\s|$)/i.test(String(raw ?? "").trim());
}

/** `/계란` 또는 `/계란 닉네임` */
export function isEggChat(raw: string): boolean {
  return /^\/(?:계란|egg)(?:\s+@?\S+)?\s*$/i.test(String(raw ?? "").trim());
}

export type RoomSnapshot = {
  code: string;
  members: Member[];
};

export const SocketEvents = {
  RoomCreate: "room:create",
  RoomJoin: "room:join",
  RoomLeave: "room:leave",
  RoomError: "room:error",
  MemberSync: "member:sync",
  ChatSend: "chat:send",
  ChatBroadcast: "chat:broadcast",
  CharState: "char:state",
  MemberProfile: "member:profile",
  PresenceHello: "presence:hello",
  FriendAdd: "friend:add",
  FriendRemove: "friend:remove",
  FriendSync: "friend:sync",
  FriendInvite: "friend:invite",
  FriendInviteRecv: "friend:invite-recv",
  FriendPresence: "friend:presence",
  FriendGroupCreate: "friend:group-create",
  FriendGroupRename: "friend:group-rename",
  FriendGroupDelete: "friend:group-delete",
  FriendGroupAssign: "friend:group-assign",
  RoomNotice: "room:notice",
  GuideMarkSeen: "guide:markSeen",
} as const;

export type FriendGroup = {
  id: string;
  name: string;
  sortOrder: number;
};

export type FriendInfo = {
  userId: string;
  friendCode: string;
  nickname: string;
  character: Character;
  online: boolean;
  /** 내 목록 전용 — 여러 그룹에 속할 수 있음 (빈 배열 = 미분류) */
  groupIds: string[];
};

export type FriendListPayload = {
  friends: FriendInfo[];
  groups: FriendGroup[];
};

export type PresenceHelloPayload = {
  userId: string;
  friendCode: string;
  nickname: string;
  character: Character;
};

export type PresenceHelloAck =
  | {
      ok: true;
      userId: string;
      friendCode: string;
      friends: FriendInfo[];
      groups: FriendGroup[];
      /** DB에 가이드 이미 봄 여부 — 없으면 false로 취급 */
      guideSeen: boolean;
    }
  | { ok: false; error: string };

export type GuideMarkSeenAck = { ok: true } | { ok: false; error: string };

export type FriendAddPayload = {
  friendCode: string;
};

export type FriendAddAck =
  | { ok: true; friends: FriendInfo[]; groups: FriendGroup[] }
  | { ok: false; error: string };

export type FriendRemovePayload = {
  userId: string;
};

export type FriendRemoveAck =
  | { ok: true; friends: FriendInfo[]; groups: FriendGroup[] }
  | { ok: false; error: string };

export type FriendGroupCreatePayload = {
  name: string;
};

export type FriendGroupRenamePayload = {
  groupId: string;
  name: string;
};

export type FriendGroupDeletePayload = {
  groupId: string;
};

export type FriendGroupAssignPayload = {
  friendUserId: string;
  /** 소속시킬 그룹 id 목록 (빈 배열 = 미분류) */
  groupIds: string[];
};

export type FriendGroupAck =
  | { ok: true; friends: FriendInfo[]; groups: FriendGroup[] }
  | { ok: false; error: string };

export type FriendInvitePayload = {
  toUserId: string;
  roomCode: string;
};

export type FriendInviteAck =
  | { ok: true }
  | { ok: false; error: string };

export type FriendInviteRecvPayload = {
  fromUserId: string;
  fromNickname: string;
  roomCode: string;
  at: number;
};

export type RoomNoticePayload = {
  type: "member-join" | "member-leave";
  nickname: string;
  memberId: string;
  at: number;
};

export type FriendPresencePayload = {
  userId: string;
  online: boolean;
  nickname?: string;
  character?: Character;
};

export type RoomCreatePayload = {
  nickname: string;
  character: Character;
  statusMessage?: string;
};

export type RoomJoinPayload = {
  code: string;
  nickname: string;
  character: Character;
  statusMessage?: string;
};

export type RoomCreateAck =
  | { ok: true; code: string; memberId: string; room: RoomSnapshot }
  | { ok: false; error: string };

export type RoomJoinAck =
  | { ok: true; memberId: string; room: RoomSnapshot }
  | { ok: false; error: string };

export type ChatSendPayload = {
  text: string;
};

export type CharStatePayload = {
  state: CharState;
};

export type MemberProfilePayload = {
  statusMessage?: string;
};

export const PART_CATALOG = {
  head: ["head_round", "head_square", "head_cat"],
  body: ["body_basic", "body_tall", "body_round"],
  outfit: ["outfit_tee", "outfit_hoodie", "outfit_cape"],
  accessory: ["none", "acc_hat", "acc_scarf", "acc_glasses"],
} as const;

export function defaultPartsCharacter(): PartsCharacter {
  return {
    kind: "parts",
    layers: {
      head: "head_round",
      body: "body_basic",
      outfit: "outfit_tee",
      accessory: "none",
    },
    palette: "#6ec6ff",
  };
}

export function defaultCharState(offset = 0): CharState {
  return {
    motion: "walk",
    edge: "top",
    progress: Math.min(0.95, Math.max(0, offset)),
    facing: 1,
    speed: 0.011,
    pathMode: "all",
  };
}

export function createInviteCode(length = INVITE_CODE_LENGTH): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function createFriendCode(length = FRIEND_CODE_LENGTH): string {
  return createInviteCode(length);
}
