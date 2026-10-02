import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BUBBLE_TTL_MS,
  BUDDY_MIN_DISPLAY_SIZE,
  MAX_CHAT_LENGTH,
  type ChatMessage,
  type Character,
  type CharMotion,
  type FriendInviteRecvPayload,
  type Member,
  defaultCharState,
  isEggChat,
  isLetterChatDraft,
  isBombChatDraft,
  isLadderChatDraft,
  nicknamesEqual,
  parseEffectChat,
  parseLetterChat,
  parseMiniGameChat,
  type BombExplodePayload,
  type BombState,
  type LadderState,
} from "@monibuddy/shared";
import { GuideSpotlight } from "../components/GuideSpotlight";
import { resolveDefaultServerUrl } from "../lib/serverUrl";
import { CharacterView } from "../components/CharacterView";
import {
  advanceProgress,
  FIXED_INSET,
  nearestProgressOnBorder,
  PATH_MODE_OPTIONS,
  type PathMode,
  pointOnBorder,
} from "../lib/borderPath";
import { loadBuddyManifest, type BuddyDef } from "../lib/defaultBuddies";
import { readProfile, writeStatusMessage } from "../hooks/useLocalProfile";
import { BombBoom } from "./BombBoom";
import { BombProp } from "./BombProp";
import { LadderGame } from "./LadderGame";
import {
  GAME_STATE_EVENT,
  GAME_STATE_KEY,
  OVERLAY_NOTICE_EVENT,
  OVERLAY_NOTICE_KEY,
  PENDING_INVITE_EVENT,
  PENDING_INVITE_KEY,
  clearOverlayNotice,
  readGameState,
  readOverlayNotice,
  readPendingInvite,
  writeGamePending,
  writeInviteAction,
  writeOverlayNotice,
  type OverlayNotice,
} from "../lib/overlayBridge";
import { readDeviceIdentity } from "../lib/deviceIdentity";
import {
  clearOrphanSettingsGuideSession,
  readGuideSession,
  requestServerGuideMarkSeen,
} from "../lib/productGuide";
import { useProductGuide } from "../hooks/useProductGuide";
import { invokeSafe, isTauri, setClickThrough } from "../lib/tauri";
import { LetterReveal, type LetterItem } from "./LetterReveal";
import { EggThrow } from "./EggThrow";

type Bubble = { memberId: string; text: string; until: number; id: string };

const OVERLAY_NOTICE_TTL_MS = 5200;

type MoveSettings = {
  speed: number;
  walking: boolean;
  pathMode: PathMode;
};

const MOTION_IDLE: CharMotion = "idle";
const MOTION_WALK: CharMotion = "walk";

const ROOM_KEY = "monibuddy.activeRoom.v1";
const RUNTIME_KEY = "monibuddy.runtime.v1";
const PENDING_CHAT_KEY = "monibuddy.pendingChat.v1";
const PENDING_ROOM_KEY = "monibuddy.pendingRoom.v1";
const MOVE_KEY = "monibuddy.moveSettings.v1";
const CHAT_LOG_KEY = "monibuddy.chatLog.v1";
const CHAT_LOG_KEEP_MS = 10 * 60 * 1000;
const CHAT_LOG_MAX = 40;
const LOCAL_PINS_KEY = "monibuddy.localPins.v1";
/** @deprecated 이전 피어 전용 키 — 한 번 읽어서 마이그레이션 */
const LEGACY_PEER_PINS_KEY = "monibuddy.peerPins.v1";
const HIT_PAD = 36;
const DEFAULT_MOVE: MoveSettings = {
  speed: 0.011,
  walking: true,
  pathMode: "all",
};

const PATH_MODES = new Set<PathMode>(["all", "top", "bottom", "left", "right"]);

/** 이 기기에서만 쓰는 캐릭터 위치 고정값 (서버/다른 사람에게 안 보냄) */
type LocalPin = { x: number; y: number; facing: 1 | -1 };
type LocalPins = Record<string, LocalPin>;
type MemberPose = {
  progress: number;
  edge: Member["state"]["edge"];
  facing: Member["state"]["facing"];
  motion: Member["state"]["motion"];
  /** 고정/배치 초안용 자유 좌표 */
  free?: LocalPin;
};

const FREE_POS_PAD = 28;

function clampFreePos(x: number, y: number, w: number, h: number): LocalPin {
  return {
    x: Math.min(w - FREE_POS_PAD, Math.max(FREE_POS_PAD, x)),
    y: Math.min(h - FREE_POS_PAD, Math.max(FREE_POS_PAD, y)),
    facing: 1,
  };
}

type Runtime = {
  members: Member[];
  messages: ChatMessage[];
  memberId: string | null;
  roomCode: string | null;
  serverUrl: string;
  nickname: string;
  character: Character;
  statusMessage?: string;
  bomb?: BombState | null;
  ladder?: LadderState | null;
  bombExplode?: BombExplodePayload | null;
};

function readRuntime(): Runtime | null {
  try {
    const raw = localStorage.getItem(RUNTIME_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Runtime;
  } catch {
    return null;
  }
}

function readActiveRoomCode(rt: Runtime | null): string | null {
  // 설정 창 runtime이 권위. ROOM_KEY만 남은 stale 값으로 유령 멤버를 그리지 않음
  if (rt?.roomCode) return rt.roomCode;
  return null;
}

function readMoveSettings(): MoveSettings {
  try {
    const raw = localStorage.getItem(MOVE_KEY);
    if (!raw) return DEFAULT_MOVE;
    const parsed = JSON.parse(raw) as Partial<MoveSettings> & { inset?: number };
    const pathMode = PATH_MODES.has(parsed.pathMode as PathMode)
      ? (parsed.pathMode as PathMode)
      : DEFAULT_MOVE.pathMode;
    return {
      speed: Math.min(0.05, Math.max(0.003, parsed.speed ?? DEFAULT_MOVE.speed)),
      walking: parsed.walking ?? true,
      pathMode,
    };
  } catch {
    return DEFAULT_MOVE;
  }
}

function writeMoveSettings(next: MoveSettings) {
  localStorage.setItem(MOVE_KEY, JSON.stringify(next));
}

type ChatLogSettings = {
  enabled: boolean;
  opacity: number;
  width: number;
  /** 화면 왼쪽·위에서의 위치. 없으면 기본(왼쪽 하단) */
  x?: number;
  y?: number;
};

const CHAT_LOG_MIN_W = 220;
const CHAT_LOG_MAX_W = 720;
const DEFAULT_CHAT_LOG: ChatLogSettings = {
  enabled: false,
  opacity: 0.72,
  width: 380,
};

function clampChatLogWidth(width: number): number {
  const max = Math.min(
    CHAT_LOG_MAX_W,
    Math.max(CHAT_LOG_MIN_W, window.innerWidth - 32),
  );
  if (!Number.isFinite(width)) return DEFAULT_CHAT_LOG.width;
  return Math.min(max, Math.max(CHAT_LOG_MIN_W, Math.round(width)));
}

function clampChatLogPos(
  x: number,
  y: number,
  panelW: number,
  panelH: number,
): { x: number; y: number } {
  const maxX = Math.max(8, window.innerWidth - Math.min(panelW, 120));
  const maxY = Math.max(8, window.innerHeight - Math.min(panelH, 48));
  return {
    x: Math.round(Math.min(maxX, Math.max(8, x))),
    y: Math.round(Math.min(maxY, Math.max(8, y))),
  };
}

function readChatLogSettings(): ChatLogSettings {
  try {
    const raw = localStorage.getItem(CHAT_LOG_KEY);
    if (!raw) return DEFAULT_CHAT_LOG;
    const parsed = JSON.parse(raw) as Partial<ChatLogSettings>;
    const opacity = Number(parsed.opacity);
    const width = clampChatLogWidth(Number(parsed.width));
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    const placed =
      Number.isFinite(x) && Number.isFinite(y)
        ? clampChatLogPos(x, y, width, 260)
        : {};
    return {
      enabled: Boolean(parsed.enabled),
      opacity: Number.isFinite(opacity)
        ? Math.min(0.95, Math.max(0.25, opacity))
        : DEFAULT_CHAT_LOG.opacity,
      width,
      ...placed,
    };
  } catch {
    return DEFAULT_CHAT_LOG;
  }
}

function writeChatLogSettings(next: ChatLogSettings) {
  localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(next));
}

function isPlainRoomChat(msg: ChatMessage): boolean {
  if (msg.kind === "letter" || msg.kind === "egg") return false;
  if (msg.targetNickname) return false;
  const text = msg.text || "";
  if (isEggChat(text)) return false;
  if (parseLetterChat(text).kind === "letter") return false;
  return Boolean(text.trim());
}

function recentPlainChats(messages: ChatMessage[] | undefined, now = Date.now()) {
  return (messages ?? [])
    .filter((m) => isPlainRoomChat(m) && now - (m.at || 0) <= CHAT_LOG_KEEP_MS)
    .slice(-CHAT_LOG_MAX);
}

/** 같은 사람은 항상 같은 색. 본문 색은 건드리지 않음 */
const CHAT_NICK_COLORS = [
  "#7ec8ff",
  "#ffb3c7",
  "#ffe08a",
  "#9be7a8",
  "#d4b5ff",
  "#ffc49a",
  "#7eefe0",
  "#ff9ad5",
  "#c6e86a",
  "#a9c4ff",
  "#ffd27a",
  "#f0a0e4",
];

function chatNickColor(memberId: string, nickname: string): string {
  const key = (memberId || nickname || "?").trim();
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 33 + key.charCodeAt(i)) >>> 0;
  }
  return CHAT_NICK_COLORS[hash % CHAT_NICK_COLORS.length]!;
}

