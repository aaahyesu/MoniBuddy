export const MAX_ROOM_MEMBERS = 8;
export const MAX_CHAT_LENGTH = 80;
export const BUBBLE_TTL_MS = 5000;
export const INVITE_CODE_LENGTH = 6;
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

export type CharState = {
  motion: CharMotion;
  edge: Edge;
  progress: number;
  facing: 1 | -1;
};

export type Member = {
  id: string;
  nickname: string;
  character: Character;
  state: CharState;
  offset: number;
};

export type ChatMessage = {
  id: string;
  memberId: string;
  nickname: string;
  text: string;
  at: number;
};

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
} as const;

export type RoomCreatePayload = {
  nickname: string;
  character: Character;
};

export type RoomJoinPayload = {
  code: string;
  nickname: string;
  character: Character;
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
