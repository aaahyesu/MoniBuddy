export const MAX_ROOM_MEMBERS = 8;
export const MAX_CHAT_LENGTH = 80;
export const BUBBLE_TTL_MS = 4000;
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

/** 닉네임 동일 여부 (NFC·대소문자 무시) */
export function nicknamesEqual(a: string, b: string): boolean {
  const left = stripTargetToken(a).toLowerCase();
  const right = stripTargetToken(b).toLowerCase();
  return Boolean(left) && left === right;
}

function matchNickname(candidate: string, nicknames: string[]) {
  const key = stripTargetToken(candidate).toLowerCase();
  if (!key) return undefined;
  const entries = nicknames
    .map((n) => ({ raw: n.trim(), norm: n.trim().normalize("NFC") }))
    .filter((e) => e.norm);
  const exact = entries.find((e) => e.norm.toLowerCase() === key);
  if (exact) return exact.raw;
  // 유일한 접두/포함 매치면 허용 (한글 1글자 닉 일부 입력 포함)
  if (key.length >= 1) {
    const prefixed = entries.filter((e) =>
      e.norm.toLowerCase().startsWith(key),
    );
    if (prefixed.length === 1) return prefixed[0].raw;
    const includes = entries.filter((e) =>
      e.norm.toLowerCase().includes(key),
    );
    if (includes.length === 1) return includes[0].raw;
  }
  return undefined;
}

/**
 * `/편지 [닉] 내용`, `/계란 [닉]`
 * - `/편지 안녕` → 전원 (토큰 1개·방 닉 아님 = 본문)
 * - `/편지 민수` → 대상만 지정(본문 대기) — 힌트 `→민수`
 * - `/편지 민수 안녕` → 대상+본문 (닉은 본문에 넣지 않음)
 * - 방 닉 목록에 없어도 2토큰이면 첫 토큰을 대상으로 유지(서버 최종 매칭)
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
    return { kind: "egg", text: "계란", targetNickname: hit ?? token };
  }

  const letterBody = trimmed.match(/^\/(?:편지|letter)\s+([\s\S]*)$/i);
  if (letterBody) {
    const rest = letterBody[1].trim();
    if (!rest) return { kind: "letter", text: "" };

    const parts = rest.match(/^(@?\S+)\s+([\s\S]+)$/);
    if (parts) {
      const token = stripTargetToken(parts[1]);
      const body = parts[2].trim();
      if (!body) {
        // `/편지 닉 ` 처럼 본문 없음 — 닉이면 대상으로 표시
        const hitOnly = matchNickname(token, nicks);
        if (hitOnly) {
          return { kind: "letter", text: "", targetNickname: hitOnly };
        }
        return { kind: "letter", text: "", targetNickname: token };
      }
      const hit = matchNickname(token, nicks);
      return {
        kind: "letter",
        text: body,
        targetNickname: hit ?? token,
      };
    }

    // 토큰 1개: 방 멤버 닉이면 대상(본문 대기), 아니면 전원 본문
    const token = stripTargetToken(rest);
    const hit = matchNickname(token, nicks);
    if (hit) {
      return { kind: "letter", text: "", targetNickname: hit };
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

export function isBombChatDraft(raw: string): boolean {
  return /^\/(?:폭탄|bomb)(\s|$)/i.test(String(raw ?? "").trim());
}

export function isLadderChatDraft(raw: string): boolean {
  return /^\/(?:사다리|ladder)(\s|$)/i.test(String(raw ?? "").trim());
}

export type MiniGameParse =
  | { kind: "bomb-start"; seconds: number; random: boolean }
  | { kind: "bomb-pass"; targetNickname?: string; random: boolean }
  | { kind: "ladder-open" }
  | { kind: "none" };

/** `/폭탄 30` · `/폭탄 랜덤` · `/폭탄 넘겨 [닉]` · `/사다리` */
export function parseMiniGameChat(raw: string): MiniGameParse {
  const trimmed = String(raw ?? "").trim().normalize("NFC");
  const bombRandom = trimmed.match(/^\/(?:폭탄|bomb)\s+(?:랜덤|random)\s*$/i);
  if (bombRandom) {
    return { kind: "bomb-start", seconds: 0, random: true };
  }
  const bombStart = trimmed.match(/^\/(?:폭탄|bomb)\s+(\d+)\s*$/i);
  if (bombStart) {
    const seconds = Math.max(5, Math.min(120, Number(bombStart[1]) || 30));
    return { kind: "bomb-start", seconds, random: false };
  }
  const bombPass = trimmed.match(
    /^\/(?:폭탄|bomb)\s+(?:넘겨|pass)(?:\s+(@?\S+))?\s*$/i,
  );
  if (bombPass) {
    if (bombPass[1]) {
      return {
        kind: "bomb-pass",
        targetNickname: stripTargetToken(bombPass[1]),
        random: false,
      };
    }
    return { kind: "bomb-pass", random: true };
  }
  if (/^\/(?:사다리|ladder)\s*$/i.test(trimmed)) {
    return { kind: "ladder-open" };
  }
  return { kind: "none" };
}

