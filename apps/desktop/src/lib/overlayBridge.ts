import type { FriendInviteRecvPayload } from "@monibuddy/shared";

export const PENDING_INVITE_KEY = "monibuddy.pendingInvite.v1";
export const INVITE_ACTION_KEY = "monibuddy.inviteAction.v1";
export const OVERLAY_NOTICE_KEY = "monibuddy.overlayNotice.v1";

export const PENDING_INVITE_EVENT = "monibuddy:pendingInvite";
export const INVITE_ACTION_EVENT = "monibuddy:inviteAction";
export const OVERLAY_NOTICE_EVENT = "monibuddy:overlayNotice";

export type InviteAction = {
  action: "accept" | "dismiss";
  at: number;
};

export type OverlayNotice = {
  id: string;
  text: string;
  at: number;
};

function dispatch(name: string) {
  window.dispatchEvent(new Event(name));
}

/** 프로필 닉 — 같은 브라우저 다중 탭에서 pending 섞임 방지용 */
function profileNickname(): string {
  try {
    const raw = localStorage.getItem("monibuddy.profile.v1");
    if (!raw) return "";
    const p = JSON.parse(raw) as { nickname?: string };
    return String(p?.nickname ?? "").trim();
  } catch {
    return "";
  }
}

export function readPendingInvite(): FriendInviteRecvPayload | null {
  try {
    const raw = localStorage.getItem(PENDING_INVITE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FriendInviteRecvPayload;
    if (!parsed?.roomCode || !parsed.fromNickname) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePendingInvite(invite: FriendInviteRecvPayload | null) {
  if (!invite) {
    localStorage.removeItem(PENDING_INVITE_KEY);
  } else {
    localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(invite));
  }
  dispatch(PENDING_INVITE_EVENT);
}

export function readInviteAction(): InviteAction | null {
  try {
    const raw = localStorage.getItem(INVITE_ACTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InviteAction;
    if (parsed?.action !== "accept" && parsed?.action !== "dismiss") return null;
    if (typeof parsed.at !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeInviteAction(action: "accept" | "dismiss") {
  localStorage.setItem(
    INVITE_ACTION_KEY,
    JSON.stringify({ action, at: Date.now() } satisfies InviteAction),
  );
  dispatch(INVITE_ACTION_EVENT);
}

export function clearInviteAction() {
  localStorage.removeItem(INVITE_ACTION_KEY);
}

export function readOverlayNotice(): OverlayNotice | null {
  try {
    const raw = localStorage.getItem(OVERLAY_NOTICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OverlayNotice;
    if (!parsed?.id || !parsed.text || typeof parsed.at !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeOverlayNotice(text: string) {
  const notice: OverlayNotice = {
    id: `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    text,
    at: Date.now(),
  };
  localStorage.setItem(OVERLAY_NOTICE_KEY, JSON.stringify(notice));
  dispatch(OVERLAY_NOTICE_EVENT);
  return notice;
}

export function clearOverlayNotice() {
  localStorage.removeItem(OVERLAY_NOTICE_KEY);
  dispatch(OVERLAY_NOTICE_EVENT);
}

export const GAME_PENDING_KEY = "monibuddy.gamePending.v1";
export const GAME_PENDING_EVENT = "monibuddy:gamePending";
export const GAME_STATE_KEY = "monibuddy.gameState.v1";
export const GAME_STATE_EVENT = "monibuddy:gameState";
export const PENDING_CHAT_KEY = "monibuddy.pendingChat.v1";
export const PENDING_CHAT_EVENT = "monibuddy:pendingChat";

export type GamePendingAction =
  | {
      type: "bomb-pass";
      random?: boolean;
      targetNickname?: string;
      at: number;
      byNickname?: string;
    }
  | {
      type: "ladder-start";
      memberIds: string[];
      outcomes?: string[];
      mode?: "winlose" | "custom";
      at: number;
      byNickname?: string;
    }
  | { type: "ladder-cancel"; at: number; byNickname?: string }
  | { type: "ladder-open"; at: number; byNickname?: string }
  | { type: "roulette-open"; at: number; byNickname?: string }
  | {
      type: "roulette-spin";
      slots: string[];
      at: number;
      byNickname?: string;
    }
  | { type: "roulette-cancel"; at: number; byNickname?: string }
  | {
      type: "sketch-open";
      rounds: number;
      at: number;
      byNickname?: string;
    }
  | {
      type: "sketch-vote";
      vote: "yes" | "no";
      at: number;
      byNickname?: string;
    }
  | { type: "sketch-join"; at: number; byNickname?: string }
  | {
      type: "sketch-category";
      categoryId: import("@monibuddy/shared").SketchCategoryId;
      at: number;
      byNickname?: string;
    }
  | {
      type: "sketch-start";
      categoryId: import("@monibuddy/shared").SketchCategoryId;
      at: number;
      byNickname?: string;
    }
  | {
      type: "sketch-stroke";
      stroke: import("@monibuddy/shared").SketchStroke;
      at: number;
      byNickname?: string;
    }
  | { type: "sketch-clear"; at: number; byNickname?: string }
  | { type: "sketch-reveal"; at: number; byNickname?: string }
  | { type: "sketch-cancel"; at: number; byNickname?: string };

export type GameBridgeState = {
  bomb: import("@monibuddy/shared").BombState | null;
  ladder: import("@monibuddy/shared").LadderState | null;
  roulette: import("@monibuddy/shared").RouletteState | null;
  sketch: import("@monibuddy/shared").SketchState | null;
  bombExplode: import("@monibuddy/shared").BombExplodePayload | null;
  at: number;
};

export type PendingChat = {
  text?: string;
  attachments?: import("@monibuddy/shared").ChatAttachment[];
  at: number;
  /** 이 닉의 설정 창만 flush (다른 탭이 가로채지 않게) */
  byNickname?: string;
};

function readGameQueue(): GamePendingAction[] {
  try {
    const raw = localStorage.getItem(GAME_PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GamePendingAction | GamePendingAction[];
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && "type" in parsed) {
      return [parsed];
    }
    return [];
  } catch {
    return [];
  }
}

function writeGameQueue(list: GamePendingAction[]) {
  if (list.length === 0) {
    localStorage.removeItem(GAME_PENDING_KEY);
  } else {
    localStorage.setItem(GAME_PENDING_KEY, JSON.stringify(list));
  }
}

export function writeGamePending(action: GamePendingAction) {
  const entry: GamePendingAction = {
    ...action,
    byNickname: action.byNickname ?? profileNickname(),
  };
  const list = readGameQueue();
  list.push(entry);
  writeGameQueue(list.slice(-80));
  dispatch(GAME_PENDING_EVENT);
}

/** 내 닉에 해당하는 대기 액션 하나 꺼냄. 없으면 null (다른 탭 것은 건드리지 않음) */
export function takeGamePending(forNickname: string): GamePendingAction | null {
  const list = readGameQueue();
  if (list.length === 0) return null;
  const nick = forNickname.trim().toLowerCase();
  const idx = list.findIndex((a) => {
    const by = String(a.byNickname ?? "")
      .trim()
      .toLowerCase();
    if (!by) return true;
    if (!nick) return true;
    return by === nick;
  });
  if (idx < 0) return null;
  const item = list[idx]!;
  list.splice(idx, 1);
  writeGameQueue(list);
  return item;
}

/** @deprecated takeGamePending 사용 */
export function readGamePending(): GamePendingAction | null {
  const list = readGameQueue();
  return list[0] ?? null;
}

export function clearGamePending() {
  localStorage.removeItem(GAME_PENDING_KEY);
}

export function writePendingChat(payload: PendingChat) {
  const entry: PendingChat = {
    ...payload,
    byNickname: payload.byNickname ?? profileNickname(),
  };
  try {
    const raw = localStorage.getItem(PENDING_CHAT_KEY);
    let list: PendingChat[] = [];
    if (raw) {
      const parsed = JSON.parse(raw) as PendingChat | PendingChat[];
      list = Array.isArray(parsed) ? parsed : [parsed];
    }
    list.push(entry);
    localStorage.setItem(PENDING_CHAT_KEY, JSON.stringify(list.slice(-40)));
  } catch {
    localStorage.setItem(PENDING_CHAT_KEY, JSON.stringify([entry]));
  }
  dispatch(PENDING_CHAT_EVENT);
}

export function takePendingChat(forNickname: string): PendingChat | null {
  try {
    const raw = localStorage.getItem(PENDING_CHAT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingChat | PendingChat[];
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const nick = forNickname.trim().toLowerCase();
    const idx = list.findIndex((c) => {
      const by = String(c.byNickname ?? "")
        .trim()
        .toLowerCase();
      if (!by) return true;
      if (!nick) return true;
      return by === nick;
    });
    if (idx < 0) return null;
    const item = list[idx]!;
    list.splice(idx, 1);
    if (list.length === 0) localStorage.removeItem(PENDING_CHAT_KEY);
    else localStorage.setItem(PENDING_CHAT_KEY, JSON.stringify(list));
    return item;
  } catch {
    return null;
  }
}

export function writeGameState(state: GameBridgeState) {
  localStorage.setItem(GAME_STATE_KEY, JSON.stringify(state));
  dispatch(GAME_STATE_EVENT);
}

export function readGameState(): GameBridgeState | null {
  try {
    const raw = localStorage.getItem(GAME_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GameBridgeState;
  } catch {
    return null;
  }
}