function readLocalPins(): LocalPins {
  try {
    const raw =
      localStorage.getItem(LOCAL_PINS_KEY) ??
      localStorage.getItem(LEGACY_PEER_PINS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<
      string,
      Partial<LocalPin> & { progress?: number }
    >;
    if (!parsed || typeof parsed !== "object") return {};
    const next: LocalPins = {};
    for (const [id, pin] of Object.entries(parsed)) {
      if (
        typeof pin?.x === "number" &&
        typeof pin?.y === "number" &&
        Number.isFinite(pin.x) &&
        Number.isFinite(pin.y)
      ) {
        next[id] = {
          x: pin.x,
          y: pin.y,
          facing: pin.facing === -1 ? -1 : 1,
        };
        continue;
      }
      // 예전 progress 핀 → 대략 상단 좌표로 마이그레이션
      if (typeof pin?.progress === "number" && Number.isFinite(pin.progress)) {
        const w = typeof window !== "undefined" ? window.innerWidth : 1280;
        const h = typeof window !== "undefined" ? window.innerHeight : 720;
        const pt = pointOnBorder(w, h, FIXED_INSET, pin.progress, "all");
        next[id] = { x: pt.x, y: pt.y, facing: pt.facing };
      }
    }
    return next;
  } catch {
    return {};
  }
}

function writeLocalPins(next: LocalPins) {
  localStorage.setItem(LOCAL_PINS_KEY, JSON.stringify(next));
  localStorage.removeItem(LEGACY_PEER_PINS_KEY);
}

function isSelfMember(m: Member, selfId: string) {
  // 방에 들어간 뒤에는 실제 memberId만 본인으로 본다 (local 잔상과 중복 방지)
  if (selfId && selfId !== "local") return m.id === selfId;
  return m.id === "local";
}

function memberPathMode(
  m: Member,
  self: boolean,
  selfPathMode: PathMode,
  forceAll = false,
): PathMode {
  if (forceAll) return "all";
  if (self) return selfPathMode;
  const peerMode = m.state.pathMode;
  return peerMode && PATH_MODES.has(peerMode) ? peerMode : "all";
}

function memberInset(m: Member, self: boolean) {
  return self ? FIXED_INSET : 28 + m.offset;
}

function normalizeOverlayMembers(
  members: Member[],
  selfId: string,
  inRoom: boolean,
): Member[] {
  const filtered =
    inRoom && selfId !== "local"
      ? members.filter((m) => m.id !== "local")
      : members;
  const byId = new Map<string, Member>();
  for (const m of filtered) byId.set(m.id, m);
  return [...byId.values()];
}

export function OverlayApp() {
  useEffect(() => {
    document.body.classList.add("overlay-body");
    document.body.classList.remove("settings-body");
    void invokeSafe("set_click_through", { enabled: true });
  }, []);

  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [members, setMembers] = useState<Member[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [serverUrl, setServerUrl] = useState(resolveDefaultServerUrl);
  const [buddyDefs, setBuddyDefs] = useState<BuddyDef[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [chat, setChat] = useState("");
  const [inRoom, setInRoom] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [move, setMove] = useState<MoveSettings>(() => readMoveSettings());
  const [chatLog, setChatLog] = useState<ChatLogSettings>(() => readChatLogSettings());
  const [logLines, setLogLines] = useState<ChatMessage[]>([]);
  const [dragging, setDragging] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [composeMode, setComposeMode] = useState<"chat" | "status">("chat");
  const [repositionMode, setRepositionMode] = useState(false);
  const [localPins, setLocalPins] = useState<LocalPins>(() => readLocalPins());
  const [repositionDraft, setRepositionDraft] = useState<Record<string, LocalPin>>(
    {},
  );
  const [dragMemberId, setDragMemberId] = useState<string | null>(null);
  const [pendingInvite, setPendingInvite] = useState<FriendInviteRecvPayload | null>(
    () => readPendingInvite(),
  );
  const [overlayNotice, setOverlayNotice] = useState<OverlayNotice | null>(() => {
    const n = readOverlayNotice();
    if (!n) return null;
    if (Date.now() - n.at > OVERLAY_NOTICE_TTL_MS) {
      clearOverlayNotice();
      return null;
    }
    return n;
  });
  const [letterQueue, setLetterQueue] = useState<LetterItem[]>([]);
  const [eggQueue, setEggQueue] = useState<string[]>([]);
  const [letterPhase, setLetterPhase] = useState<
    "icon" | "opening" | "revealed" | null
  >(null);
  const [bomb, setBomb] = useState<BombState | null>(null);
  const [bombExplode, setBombExplode] = useState<BombExplodePayload | null>(
    null,
  );
  const [ladder, setLadder] = useState<LadderState | null>(null);
  const [ladderDismissed, setLadderDismissed] = useState(false);

  const chatInputRef = useRef<HTMLInputElement>(null);
  const selfIdRef = useRef<string>("local");
  const seenChat = useRef(new Set<string>());
  const lastTs = useRef(performance.now());
  const actorsRef = useRef<
    Array<{ x: number; y: number; isSelf: boolean; memberId: string }>
  >([]);
  const panelOpenRef = useRef(false);
  const chatLogRef = useRef(chatLog);
  const chatLogElRef = useRef<HTMLDivElement | null>(null);
  const chatLogListRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const repositionRef = useRef(false);
  /** Rust가 click-through를 강제로 바꾼 뒤 JS lastCapture와 어긋날 때 재동기화 */
  const clickThroughSyncGenRef = useRef(0);
  const sizeRef = useRef(size);
  const moveRef = useRef(move);
  const membersRef = useRef(members);
  const localPinsRef = useRef(localPins);
  const repositionDraftRef = useRef(repositionDraft);
  const repositionSnapshotRef = useRef<Record<string, MemberPose> | null>(null);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    moved: boolean;
    memberId: string;
    isSelf: boolean;
  } | null>(null);
  /** Win+Shift+S 영역 선택 중 — 캡처 화면처럼 이동 정지 */
  const captureFreezeRef = useRef(false);
  const captureFreezeStickyUntilRef = useRef(0);
  /** 오버레이 가이드 진행 중 — 클릭 통과 비활성 */
  const guideActiveRef = useRef(false);
  /** 설정 창 가이드 중 — 오버레이가 클릭을 가로채지 않음 (설정 창이 실제로 보일 때만) */
  const settingsGuidePassRef = useRef(false);
  const settingsVisibleRef = useRef(false);
  /** 초대 말풍선(입장/거절) 표시 중 — 클릭 통과 비활성 */
  const inviteUiRef = useRef(false);
  /** 편지/계란 클릭 캡처 범위: none | icon(하단) | full */
  const effectHitRef = useRef<"none" | "icon" | "full">("none");
  /** 폭탄 홀더일 때 캐릭터 주변 히트 확장 */
  const bombHolderRef = useRef(false);
  /** 이미 재생한 폭발 at — 설정창 sync로 짧게 재재생되는 것 방지 */
  const playedExplodeAtRef = useRef(0);
  const recentSelfLetters = useRef<Array<{ text: string; at: number }>>([]);  const recentSelfEggs = useRef<number[]>([]);

  const guide = useProductGuide({
    windowKind: "overlay",
    userId: readDeviceIdentity().userId,
    onMarkSeen: requestServerGuideMarkSeen,
  });
  guideActiveRef.current = guide.activeForWindow;
  // 설정 phase 세션만 있고 설정 창이 안 보이면 클릭 통과 강제하지 않음
  settingsGuidePassRef.current = Boolean(
    guide.session?.active &&
      guide.session.phase === "settings" &&
      settingsVisibleRef.current,
  );
  inviteUiRef.current = Boolean(pendingInvite);

  useEffect(() => {
    const syncInvite = () => setPendingInvite(readPendingInvite());
    const syncNotice = () => {
      const n = readOverlayNotice();
      if (!n || Date.now() - n.at > OVERLAY_NOTICE_TTL_MS) {
        if (n) clearOverlayNotice();
        setOverlayNotice(null);
        return;
      }
      setOverlayNotice(n);
    };
    const syncGames = () => {
      const g = readGameState();
      if (!g) {
        setBomb(null);
        setLadder(null);
        // 폭발 연출 중이면 유지
        setBombExplode((prev) =>
          prev && Date.now() - prev.at < 3000 ? prev : null,
        );
        return;
      }
      setBomb((prev) => {
        // 로컬 폭발 직후면 bomb null 유지
        if (!g.bomb && prev && g.bombExplode) return null;
        if (g.bomb && g.bomb.endsAt <= Date.now() && !g.bombExplode) {
          return null;
        }
        return g.bomb;
      });
      setBombExplode((prev) => {
        if (g.bombExplode) {
          if (g.bombExplode.at === playedExplodeAtRef.current) return null;
          if (prev && prev.at === g.bombExplode.at) return prev;
          if (prev && Date.now() - prev.at < 1800) return prev;
          return g.bombExplode;
        }
        if (prev && Date.now() - prev.at < 1800) return prev;
        return null;
      });
      setLadder((prev) => {
        if (!g.ladder) return null;
        const next = g.ladder;
        if (
          prev &&
          prev.phase === next.phase &&
          prev.hostMemberId === next.hostMemberId &&
          prev.memberIds.join("|") === next.memberIds.join("|") &&
          prev.names.join("|") === next.names.join("|") &&
          prev.outcomes.join("|") === next.outcomes.join("|") &&
          prev.rungs.length === next.rungs.length
        ) {
          return prev;
        }
        if (
          !prev ||
          prev.phase !== next.phase ||
          prev.hostMemberId !== next.hostMemberId ||
          prev.names.join("|") !== next.names.join("|")
        ) {
          setLadderDismissed(false);
        }
        return next;
      });
    };
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === PENDING_INVITE_KEY ||
        e.key === OVERLAY_NOTICE_KEY ||
        e.key === GAME_STATE_KEY ||
        e.key == null
      ) {
        syncInvite();
        syncNotice();
        syncGames();
      }
    };
    window.addEventListener(PENDING_INVITE_EVENT, syncInvite);
    window.addEventListener(OVERLAY_NOTICE_EVENT, syncNotice);
    window.addEventListener(GAME_STATE_EVENT, syncGames);
    window.addEventListener("storage", onStorage);
    syncGames();
    const id = window.setInterval(() => {
      syncInvite();
      syncNotice();
      syncGames();
    }, 400);
    return () => {
      window.removeEventListener(PENDING_INVITE_EVENT, syncInvite);
      window.removeEventListener(OVERLAY_NOTICE_EVENT, syncNotice);
      window.removeEventListener(GAME_STATE_EVENT, syncGames);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!overlayNotice) return;
    const remain = Math.max(50, OVERLAY_NOTICE_TTL_MS - (Date.now() - overlayNotice.at));
    const t = window.setTimeout(() => {
      clearOverlayNotice();
      setOverlayNotice(null);
    }, remain);
    return () => window.clearTimeout(t);
  }, [overlayNotice]);

  // endsAt 도달 시 1회만 폭발 (at=endsAt 고정 → 서버 이벤트와 중복 재생 방지)
  useEffect(() => {
    if (!bomb || bombExplode) return;
    if (playedExplodeAtRef.current === bomb.endsAt) return;
    const delay = Math.max(0, bomb.endsAt - Date.now());
    const snap = bomb;
    const t = window.setTimeout(() => {
      setBombExplode((prev) => {
        if (prev) return prev;
        if (playedExplodeAtRef.current === snap.endsAt) return null;
        return {
          holderMemberId: snap.holderMemberId,
          holderNickname: snap.holderNickname,
          at: snap.endsAt,
        };
      });
      setBomb(null);
    }, delay + 20);
    return () => window.clearTimeout(t);
  }, [bomb?.endsAt, bomb?.holderMemberId, bomb?.holderNickname, bombExplode]);

  useEffect(() => {
    if (!guide.activeForWindow || !guide.session) return;
    const step = guide.session.step;
    // 0: self only — 패널 닫기
    // 1: composer — 패널 열기
    // 2+: plus menu
    if (step <= 0) {
      setPanelOpen(false);
      setPlusOpen(false);
      setJoinOpen(false);
      setMoveOpen(false);
      return;
    }
    setPanelOpen(true);
    setMoveOpen(false);
    if (step >= 2) {
      setPlusOpen(true);
      setJoinOpen(false);
    } else {
      setPlusOpen(false);
      setJoinOpen(false);
    }
  }, [guide.activeForWindow, guide.session?.step]);

  // 설정 창 가이드 중엔 오버레이 패널을 닫아 전체 화면 클릭 가로채기 방지
  useEffect(() => {
    if (!guide.session?.active || guide.session.phase !== "settings") return;
    if (!settingsVisibleRef.current) return;
    setPanelOpen(false);
    setPlusOpen(false);
    setJoinOpen(false);
    setMoveOpen(false);
  }, [guide.session?.active, guide.session?.phase]);

  // 고아 settings 가이드 세션 정리 (강제 종료 후 캐릭터 클릭 먹통 방지)
  useEffect(() => {
    if (!isTauri()) {
      // 웹 프리뷰: 설정 창 없음 → settings phase 잔존 시 즉시 제거
      if (clearOrphanSettingsGuideSession(false)) {
        clickThroughSyncGenRef.current += 1;
      }
      return;
    }
    let alive = true;
    const sync = async () => {
      const visible = await invokeSafe<boolean>("is_settings_visible");
      if (!alive) return;
      const isVisible = visible === true;
      settingsVisibleRef.current = isVisible;
      if (clearOrphanSettingsGuideSession(isVisible)) {
        clickThroughSyncGenRef.current += 1;
        // 통과 고착 직후 캐시 무시하고 즉시 재적용
        void setClickThrough(true, true);
      }
    };
    void sync();
    const id = window.setInterval(() => void sync(), 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // TTL 등으로 이미 무효화된 세션이면 마운트 시 한 번 더 맞춤
  useEffect(() => {
    readGuideSession();
  }, []);

  const setCaptureFreeze = (frozen: boolean) => {
    if (frozen) {
      captureFreezeRef.current = true;
      // 감지 깜빡임으로 바로 풀리지 않게 최소 유지
      captureFreezeStickyUntilRef.current = Date.now() + 1200;
      return;
    }
    if (Date.now() < captureFreezeStickyUntilRef.current) return;
    captureFreezeRef.current = false;
  };

  panelOpenRef.current = panelOpen;
  chatLogRef.current = chatLog;
  draggingRef.current = dragging;
  repositionRef.current = repositionMode;
  sizeRef.current = size;
  moveRef.current = move;
  membersRef.current = members;
  localPinsRef.current = localPins;
  repositionDraftRef.current = repositionDraft;

  useLayoutEffect(() => {
    if (!chatLog.enabled) return;
    const el = chatLogListRef.current;
    if (!el) return;
    const pinToLatest = () => {
      el.scrollTop = el.scrollHeight;
    };
    pinToLatest();
    const frame = requestAnimationFrame(pinToLatest);
    return () => cancelAnimationFrame(frame);
  }, [logLines, chatLog.enabled]);

  const setDraggingNow = (v: boolean) => {
    draggingRef.current = v;
    setDragging(v);
  };

  const setLocalPinsNow = (updater: (prev: LocalPins) => LocalPins) => {
    setLocalPins((prev) => {
      const next = updater(prev);
      localPinsRef.current = next;
      writeLocalPins(next);
      return next;
    });
  };

  const clearLocalPins = () => {
    setLocalPinsNow((prev) => (Object.keys(prev).length ? {} : prev));
    setRepositionDraft({});
    repositionDraftRef.current = {};
    repositionSnapshotRef.current = null;
  };

  const patchMove = (partial: Partial<MoveSettings>) => {
    setMove((prev) => {
      const next = { ...prev, ...partial };
      writeMoveSettings(next);
      moveRef.current = next;
      return next;
    });
    // 피어에 바로 반영되도록 본인 CharState에도 심어 둠
    setMembers((prev) =>
      prev.map((m) => {
        if (!isSelfMember(m, selfIdRef.current) && m.id !== "local") return m;
        return {
          ...m,
          state: {
            ...m.state,
            ...(partial.speed != null ? { speed: partial.speed } : {}),
            ...(partial.pathMode != null ? { pathMode: partial.pathMode } : {}),
            ...(partial.walking != null
              ? { motion: partial.walking ? MOTION_WALK : MOTION_IDLE }
              : {}),
          },
        };
      }),
    );
  };

  useEffect(() => {
    void loadBuddyManifest().then((m) => setBuddyDefs(m.buddies));
  }, []);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const apply = () => {
      if (draggingRef.current) return;
      const profile = readProfile();
      const rt = readRuntime();
      const roomCode = readActiveRoomCode(rt);
      setServerUrl(rt?.serverUrl || profile.serverUrl || resolveDefaultServerUrl());
      selfIdRef.current = rt?.memberId || "local";
      setInRoom(Boolean(roomCode));
      setRoomCode(roomCode);
      setStatusMessage((profile.statusMessage || rt?.statusMessage || "").trim());
      // 미니게임: runtime이 설정↔오버레이 공통 경로 (gameState 키만으로는 놓칠 수 있음)
      if (rt && ("ladder" in rt || "bomb" in rt || "bombExplode" in rt)) {
        setBomb((prev) => {
          if (rt.bombExplode) return null;
          if (rt.bomb && rt.bomb.endsAt <= Date.now()) return null;
          if (rt.bomb) return rt.bomb;
          return rt.bomb ?? prev ?? null;
        });
        setBombExplode((prev) => {
          if (rt.bombExplode) {
            if (rt.bombExplode.at === playedExplodeAtRef.current) return null;
            if (prev && prev.at === rt.bombExplode.at) return prev;
            if (prev && Date.now() - prev.at < 1800) return prev;
            return rt.bombExplode;
          }
          if (prev && Date.now() - prev.at < 1800) return prev;
          return null;
        });
        setLadder((prev) => {
          const next = rt.ladder ?? null;
          if (!next) return null;
          if (
            prev &&
            prev.phase === next.phase &&
            prev.hostMemberId === next.hostMemberId &&
            prev.memberIds.join("|") === next.memberIds.join("|") &&
            prev.names.join("|") === next.names.join("|") &&
            prev.outcomes.join("|") === next.outcomes.join("|") &&
            prev.rungs.length === next.rungs.length
          ) {
            return prev;
          }
          if (
            !prev ||
            prev.phase !== next.phase ||
            prev.hostMemberId !== next.hostMemberId ||
            prev.names.join("|") !== next.names.join("|")
          ) {
            setLadderDismissed(false);
          }
          return next;
        });
      }
      const drafting = repositionRef.current;

      if (rt?.roomCode && rt.members?.length) {
        const list = normalizeOverlayMembers(
          rt.members,
          selfIdRef.current,
          true,
        );
        // 방을 떠난 멤버 핀 정리 (배치 중에는 건드리지 않음)
        if (!drafting) {
          setLocalPinsNow((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const id of Object.keys(next)) {
              if (!list.some((m) => m.id === id)) {
                delete next[id];
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }
        setMembers((prev) => {
          const byId = new Map(prev.map((m) => [m.id, m]));
          return list.map((m) => {
            const old = byId.get(m.id);
            const self = isSelfMember(m, selfIdRef.current);
            // 설정 창에서 고른 캐릭터를 오버레이 본인에게 즉시 반영
            const synced = self
              ? {
                  ...m,
                  nickname: profile.nickname || m.nickname,
                  character: profile.character,
                  statusMessage: (profile.statusMessage || "").trim(),
                }
              : m;
            const pin = localPinsRef.current[m.id];
            if (!old) {
              if (drafting || !pin) return synced;
              return {
                ...synced,
                state: { ...synced.state, motion: MOTION_IDLE },
              };
            }
            // 위치 고정 모드·고정 중에도 테두리 progress는 해제 후 복귀용으로 유지
            return {
              ...synced,
              state: {
                ...synced.state,
                progress: old.state.progress,
                edge: old.state.edge,
                facing: old.state.facing,
                motion:
                  drafting || pin
                    ? MOTION_IDLE
                    : self
                      ? moveRef.current.walking
                        ? MOTION_WALK
                        : MOTION_IDLE
                      : synced.state.motion,
                // 본인 이동 설정은 로컬이 권위, 피어는 수신 state 유지
                speed: self ? moveRef.current.speed : synced.state.speed,
                pathMode: self ? moveRef.current.pathMode : synced.state.pathMode,
              },
            };
          });
        });
      } else {
        // 방 밖: 항상 본인 하나만
        if (!drafting) {
          setLocalPinsNow((prev) => {
            const selfId = selfIdRef.current || "local";
            const selfPin = prev[selfId] ?? prev.local;
            if (!selfPin) {
              return Object.keys(prev).length ? {} : prev;
            }
            return { [selfId]: selfPin };
          });
        }
        setMembers((prev) => {
          const prevLocal = prev.find((m) => m.id === "local");
          const selfId = selfIdRef.current || "local";
          const pin = localPinsRef.current[selfId] ?? localPinsRef.current.local;
          const base = prevLocal?.state ?? defaultCharState(0.12);
          return [
            {
              id: "local",
              nickname: profile.nickname,
              character: profile.character,
              state: {
                ...base,
                motion:
                  drafting || pin
                    ? MOTION_IDLE
                    : moveRef.current.walking
                      ? MOTION_WALK
                      : MOTION_IDLE,
                speed: moveRef.current.speed,
                pathMode: moveRef.current.pathMode,
              },
              offset: 12,
              statusMessage: (profile.statusMessage || "").trim(),
            },
          ];
        });
      }

      const nextLog = recentPlainChats(rt?.messages);
      setLogLines((prev) => {
        const prevKey = prev.map((m) => m.id).join("|");
        const nextKey = nextLog.map((m) => m.id).join("|");
        return prevKey === nextKey ? prev : nextLog;
      });

      for (const msg of rt?.messages ?? []) {
        if (seenChat.current.has(msg.id)) continue;
        seenChat.current.add(msg.id);

        const selfId = selfIdRef.current;
        const fromSelf =
          msg.memberId === selfId ||
          (selfId === "local" && msg.memberId === "local");
        // 지정 편지/계란: 대상 닉만 연출 (보낸 사람·다른 멤버 제외)
        if (msg.targetNickname) {
          if (fromSelf) continue;
          const myNick =
            (rt?.members?.find((m) => m.id === selfId)?.nickname ||
              profile.nickname ||
              "").trim();
          if (!myNick || !nicknamesEqual(myNick, msg.targetNickname)) continue;
        }

        if (msg.kind === "egg" || isEggChat(msg.text || "")) {
          if (fromSelf) {
            const now = Date.now();
            const idx = recentSelfEggs.current.findIndex((at) => now - at < 12000);
            if (idx >= 0) {
              recentSelfEggs.current.splice(idx, 1);
              continue;
            }
          }
          setEggQueue((prev) => (prev.includes(msg.id) ? prev : [...prev, msg.id]));
          continue;
        }
        const letterBody =
          msg.kind === "letter"
            ? (msg.text || "").trim()
            : (() => {
                const parsed = parseLetterChat(msg.text || "");
                return parsed.kind === "letter" ? parsed.text : "";
              })();
        if (msg.kind === "letter" || letterBody) {
          const text = letterBody;
          if (!text) continue;
          if (fromSelf) {
            const now = Date.now();
            const idx = recentSelfLetters.current.findIndex(
              (p) => p.text === text && now - p.at < 12000,
            );
            if (idx >= 0) {
              recentSelfLetters.current.splice(idx, 1);
              continue;
            }
          }
          setLetterQueue((prev) => {
            if (prev.some((l) => l.id === msg.id)) return prev;
            return [
              ...prev,
              {
                id: msg.id,
                nickname: (msg.nickname || "").trim() || "친구",
                text,
              },
            ];
          });
          continue;
        }
        setBubbles((prev) => [
          ...prev.filter(
            (b) => b.until > Date.now() && b.memberId !== msg.memberId,
          ),
          {
            memberId: msg.memberId,
            text: msg.text,
            until: Date.now() + BUBBLE_TTL_MS,
            id: msg.id,
          },
        ]);
      }
    };

    apply();
    const id = window.setInterval(apply, 350);
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === ROOM_KEY ||
        e.key === RUNTIME_KEY ||
        e.key === "monibuddy.profile.v1"
      ) {
        apply();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("monibuddy:profile", apply);
    window.addEventListener("monibuddy:room", apply);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("monibuddy:profile", apply);
      window.removeEventListener("monibuddy:room", apply);
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const frozen = await invokeSafe<boolean>("is_capture_freeze");
      if (!cancelled && frozen != null) setCaptureFreeze(frozen);
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;
        unlisten = await listen<boolean>("capture-freeze", (ev) => {
          setCaptureFreeze(Boolean(ev.payload));
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTs.current) / 1000);
      lastTs.current = now;
      if (
        !draggingRef.current &&
        !captureFreezeRef.current &&
        !repositionRef.current
      ) {
        const { speed, walking, pathMode } = moveRef.current;
        const pins = localPinsRef.current;
        setMembers((prev) =>
          prev.map((m) => {
            const self = isSelfMember(m, selfIdRef.current);
            if (pins[m.id]) {
              // 로컬 고정: 이 기기에서는 멈춤
              if (m.state.motion === "idle") return m;
              return { ...m, state: { ...m.state, motion: MOTION_IDLE } };
            }
            if (self && !walking) {
              if (m.state.motion === "idle" && m.state.speed === speed && m.state.pathMode === pathMode) {
                return m;
              }
              return {
                ...m,
                state: { ...m.state, motion: MOTION_IDLE, speed, pathMode },
              };
            }
            if (m.state.motion !== "walk") {
              // 피어 idle이어도 speed/pathMode는 최신 수신값 유지
              return m;
            }
            const walkSpeed = self
              ? speed
              : typeof m.state.speed === "number"
                ? m.state.speed
                : speed * 0.9;
            const mode = memberPathMode(m, self, pathMode);
            const inset = memberInset(m, self);
            const progress = advanceProgress(m.state.progress, dt, walkSpeed);
            const pt = pointOnBorder(size.w, size.h, inset, progress, mode);
            return {
              ...m,
              state: {
                ...m.state,
                progress,
                edge: pt.edge,
                facing: pt.facing,
                ...(self ? { speed, pathMode } : {}),
              },
            };
          }),
        );
      }
      setBubbles((prev) => prev.filter((b) => b.until > Date.now()));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size.w, size.h]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const me =
        members.find((m) => m.id === selfIdRef.current) ||
        members.find((m) => m.id === "local");
      if (!me) return;
      localStorage.setItem(
        "monibuddy.selfState.v1",
        JSON.stringify({ state: me.state, at: Date.now() }),
      );
    }, 200);
    return () => window.clearInterval(id);
  }, [members]);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let lastCapture: boolean | null = null;
    let lastSyncGen = -1;
    let lastForceAt = 0;
    const loop = async () => {
      while (alive) {
        try {
          const frozen = await invokeSafe<boolean>("is_capture_freeze");
          if (frozen != null) setCaptureFreeze(frozen);
          const pos = await invokeSafe<[number, number]>("get_cursor_pos");
          if (!pos) {
            await new Promise((r) => setTimeout(r, 80));
            continue;
          }
          const [cx, cy] = pos;
          const { w, h } = sizeRef.current;
          // 히스테리시스: 한 번 잡히면 살짝 넓게 유지해 경계에서 토글/커서 깜빡임 방지
          const hitPad = lastCapture ? HIT_PAD + 18 : HIT_PAD;
          // 폭탄 홀더 메뉴는 캐릭터 주변만 확장 (전체 화면 캡처 금지)
          const bombPad = bombHolderRef.current ? 90 : 0;
          const overActor = actorsRef.current.some((a) => {
            const near =
              Math.abs(cx - a.x) <= hitPad + (a.isSelf ? bombPad : 0) &&
              Math.abs(cy - a.y) <= hitPad + (a.isSelf ? bombPad : 0);
            if (!near) return false;
            // 상대는 위치 고정 모드에서만 클릭 가능
            return a.isSelf || repositionRef.current;
          });
          const overChat =
            panelOpenRef.current &&
            !repositionRef.current &&
            cy >= h - 300 &&
            Math.abs(cx - w / 2) <= 360;
          const logEl = chatLogElRef.current;
          const logBox = logEl?.getBoundingClientRect();
          const overChatLog = Boolean(
            chatLogRef.current.enabled &&
              logBox &&
              cx >= logBox.left - 6 &&
              cx <= logBox.right + 6 &&
              cy >= logBox.top - 6 &&
              cy <= logBox.bottom + 6,
          );
          const overRepositionBar =
            repositionRef.current &&
            cy >= h - 90 &&
            Math.abs(cx - w / 2) <= 220;
          const overInvite =
            inviteUiRef.current &&
            actorsRef.current.some((a) => {
              if (!a.isSelf) return false;
              // 초대 말풍선은 캐릭터 위에 붙음 — 세로로 넉넉히
              return (
                Math.abs(cx - a.x) <= hitPad + 70 &&
                cy <= a.y + hitPad &&
                cy >= a.y - 140
              );
            });
          const effectHit = effectHitRef.current;
          const overLetterIcon =
            effectHit === "icon" &&
            cy >= h * 0.55 &&
            cy <= h * 0.95 &&
            Math.abs(cx - w / 2) <= 140;
          const overEffectFull = effectHit === "full";
          // 설정 창 가이드가 떠 있으면 무조건 클릭 통과 — 안 그러면
          // 풀스크린 오버레이가 설정 가이드 입력을 가로채 깜빡임/먹통 발생
          const capture = settingsGuidePassRef.current
            ? false
            : guideActiveRef.current ||
              overInvite ||
              overLetterIcon ||
              overEffectFull ||
              overActor ||
              overChat ||
              overChatLog ||
              overRepositionBar ||
              draggingRef.current ||
              repositionRef.current ||
              (panelOpenRef.current && !repositionRef.current);
          const syncGen = clickThroughSyncGenRef.current;
          const now = Date.now();
          // capture 중 주기 재적용 + 통과 모드에서도 안전망 재적용
          // (양보/실패로 ignore 상태가 어긋나면 화면 클릭 먹통)
          const forceResync =
            syncGen !== lastSyncGen ||
            (capture && now - lastForceAt >= 500) ||
            (!capture && now - lastForceAt >= 1500);
          if (lastCapture !== capture || forceResync) {
            lastSyncGen = syncGen;
            lastForceAt = now;
            const ok = await setClickThrough(!capture, forceResync);
            lastCapture = ok ? capture : null;
          }
        } catch {
          lastCapture = null;
        }
        await new Promise((r) => setTimeout(r, 80));
      }
    };
    void loop();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!panelOpen || repositionMode) return;
    const t = window.setTimeout(() => chatInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [panelOpen, repositionMode]);

  const setDraftPos = (memberId: string, x: number, y: number, facing: 1 | -1) => {
    const { w, h } = sizeRef.current;
    const clamped = clampFreePos(x, y, w, h);
    clamped.facing = facing;
    setRepositionDraft((prev) => {
      const next = { ...prev, [memberId]: clamped };
      repositionDraftRef.current = next;
      return next;
    });
  };

  const moveMemberFree = (
    memberId: string,
    x: number,
    y: number,
    facing: 1 | -1,
  ) => {
    setDraftPos(memberId, x, y, facing);
  };

  const moveMemberOnBorder = (
    memberId: string,
    isSelf: boolean,
    x: number,
    y: number,
  ) => {
    const member = membersRef.current.find((m) => m.id === memberId);
    if (!member) return;
    const mode = memberPathMode(member, isSelf, moveRef.current.pathMode, false);
    const inset = memberInset(member, isSelf);
    const progress = nearestProgressOnBorder(
      sizeRef.current.w,
      sizeRef.current.h,
      inset,
      x,
      y,
      mode,
    );
    const pt = pointOnBorder(
      sizeRef.current.w,
      sizeRef.current.h,
      inset,
      progress,
      mode,
    );
    setMembers((prev) => {
      const next = prev.map((m) => {
        if (m.id !== memberId) return m;
        return {
          ...m,
          state: {
            ...m.state,
            progress,
            edge: pt.edge,
            facing: pt.facing,
            motion: MOTION_IDLE,
          },
        };
      });
      membersRef.current = next;
      return next;
    });
    return { progress, facing: pt.facing as 1 | -1, x: pt.x, y: pt.y };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      // 위치 고정 모드가 아니면 본인만 바로 드래그
      if (!repositionRef.current && !start.isSelf) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!start.moved && dx * dx + dy * dy > 36) {
        start.moved = true;
        setDraggingNow(true);
        setDragMemberId(start.memberId);
        if (start.isSelf && !repositionRef.current) {
          patchMove({ walking: false });
        }
      }
      if (!start.moved) return;

      if (repositionRef.current) {
        const prev =
          repositionDraftRef.current[start.memberId] ??
          localPinsRef.current[start.memberId];
        const facing: 1 | -1 =
          Math.abs(dx) > 2 ? (dx >= 0 ? 1 : -1) : (prev?.facing ?? 1);
        moveMemberFree(start.memberId, e.clientX, e.clientY, facing);
        return;
      }

      // 일반 모드: 이미 자유 고정된 본인이면 자유 이동, 아니면 테두리
      if (localPinsRef.current[start.memberId]) {
        const prev = localPinsRef.current[start.memberId];
        const facing: 1 | -1 =
          Math.abs(dx) > 2 ? (dx >= 0 ? 1 : -1) : (prev?.facing ?? 1);
        const { w, h } = sizeRef.current;
        const clamped = clampFreePos(e.clientX, e.clientY, w, h);
        clamped.facing = facing;
        setLocalPinsNow((p) => ({ ...p, [start.memberId]: clamped }));
      } else {
        moveMemberOnBorder(start.memberId, start.isSelf, e.clientX, e.clientY);
      }
    };

    const onUp = () => {
      dragStartRef.current = null;
      setDragMemberId(null);
      setDraggingNow(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [size.w, size.h]);

  const startRepositionMode = () => {
    const { w, h } = sizeRef.current;
    const selfPath = moveRef.current.pathMode;
    const snapshot: Record<string, MemberPose> = {};
    const draft: Record<string, LocalPin> = {};

    for (const m of membersRef.current) {
      const self = isSelfMember(m, selfIdRef.current);
      const inset = memberInset(m, self);
      const pin = localPinsRef.current[m.id];
      const mode = memberPathMode(m, self, selfPath, false);
      const border = pointOnBorder(w, h, inset, m.state.progress, mode);
      const free = pin
        ? { ...pin }
        : clampFreePos(border.x, border.y, w, h);
      free.facing = pin?.facing ?? border.facing;
      draft[m.id] = free;
      snapshot[m.id] = {
        progress: m.state.progress,
        edge: m.state.edge,
        facing: m.state.facing,
        motion: m.state.motion,
        free: pin ? { ...pin } : undefined,
      };
    }

    repositionSnapshotRef.current = snapshot;
    repositionDraftRef.current = draft;
    setRepositionDraft(draft);
    setMembers((prev) =>
      prev.map((m) => ({
        ...m,
        state: { ...m.state, motion: MOTION_IDLE },
      })),
    );
    setPlusOpen(false);
    setMoveOpen(false);
    setJoinOpen(false);
    setRepositionMode(true);
    clickThroughSyncGenRef.current += 1;
    void invokeSafe("set_click_through", { enabled: false });
  };

  const restoreRepositionSnapshot = () => {
    const snapshot = repositionSnapshotRef.current;
    if (!snapshot) return;
    setMembers((prev) =>
      prev.map((m) => {
        const pose = snapshot[m.id];
        if (!pose) return m;
        return {
          ...m,
          state: {
            ...m.state,
            progress: pose.progress,
            edge: pose.edge,
            facing: pose.facing,
            motion: pose.motion,
          },
        };
      }),
    );
    // 배치 전 고정 좌표 복원
    setLocalPinsNow(() => {
      const restored: LocalPins = {};
      for (const [id, pose] of Object.entries(snapshot)) {
        if (pose.free) restored[id] = pose.free;
      }
      return restored;
    });
  };

  const confirmRepositionMode = () => {
    const draft = repositionDraftRef.current;
    setLocalPinsNow(() => ({ ...draft }));
    patchMove({ walking: false });
    repositionSnapshotRef.current = null;
    repositionDraftRef.current = {};
    setRepositionDraft({});
    setRepositionMode(false);
    setMoveOpen(true);
  };

  const cancelRepositionMode = (reopenMove = true) => {
    restoreRepositionSnapshot();
    repositionSnapshotRef.current = null;
    repositionDraftRef.current = {};
    setRepositionDraft({});
    setRepositionMode(false);
    if (reopenMove) setMoveOpen(true);
  };

  const endRepositionMode = (reopenMove = true) => {
    // 닫기/패널 전환 시 미적용 배치는 취소
    cancelRepositionMode(reopenMove);
  };

  const openPanel = () => {
    setPlusOpen(false);
    setMoveOpen(false);
    setJoinOpen(false);
    setJoinCode("");
    setComposeMode("chat");
    if (repositionRef.current) cancelRepositionMode(false);
    else setRepositionMode(false);
    // ref를 먼저 올려 폴링 루프가 바로 capture로 인식하게
    panelOpenRef.current = true;
    setPanelOpen(true);
    clickThroughSyncGenRef.current += 1;
    void invokeSafe("set_click_through", { enabled: false });
  };

  const closePanel = () => {
    if (repositionRef.current) cancelRepositionMode(false);
    panelOpenRef.current = false;
    setPanelOpen(false);
    setPlusOpen(false);
    setMoveOpen(false);
    setJoinOpen(false);
    setJoinCode("");
    setComposeMode("chat");
    setRepositionMode(false);
    setChat("");
    clickThroughSyncGenRef.current += 1;
    void invokeSafe("set_click_through", { enabled: true });
  };

  const togglePanel = () => {
    if (panelOpenRef.current) closePanel();
    else openPanel();
  };

  const queueRoomAction = (
    action:
      | { action: "create" }
      | { action: "join"; code: string }
      | { action: "leave" },
  ) => {
    localStorage.setItem(
      PENDING_ROOM_KEY,
      JSON.stringify({ ...action, at: Date.now() }),
    );
    window.dispatchEvent(new Event("monibuddy:pendingRoom"));
    void invokeSafe("show_settings");
    closePanel();
  };

  const openBuddyTab = (tab: "character" | "quests") => {
    localStorage.setItem(
      "monibuddy.openBuddy.v1",
      JSON.stringify({ at: Date.now(), tab }),
    );
    window.dispatchEvent(new Event("monibuddy:openBuddy"));
    void invokeSafe("show_settings");
    closePanel();
  };

  const insertCommand = (draft: string) => {
    setPlusOpen(false);
    setJoinOpen(false);
    setMoveOpen(false);
    setComposeMode("chat");
    setChat(draft);
    window.setTimeout(() => chatInputRef.current?.focus(), 30);
  };

  const sendChat = () => {
    const raw = chat.trim();
    if (composeMode === "status") {
      const text = raw.slice(0, 40);
      const next = writeStatusMessage(text);
      setStatusMessage(next);
      setChat("");
      setComposeMode("chat");
      setPlusOpen(false);
      setMoveOpen(false);
      return;
    }
    if (!raw) return;

    const rtNow = readRuntime();
    const roomNow = readActiveRoomCode(rtNow);
    const looksInRoom =
      Boolean(roomNow) ||
      inRoom ||
      (selfIdRef.current !== "local" &&
        members.some((m) => m.id === selfIdRef.current));
    const mini = parseMiniGameChat(raw);
    if (mini.kind !== "none") {
      // React inRoom / runtime 동기 지연 대비 — 둘 중 하나라도 방이면 전송
      if (!looksInRoom) {
        writeOverlayNotice("방에 들어간 뒤 /사다리 · /폭탄 을 쓸 수 있어요");
        return;
      }
      localStorage.setItem(
        PENDING_CHAT_KEY,
        JSON.stringify({ text: raw, at: Date.now() }),
      );
      window.dispatchEvent(new Event("monibuddy:pendingChat"));
      if (mini.kind === "ladder-open") {
        writeGamePending({ type: "ladder-open", at: Date.now() });
      }
      setChat("");
      setPlusOpen(false);
      setMoveOpen(false);
      closePanel();
      return;
    }

    const roomNicks = members
      .map((m) => m.nickname?.trim())
      .filter((n): n is string => Boolean(n));
    const effect = parseEffectChat(raw, roomNicks);

    if (effect.kind === "egg") {
      if (!effect.text) return;
      // 지정 계란은 상대만 봄 — 보낸 사람은 로컬 연출 생략
      if (!effect.targetNickname) {
        recentSelfEggs.current.push(Date.now());
        setEggQueue((prev) => [...prev, `local-egg-${Date.now()}`]);
      }
      const outbound = effect.targetNickname
        ? `/계란 ${effect.targetNickname}`
        : "/계란";
      localStorage.setItem(
        PENDING_CHAT_KEY,
        JSON.stringify({ text: outbound, at: Date.now() }),
      );
      window.dispatchEvent(new Event("monibuddy:pendingChat"));
      setChat("");
      setPlusOpen(false);
      setMoveOpen(false);
      return;
    }

    if (effect.kind === "letter") {
      if (!effect.text) return;
      const text = effect.text.slice(0, MAX_CHAT_LENGTH);
      // 지정 편지는 상대만 봄 — 보낸 사람은 로컬 연출 생략
      if (!effect.targetNickname) {
        const nick = (readProfile().nickname || "").trim() || "나";
        recentSelfLetters.current.push({ text, at: Date.now() });
        setLetterQueue((prev) => [
          ...prev,
          { id: `local-letter-${Date.now()}`, nickname: nick, text },
        ]);
      }
      const outbound = effect.targetNickname
        ? `/편지 @${effect.targetNickname} ${text}`
        : `/편지 ${text}`;
      localStorage.setItem(
        PENDING_CHAT_KEY,
        JSON.stringify({ text: outbound, at: Date.now() }),
      );
      window.dispatchEvent(new Event("monibuddy:pendingChat"));
      setChat("");
      setPlusOpen(false);
      setMoveOpen(false);
      return;
    }

    const chatText = effect.text.slice(0, MAX_CHAT_LENGTH);
    if (!chatText) return;

    const selfId = selfIdRef.current || "local";
    const optimisticId = `local-${Date.now()}`;
    setBubbles((prev) => [
      ...prev.filter((b) => b.until > Date.now() && b.memberId !== selfId),
      {
        memberId: selfId,
        text: chatText,
        until: Date.now() + BUBBLE_TTL_MS,
        id: optimisticId,
      },
    ]);
    seenChat.current.add(optimisticId);

    localStorage.setItem(
      PENDING_CHAT_KEY,
      JSON.stringify({ text: chatText, at: Date.now() }),
    );
    window.dispatchEvent(new Event("monibuddy:pendingChat"));
    setChat("");
    setPlusOpen(false);
    setMoveOpen(false);
  };

  const actors = useMemo(() => {
    return members.map((m) => {
      const self = isSelfMember(m, selfIdRef.current);
      const inset = memberInset(m, self);
      const pinned = Boolean(localPins[m.id]);
      const free =
        (repositionMode ? repositionDraft[m.id] : undefined) ?? localPins[m.id];
      const mode = memberPathMode(m, self, move.pathMode, false);
      const border = pointOnBorder(size.w, size.h, inset, m.state.progress, mode);
      const x = free?.x ?? border.x;
      const y = free?.y ?? border.y;
      const facing = free?.facing ?? border.facing;
      const edge = free ? ("bottom" as const) : border.edge;
      const bubble = bubbles.find((b) => b.memberId === m.id);
      return {
        member: m,
        x,
        y,
        edge,
        facing,
        bubble,
        isSelf: self,
        pinned,
      };
    });
  }, [
    members,
    size,
    bubbles,
    move.pathMode,
    localPins,
    repositionMode,
    repositionDraft,
  ]);

  actorsRef.current = actors.map((a) => ({
    x: a.x,
    y: a.y,
    isSelf: a.isSelf,
    memberId: a.member.id,
  }));

  const hasLocalPins = Object.keys(localPins).length > 0;
  const activeLetter = letterQueue[0] ?? null;
  const activeEgg = !activeLetter ? (eggQueue[0] ?? null) : null;
  const selfMemberId = (() => {
    if (selfIdRef.current && selfIdRef.current !== "local") {
      return selfIdRef.current;
    }
    const rt = readRuntime();
    return rt?.memberId && rt.memberId !== "local" ? rt.memberId : null;
  })();

  // 폭발: 당사자만 전체 연출, 나머지는 말풍선·알림만
  // selfMemberId 선언 이후에 둬야 렌더 중 TDZ로 오버레이가 죽지 않음
  useEffect(() => {
    if (!bombExplode) return;
    const nick = bombExplode.holderNickname || "누군가";
    const victimId = bombExplode.holderMemberId;
    const isVictim = Boolean(selfMemberId && selfMemberId === victimId);

    setBubbles((prev) => [
      ...prev.filter((b) => b.until > Date.now() && b.memberId !== victimId),
      {
        memberId: victimId,
        text: isVictim ? "💥 터졌다!" : `💥 ${nick} 터짐!`,
        until: Date.now() + Math.max(BUBBLE_TTL_MS, 3200),
        id: `bomb-boom-${bombExplode.at}`,
      },
    ]);
    if (!isVictim) {
      writeOverlayNotice(`${nick}님의 폭탄이 터졌어요!`);
    }

    if (isVictim) return;
    const t = window.setTimeout(() => {
      playedExplodeAtRef.current = bombExplode.at;
      setBombExplode(null);
    }, 2800);
    return () => window.clearTimeout(t);
  }, [
    bombExplode?.at,
    bombExplode?.holderMemberId,
    bombExplode?.holderNickname,
    selfMemberId,
  ]);

  const bombIsHolder = Boolean(
    bomb && selfMemberId && bomb.holderMemberId === selfMemberId,
  );
  bombHolderRef.current = bombIsHolder;
  const showLadder = Boolean(ladder && !ladderDismissed);
  // 폭탄 진행 중 전체 화면 캡처 금지 → 클릭 먹통 유발.
  // 홀더는 캐릭터 주변 hitPad 확장으로 처리.
  effectHitRef.current = activeEgg || showLadder
    ? "full"
    : letterPhase === "icon"
      ? "icon"
      : letterPhase === "opening" || letterPhase === "revealed"
        ? "full"
        : "none";
  const runtimeForNicks = readRuntime();
  const roomNicksForDraft = [
    ...members.map((m) => m.nickname?.trim() ?? ""),
    ...(runtimeForNicks?.members ?? []).map((m) => m.nickname?.trim() ?? ""),
  ].filter((n, i, arr) => Boolean(n) && arr.indexOf(n) === i);
  const effectDraft =
    composeMode === "chat" ? parseEffectChat(chat, roomNicksForDraft) : null;
  const eggDraft = effectDraft?.kind === "egg";
  const letterDraft = composeMode === "chat" && isLetterChatDraft(chat);
  const bombDraft = composeMode === "chat" && isBombChatDraft(chat);
  const ladderDraft = composeMode === "chat" && isLadderChatDraft(chat);
  const bombParse = bombDraft ? parseMiniGameChat(chat) : null;
  const letterCmdTip = letterDraft
    ? effectDraft?.targetNickname
      ? `@${effectDraft.targetNickname} 에게 보내요`
      : "특정 사람은 @닉네임. 예: /편지 @혜수 안녕"
    : null;
  const eggCmdTip = eggDraft
    ? effectDraft?.targetNickname
      ? `@${effectDraft.targetNickname} 에게 보내요`
      : "방 전체에게 보내요. 특정 사람은 @닉네임"
    : null;
  const ladderCmdTip = ladderDraft ? "참가자 사다리를 열어요" : null;
  const bombCmdTip = bombDraft
    ? bombParse?.kind === "bomb-pass"
      ? "폭탄을 클릭하거나 /폭탄 넘겨 [닉] 으로 넘길 수 있어요"
      : bombParse?.kind === "bomb-start"
        ? bombParse.random
          ? "랜덤 초로 시작해요 (시간은 비밀)"
          : "초를 정했어요 (시간은 참가자에게 비밀)"
        : "예: /폭탄 30 또는 /폭탄 랜덤  (5~120초)"
    : null;
  // 대상이 잡히면 본문 유무와 관계없이 →닉 (전원은 대상 없을 때만)
  const targetHint = effectDraft?.targetNickname
    ? `→${effectDraft.targetNickname}`
    : "전원";
  const chatMaxLen =
    letterDraft || eggDraft || bombDraft || ladderDraft
      ? MAX_CHAT_LENGTH + 40
      : composeMode === "status"
        ? 40
        : MAX_CHAT_LENGTH;
  const peerNicksForBomb = members
    .filter((m) => m.id !== bomb?.holderMemberId && m.id !== "local")
    .map((m) => m.nickname?.trim() ?? "")
    .filter(Boolean);

  return (
    <div className="overlay-root">
      {chatLog.enabled ? (
        <aside
          ref={chatLogElRef}
          className="chat-log"
          style={{
            ["--log-opacity" as string]: String(chatLog.opacity),
            width: chatLog.width,
            ...(chatLog.x != null && chatLog.y != null
              ? { left: chatLog.x, top: chatLog.y, bottom: "auto" }
              : {}),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            className="chat-log-resize"
            aria-hidden
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const handle = e.currentTarget;
              handle.setPointerCapture(e.pointerId);
              const startX = e.clientX;
              const startW = chatLog.width;
              const onMove = (ev: PointerEvent) => {
                const width = clampChatLogWidth(startW + (ev.clientX - startX));
                setChatLog((prev) =>
                  prev.width === width ? prev : { ...prev, width },
                );
              };
              const onUp = (ev: PointerEvent) => {
                handle.removeEventListener("pointermove", onMove);
                handle.removeEventListener("pointerup", onUp);
                handle.removeEventListener("pointercancel", onUp);
                const width = clampChatLogWidth(startW + (ev.clientX - startX));
                setChatLog((prev) => {
                  const next = { ...prev, width };
                  writeChatLogSettings(next);
                  return next;
                });
              };
              handle.addEventListener("pointermove", onMove);
              handle.addEventListener("pointerup", onUp);
              handle.addEventListener("pointercancel", onUp);
            }}
          />
          <div
            className="chat-log-head"
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest(".chat-log-close")) return;
              e.stopPropagation();
              e.preventDefault();
              const head = e.currentTarget;
              head.setPointerCapture(e.pointerId);
              const box = chatLogElRef.current?.getBoundingClientRect();
              const originX = box?.left ?? 16;
              const originY = box?.top ?? 16;
              const panelW = box?.width ?? chatLog.width;
              const panelH = box?.height ?? 260;
              const startX = e.clientX;
              const startY = e.clientY;
              const onMove = (ev: PointerEvent) => {
                const pos = clampChatLogPos(
                  originX + (ev.clientX - startX),
                  originY + (ev.clientY - startY),
                  panelW,
                  panelH,
                );
                setChatLog((prev) =>
                  prev.x === pos.x && prev.y === pos.y ? prev : { ...prev, ...pos },
                );
              };
              const onUp = (ev: PointerEvent) => {
                head.removeEventListener("pointermove", onMove);
                head.removeEventListener("pointerup", onUp);
                head.removeEventListener("pointercancel", onUp);
                const pos = clampChatLogPos(
                  originX + (ev.clientX - startX),
                  originY + (ev.clientY - startY),
                  panelW,
                  panelH,
                );
                setChatLog((prev) => {
                  const next = { ...prev, ...pos };
                  writeChatLogSettings(next);
                  return next;
                });
              };
              head.addEventListener("pointermove", onMove);
              head.addEventListener("pointerup", onUp);
              head.addEventListener("pointercancel", onUp);
            }}
          >
            <div className="chat-log-title">채팅 기록</div>
            <button
              type="button"
              className="chat-log-close"
              aria-label="채팅 기록 닫기"
              onClick={(e) => {
                e.stopPropagation();
                const next = { ...chatLog, enabled: false };
                setChatLog(next);
                writeChatLogSettings(next);
              }}
            >
              ✕
            </button>
          </div>
          <div className="chat-log-list" ref={chatLogListRef}>
            {!inRoom ? (
              <p className="chat-log-empty">방에 들어가면 여기에 쌓여요</p>
            ) : logLines.length === 0 ? (
              <p className="chat-log-empty">최근 10분 채팅이 없어요</p>
            ) : (
              logLines.map((m) => (
                <p key={m.id} className="chat-log-line">
                  <strong style={{ color: chatNickColor(m.memberId, m.nickname) }}>
                    {m.nickname}
                  </strong>
                  <span>{m.text}</span>
                </p>
              ))
            )}
          </div>
        </aside>
      ) : null}
      {activeLetter && (
        <LetterReveal
          letter={activeLetter}
          onPhaseChange={setLetterPhase}
          onDismiss={() => {
            setLetterPhase(null);
            setLetterQueue((prev) =>
              prev.filter((l) => l.id !== activeLetter.id),
            );
          }}
        />
      )}
      {activeEgg && (
        <EggThrow
          key={activeEgg}
          onDone={() => setEggQueue((prev) => prev.filter((id) => id !== activeEgg))}
        />
      )}
      {bombExplode && selfMemberId === bombExplode.holderMemberId ? (
        <BombBoom
          key={bombExplode.at}
          payload={bombExplode}
          onDone={() => {
            playedExplodeAtRef.current = bombExplode.at;
            setBombExplode(null);
          }}
        />
      ) : null}
      {showLadder && ladder ? (
        <LadderGame
          ladder={ladder}
          members={members}
          selfMemberId={selfMemberId}
          serverUrl={serverUrl}
          onStart={(payload) =>
            writeGamePending({ type: "ladder-start", ...payload, at: Date.now() })
          }
          onCancel={() =>
            writeGamePending({ type: "ladder-cancel", at: Date.now() })
          }
          onDismissDone={() => setLadderDismissed(true)}
        />
      ) : null}
      {actors.map(({ member, x, y, edge, facing, bubble, isSelf, pinned }) => {
        const isDraggingThis = dragMemberId === member.id;
        const canDrag = isSelf || repositionMode;
        const showBombOnThis = Boolean(
          bomb && bomb.holderMemberId === member.id,
        );
        return (
        <div
          key={member.id}
          data-guide={isSelf ? "guide-overlay-self" : undefined}
          className={`actor edge-${edge}${isSelf ? " self" : " peer"}${isDraggingThis ? " dragging" : ""}${repositionMode ? " reposition" : ""}${pinned ? " pinned" : ""}`}
          style={{ left: x, top: y, cursor: canDrag ? "grab" : undefined }}
          onPointerDown={(e) => {
            if (!canDrag) return;
            e.stopPropagation();
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            dragStartRef.current = {
              x: e.clientX,
              y: e.clientY,
              moved: false,
              memberId: member.id,
              isSelf,
            };
          }}
          onClick={(e) => {
            if (!isSelf) return;
            e.stopPropagation();
            if (dragStartRef.current?.moved || dragging) return;
            if (repositionMode) return;
            togglePanel();
          }}
          title={
            repositionMode
              ? "화면 어디든 드래그 · 확인으로 적용"
              : isSelf
                ? "클릭: 채팅 열기/닫기 · 드래그: 위치 이동"
                : pinned
                  ? "이 기기에 위치 고정됨"
                  : undefined
          }
        >
          {showBombOnThis && bomb ? (
            <BombProp
              isHolder={
                bombIsHolder ||
                (isSelf && bomb.holderMemberId === selfMemberId)
              }
              placeBelow={edge === "top"}
              peerNicks={peerNicksForBomb}
              onPassRandom={() =>
                writeGamePending({
                  type: "bomb-pass",
                  random: true,
                  at: Date.now(),
                })
              }
              onPassNick={(nick) =>
                writeGamePending({
                  type: "bomb-pass",
                  random: false,
                  targetNickname: nick,
                  at: Date.now(),
                })
              }
              onNoPeers={() =>
                writeOverlayNotice("넘길 상대가 방에 없어요")
              }
            />
          ) : null}
          {(() => {
            if (isSelf && pendingInvite) {
              const nick = pendingInvite.fromNickname.trim() || "친구";
              return (
                <div
                  className="bubble invite"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="bubble-text">
                    {nick}님에게 초대가 왔습니다
                  </span>
                  <div className="bubble-actions">
                    <button
                      type="button"
                      className="bubble-btn accept"
                      onClick={(e) => {
                        e.stopPropagation();
                        writeInviteAction("accept");
                      }}
                    >
                      입장
                    </button>
                    <button
                      type="button"
                      className="bubble-btn dismiss"
                      onClick={(e) => {
                        e.stopPropagation();
                        writeInviteAction("dismiss");
                      }}
                    >
                      거절
                    </button>
                  </div>
                </div>
              );
            }
            if (isSelf && overlayNotice) {
              return (
                <div className="bubble notice">
                  <span className="bubble-text">{overlayNotice.text}</span>
                </div>
              );
            }
            if (bubble) {
              return (
                <div className="bubble">
                  <span className="bubble-text">{bubble.text}</span>
                </div>
              );
            }
            return null;
          })()}
          {(() => {
            const statusText = (
              isSelf ? statusMessage : member.statusMessage || ""
            ).trim();
            if (!statusText) return null;
            const hasSpeech =
              Boolean(bubble) ||
              (isSelf && Boolean(pendingInvite || overlayNotice));
            return (
              <div className={`status-bubble${hasSpeech ? " with-chat" : ""}`}>
                {statusText}
              </div>
            );
          })()}
          {isSelf &&
            !bubble &&
            !pendingInvite &&
            !overlayNotice &&
            !statusMessage &&
            !panelOpen && (
            <div className="tap-hint">나</div>
          )}
          {!isSelf && !!member.nickname?.trim() && (
            <div className="actor-name">{member.nickname.trim()}</div>
          )}
          {pinned && !repositionMode && (
            <div className="peer-pin-badge">고정</div>
          )}
          <CharacterView
            character={member.character}
            serverUrl={serverUrl}
            size={
              member.character.kind === "upload"
                ? member.character.displaySize
                : member.character.kind === "buddy"
                  ? Math.max(member.character.displaySize, BUDDY_MIN_DISPLAY_SIZE)
                  : 56
            }
            facing={facing}
            buddyDef={
              member.character.kind === "buddy"
                ? buddyDefs.find((b) => {
                    const buddy = member.character;
                    return buddy.kind === "buddy" && b.id === buddy.id;
                  })
                : undefined
            }
          />
        </div>
        );
      })}

      {panelOpen && !repositionMode && (
        <div
          className="composer-backdrop"
          onPointerDown={(e) => {
            e.preventDefault();
            closePanel();
          }}
        />
      )}

      {panelOpen && repositionMode && (
        <div
          className="reposition-bar"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span>화면 어디든 드래그한 뒤 확인하세요 (이 기기만)</span>
          <div className="reposition-actions">
            <button type="button" onClick={() => cancelRepositionMode(true)}>
              취소
            </button>
            <button
              type="button"
              className="reposition-confirm"
              onClick={confirmRepositionMode}
            >
              확인
            </button>
          </div>
        </div>
      )}

      {panelOpen && !repositionMode && (
        <div
          data-guide="guide-overlay-composer"
          className="cursor-composer"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {plusOpen && (
            <div
              data-guide="guide-overlay-room-actions"
              className="composer-plus-menu"
            >
              <button type="button" onClick={() => insertCommand("/편지 ")}>
                편지
              </button>
              <button type="button" onClick={() => insertCommand("/계란 ")}>
                계란
              </button>
              <button type="button" onClick={() => insertCommand("/폭탄 ")}>
                폭탄
              </button>
              <button type="button" onClick={() => insertCommand("/사다리")}>
                사다리
              </button>
              <button
                type="button"
                onClick={() => {
                  void invokeSafe("show_settings");
                  closePanel();
                }}
              >
                설정 창 열기
              </button>
              {!inRoom && !joinOpen && (
                <>
                  <button
                    type="button"
                    onClick={() => queueRoomAction({ action: "create" })}
                  >
                    방 만들기
                  </button>
                  <button
                    type="button"
                    onClick={() => setJoinOpen(true)}
                  >
                    방 입장하기
                  </button>
                </>
              )}
              {!inRoom && joinOpen && (
                <div className="plus-join">
                  <input
                    autoFocus
                    value={joinCode}
                    maxLength={6}
                    placeholder="초대코드"
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && joinCode.trim().length >= 4) {
                        queueRoomAction({
                          action: "join",
                          code: joinCode.trim(),
                        });
                      }
                      if (e.key === "Escape") {
                        setJoinOpen(false);
                        setJoinCode("");
                      }
                    }}
                  />
                  <div className="plus-join-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setJoinOpen(false);
                        setJoinCode("");
                      }}
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      disabled={joinCode.trim().length < 4}
                      onClick={() =>
                        queueRoomAction({
                          action: "join",
                          code: joinCode.trim(),
                        })
                      }
                    >
                      입장
                    </button>
                  </div>
                </div>
              )}
              {inRoom && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (roomCode) {
                        void navigator.clipboard?.writeText(roomCode);
                      }
                      void invokeSafe("show_settings");
                      closePanel();
                    }}
                  >
                    초대코드 {roomCode || ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => queueRoomAction({ action: "leave" })}
                  >
                    방 나가기
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setPlusOpen(false);
                  setJoinOpen(false);
                  setMoveOpen(false);
                  setComposeMode("status");
                  setChat(statusMessage);
                  window.setTimeout(() => chatInputRef.current?.focus(), 30);
                }}
              >
                상태메시지
              </button>
              {statusMessage ? (
                <button
                  type="button"
                  onClick={() => {
                    writeStatusMessage("");
                    setStatusMessage("");
                    setPlusOpen(false);
                  }}
                >
                  상태메시지 지우기
                </button>
              ) : null}
              <button type="button" onClick={() => openBuddyTab("quests")}>
                퀘스트 확인
              </button>
              <button type="button" onClick={() => openBuddyTab("character")}>
                캐릭터 변경
              </button>
            </div>
          )}
          {moveOpen && (
            <div className="composer-move-menu">
              <label className="move-switch">
                <span>자동 이동</span>
                <input
                  type="checkbox"
                  checked={move.walking}
                  onChange={(e) => patchMove({ walking: e.target.checked })}
                />
                <span className="switch-ui" aria-hidden />
              </label>

              <div className="move-row">
                <span>이동 범위</span>
                <select
                  value={move.pathMode}
                  onChange={(e) =>
                    patchMove({ pathMode: e.target.value as PathMode })
                  }
                >
                  {PATH_MODE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="move-row">
                <span>속도</span>
                <input
                  type="range"
                  min={3}
                  max={40}
                  value={Math.round(move.speed * 1000)}
                  disabled={!move.walking}
                  onChange={(e) =>
                    patchMove({ speed: Number(e.target.value) / 1000 })
                  }
                />
              </div>

              {hasLocalPins ? (
                <button
                  type="button"
                  className="move-grip"
                  onClick={() => {
                    clearLocalPins();
                    setMoveOpen(true);
                  }}
                >
                  고정 해제하기
                </button>
              ) : (
                <button
                  type="button"
                  className="move-grip"
                  onClick={startRepositionMode}
                >
                  위치 고정하기
                </button>
              )}
              <p className="move-hint">
                위치 고정하기: 화면 어디든 드래그 후 확인.
                고정 해제하기: 다시 테두리 자동 이동으로 돌아갑니다.
              </p>
              <label className="move-switch">
                <span>채팅 기록</span>
                <input
                  type="checkbox"
                  checked={chatLog.enabled}
                  onChange={(e) => {
                    const next = { ...chatLog, enabled: e.target.checked };
                    setChatLog(next);
                    writeChatLogSettings(next);
                  }}
                />
                <span className="switch-ui" aria-hidden />
              </label>
              <p className="move-hint">왼쪽 하단에서 시작합니다. 제목을 끌면 옮기고, 오른쪽 가장자리로 가로를 조절합니다.</p>
              <div className="move-row">
                <span>투명도</span>
                <input
                  type="range"
                  min={25}
                  max={95}
                  value={Math.round(chatLog.opacity * 100)}
                  disabled={!chatLog.enabled}
                  onChange={(e) => {
                    const next = {
                      ...chatLog,
                      opacity: Number(e.target.value) / 100,
                    };
                    setChatLog(next);
                    writeChatLogSettings(next);
                  }}
                />
              </div>
            </div>
          )}
          {letterCmdTip && (
            <div className="composer-cmd-tip" aria-live="polite">
              <strong>편지</strong> · {letterCmdTip}
            </div>
          )}
          {eggCmdTip && (
            <div className="composer-cmd-tip" aria-live="polite">
              <strong>계란</strong> · {eggCmdTip}
            </div>
          )}
          {bombCmdTip && (
            <div className="composer-cmd-tip" aria-live="polite">
              <strong>폭탄</strong> · {bombCmdTip}
            </div>
          )}
          {ladderCmdTip && (
            <div className="composer-cmd-tip" aria-live="polite">
              <strong>사다리</strong> · {ladderCmdTip}
            </div>
          )}
          <form
            className="composer-bar"
            onSubmit={(e) => {
              e.preventDefault();
              sendChat();
            }}
          >
            <button
              type="button"
              data-guide="guide-overlay-plus"
              className={`composer-plus${plusOpen ? " open" : ""}`}
              aria-label="더보기"
              onClick={() => {
                setMoveOpen(false);
                setJoinOpen(false);
                setPlusOpen((v) => !v);
              }}
            >
              +
            </button>
            <input
              ref={chatInputRef}
              value={chat}
              maxLength={chatMaxLen}
              placeholder={
                composeMode === "status"
                  ? "상태메시지 (항상 표시)…"
                  : letterDraft
                    ? "/편지 @닉 내용…"
                    : eggDraft
                      ? "/계란 [닉]"
                      : bombDraft
                        ? "/폭탄 30 · /폭탄 랜덤 · /폭탄 넘겨"
                        : ladderDraft
                          ? "/사다리"
                          : inRoom
                            ? "메시지 · /편지 · /계란 · /폭탄 · /사다리"
                            : "혼잣말 · /편지 · /계란…"
              }
              onChange={(e) => setChat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (composeMode === "status") {
                    setComposeMode("chat");
                    setChat("");
                    return;
                  }
                  closePanel();
                }
              }}
            />
            {letterDraft && (
              <span className="composer-letter-hint" aria-live="polite">
                편지 · {targetHint}
              </span>
            )}
            {eggDraft && !letterDraft && (
              <span className="composer-letter-hint" aria-live="polite">
                계란 · {targetHint}
              </span>
            )}
            {bombDraft && !letterDraft && !eggDraft && (
              <span className="composer-letter-hint" aria-live="polite">
                5~120초
              </span>
            )}
            {ladderDraft && !letterDraft && !eggDraft && !bombDraft && (
              <span className="composer-letter-hint" aria-live="polite">
                사다리
              </span>
            )}
            {composeMode === "status" && (
              <button
                type="button"
                className="composer-emoji open"
                aria-label="채팅으로"
                title="채팅으로 돌아가기"
                onClick={() => {
                  setComposeMode("chat");
                  setChat("");
                }}
              >
                💬
              </button>
            )}
            <button
              type="button"
              className={`composer-emoji${moveOpen ? " open" : ""}`}
              aria-label="이동 설정"
              onClick={() => {
                setPlusOpen(false);
                setComposeMode("chat");
                setMoveOpen((v) => !v);
              }}
            >
              ✨
            </button>
            <button
              type="submit"
              className="composer-send"
              disabled={composeMode === "chat" && !chat.trim()}
              aria-label={composeMode === "status" ? "상태 저장" : "전송"}
            >
              {composeMode === "status" ? "✓" : "↑"}
            </button>
          </form>
        </div>
      )}

      {guide.activeForWindow && guide.stepDef ? (
        <GuideSpotlight
          stepDef={guide.stepDef}
          stepIndex={guide.stepIndex}
          stepTotal={guide.stepTotal}
          onNext={guide.next}
          onPrev={guide.prev}
          onSkip={guide.skipAndComplete}
          onDismiss={guide.dismiss}
          variant="overlay"
        />
      ) : null}
    </div>
  );
}

export function persistActiveRoom(code: string | null) {
  if (!code) localStorage.removeItem(ROOM_KEY);
  else localStorage.setItem(ROOM_KEY, JSON.stringify({ code }));
  window.dispatchEvent(new Event("monibuddy:room"));
}