export type BombState = {
  endsAt: number;
  durationSec: number;
  holderMemberId: string;
  holderNickname: string;
  startedByMemberId: string;
};

export type BombExplodePayload = {
  holderMemberId: string;
  holderNickname: string;
  at: number;
};

export type BombStartPayload = { seconds?: number; random?: boolean };
export type BombPassPayload = {
  random?: boolean;
  targetNickname?: string;
};

export type BombAck = { ok: true; bomb: BombState } | { ok: false; error: string };

/** rungs[row][gap] = true → gap와 gap+1 열을 가로로 연결 */
export type LadderState = {
  hostMemberId: string;
  hostNickname: string;
  names: string[];
  memberIds: string[];
  outcomes: string[];
  rungs: boolean[][];
  phase: "setup" | "running" | "done";
  /** phase=done 일 때 name → outcome */
  results?: Array<{ name: string; outcome: string }>;
};

export type LadderStartPayload = {
  memberIds: string[];
  /** 길이는 memberIds와 동일. 비우면 꽝/당첨 자동 */
  outcomes?: string[];
  mode?: "winlose" | "custom";
};

export type LadderAck =
  | { ok: true; ladder: LadderState }
  | { ok: false; error: string };

/** rungs[row][gap] = true → gap와 gap+1 열을 가로로 연결.
 *  columns>=2 이면 가로줄 합계 최소 5개(가능하면)를 보장. */
export function generateLadderRungs(
  columns: number,
  rows = 10,
): boolean[][] {
  const n = Math.max(1, columns);
  const gaps = Math.max(0, n - 1);
  const rowCount = Math.max(1, rows);
  const rungs: boolean[][] = [];

  const canPlace = (line: boolean[], gap: number) => {
    if (gap < 0 || gap >= line.length) return false;
    if (line[gap]) return false;
    if (gap > 0 && line[gap - 1]) return false;
    if (gap < line.length - 1 && line[gap + 1]) return false;
    return true;
  };

  for (let row = 0; row < rowCount; row++) {
    const line: boolean[] = Array.from({ length: gaps }, () => false);
    if (gaps === 0) {
      rungs.push(line);
      continue;
    }
    let skipNext = false;
    for (let gap = 0; gap < gaps; gap++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (Math.random() < 0.72) {
        line[gap] = true;
        skipNext = true;
      }
    }
    rungs.push(line);
  }

  if (gaps === 0) return rungs;

  const countRungs = () =>
    rungs.reduce((n, line) => n + line.filter(Boolean).length, 0);

  // 최소 5개 가로줄 (행·간격이 부족하면 가능한 최대)
  const minRungs = Math.min(5, gaps * rowCount);
  let guard = 0;
  while (countRungs() < minRungs && guard++ < 200) {
    const ri = Math.floor(Math.random() * rowCount);
    const gi = Math.floor(Math.random() * gaps);
    const line = rungs[ri]!;
    if (!canPlace(line, gi)) continue;
    line[gi] = true;
  }

  // 그래도 모자라면 위에서부터 강제 배치
  if (countRungs() < minRungs) {
    for (let ri = 0; ri < rowCount && countRungs() < minRungs; ri++) {
      for (let gi = 0; gi < gaps && countRungs() < minRungs; gi++) {
        if (canPlace(rungs[ri]!, gi)) rungs[ri]![gi] = true;
      }
    }
  }

  return rungs;
}

/** 각 시작 열의 최종 열 인덱스 */
export function resolveLadderPaths(
  columns: number,
  rungs: boolean[][],
): number[] {
  const ends: number[] = [];
  for (let start = 0; start < columns; start++) {
    let col = start;
    for (const row of rungs) {
      if (col > 0 && row[col - 1]) col -= 1;
      else if (col < columns - 1 && row[col]) col += 1;
    }
    ends.push(col);
  }
  return ends;
}

/** 시작 열 → 각 가로줄 통과 후 열 (연출용) */
export function traceLadderPath(
  startCol: number,
  columns: number,
  rungs: boolean[][],
): Array<{ col: number; row: number }> {
  const points: Array<{ col: number; row: number }> = [
    { col: startCol, row: 0 },
  ];
  let col = startCol;
  for (let ri = 0; ri < rungs.length; ri++) {
    const row = rungs[ri]!;
    if (col > 0 && row[col - 1]) col -= 1;
    else if (col < columns - 1 && row[col]) col += 1;
    points.push({ col, row: ri + 1 });
  }
  return points;
}

export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
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
  BombStart: "bomb:start",
  BombPass: "bomb:pass",
  BombSync: "bomb:sync",
  BombExplode: "bomb:explode",
  LadderOpen: "ladder:open",
  LadderStart: "ladder:start",
  LadderSync: "ladder:sync",
  LadderCancel: "ladder:cancel",
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
