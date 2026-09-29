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

export type GamePendingAction =
  | {
      type: "bomb-pass";
      random?: boolean;
      targetNickname?: string;
      at: number;
    }
  | {
      type: "ladder-start";
      memberIds: string[];
      outcomes?: string[];
      mode?: "winlose" | "custom";
      at: number;
    }
  | { type: "ladder-cancel"; at: number }
  | { type: "ladder-open"; at: number };

export type GameBridgeState = {
  bomb: import("@monibuddy/shared").BombState | null;
  ladder: import("@monibuddy/shared").LadderState | null;
  bombExplode: import("@monibuddy/shared").BombExplodePayload | null;
  at: number;
};

export function writeGamePending(action: GamePendingAction) {
  localStorage.setItem(GAME_PENDING_KEY, JSON.stringify(action));
  dispatch(GAME_PENDING_EVENT);
}

export function readGamePending(): GamePendingAction | null {
  try {
    const raw = localStorage.getItem(GAME_PENDING_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GamePendingAction;
  } catch {
    return null;
  }
}

export function clearGamePending() {
  localStorage.removeItem(GAME_PENDING_KEY);
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
