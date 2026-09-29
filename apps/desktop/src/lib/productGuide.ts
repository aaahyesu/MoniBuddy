/** 기능 가이드(스포트라이트 투어) — 콘텐츠 버전·세션·완료 상태 */

export const GUIDE_CONTENT_VERSION = 1;

export const GUIDE_STATE_KEY = "monibuddy.guide.v1";
export const GUIDE_SESSION_KEY = "monibuddy.guideSession.v1";
export const GUIDE_EVENT = "monibuddy:guide";
/** 설정 가이드 세션 방치 시 오버레이 클릭 먹통 방지 — TTL 초과면 폐기 */
export const GUIDE_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
/** 오버레이 창 → 설정 창 소켓으로 guide:markSeen 전달 */
export const GUIDE_MARK_SEEN_REQUEST_KEY = "monibuddy.guide.markSeenRequest.v1";

export type GuidePhase = "settings" | "overlay";

export type GuideSession = {
  active: boolean;
  phase: GuidePhase;
  step: number;
  startedAt: number;
};

export type GuideState = {
  /** @deprecated seenUserIds 로 대체 — 하위호환 / 오프라인 캐시 */
  completedVersion?: number;
  /** 오프라인 캐시 — 서버 guideSeen 이 권위 */
  seenUserIds?: string[];
};

export type GuideStepDef = {
  /** DOM `[data-guide="..."]` — 없으면 카드만 중앙 */
  anchor?: string;
  title: string;
  body: string;
};

export const SETTINGS_STEPS: GuideStepDef[] = [
  {
    title: "MoniBuddy 가이드",
    body: "모니터 테두리 버디와 친구·방으로 채팅하는 방법을 짧게 안내할게요. 언제든 헤더 ? 로 다시 열 수 있어요.",
  },
  {
    anchor: "guide-profile",
    title: "프로필",
    body: "여기를 누르면 닉네임·캐릭터·오버레이 단축키를 바꿀 수 있어요.",
  },
  {
    anchor: "guide-friends",
    title: "친구",
    body: "내 친구 코드를 공유하고, 상대 코드로 추가하세요. 접속 중이면 온라인으로 보여요.",
  },
  {
    anchor: "guide-play-hint",
    title: "플레이 방법",
    body: "모니터 테두리의 내 캐릭터를 누른 뒤 + 에서 방을 만들거나 입장해요.",
  },
  {
    anchor: "guide-show-overlay",
    title: "오버레이 표시",
    body: "Show Overlay 또는 설정한 단축키로 테두리 버디를 켜고 끌 수 있어요.",
  },
  {
    title: "오버레이에서 계속",
    body: "다음을 누르면 오버레이로 넘어가 캐릭터 클릭·채팅·방 만들기를 이어 안내해요. (위치 고정·캡처·퀘스트는 나중에 천천히 익혀도 돼요.)",
  },
];

export const OVERLAY_STEPS: GuideStepDef[] = [
  {
    anchor: "guide-overlay-self",
    title: "내 캐릭터",
    body: "테두리를 걷는 내 버디를 클릭하면 채팅 패널이 열려요. 드래그로 위치도 옮길 수 있어요.",
  },
  {
    anchor: "guide-overlay-composer",
    title: "채팅 입력",
    body: "메시지를 보내고 Enter로 전송해요. 방에 없으면 혼잣말로 표시돼요.",
  },
  {
    anchor: "guide-overlay-plus",
    title: "+ 메뉴",
    body: "+ 를 누르면 방·설정·상태메시지·퀘스트 등 더 많은 기능을 쓸 수 있어요.",
  },
  {
    anchor: "guide-overlay-room-actions",
    title: "방 만들기 · 입장",
    body: "방을 만들거나 초대코드로 입장하면 친구와 같은 테두리에서 채팅할 수 있어요.",
  },
  {
    title: "준비 완료!",
    body: "가이드를 마쳤어요. 헤더 ? 로 언제든 다시 볼 수 있어요. 즐거운 MoniBuddy!",
  },
];

export function stepsForPhase(phase: GuidePhase): GuideStepDef[] {
  return phase === "settings" ? SETTINGS_STEPS : OVERLAY_STEPS;
}

export function readGuideState(): GuideState {
  try {
    const raw = localStorage.getItem(GUIDE_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as GuideState;
    const seen = Array.isArray(parsed.seenUserIds)
      ? parsed.seenUserIds.filter((id): id is string => typeof id === "string" && Boolean(id))
      : [];
    return {
      completedVersion:
        typeof parsed.completedVersion === "number"
          ? parsed.completedVersion
          : undefined,
      seenUserIds: seen,
    };
  } catch {
    return {};
  }
}

export function writeGuideState(next: GuideState) {
  localStorage.setItem(GUIDE_STATE_KEY, JSON.stringify(next));
  dispatchGuideEvent();
}

/** 오프라인 캐시 — 서버 값이 오기 전 폴백 */
export function hasUserSeenGuide(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const s = readGuideState();
  if ((s.completedVersion ?? 0) >= GUIDE_CONTENT_VERSION) return true;
  return (s.seenUserIds ?? []).includes(userId);
}

/** PresenceHello 등 서버 권위 값으로 로컬 캐시 동기화 */
export function cacheGuideSeenFromServer(
  userId: string | null | undefined,
  seen: boolean,
) {
  if (!userId) return;
  const s = readGuideState();
  const ids = new Set(s.seenUserIds ?? []);
  if (seen) {
    ids.add(userId);
    writeGuideState({
      ...s,
      completedVersion: Math.max(s.completedVersion ?? 0, GUIDE_CONTENT_VERSION),
      seenUserIds: [...ids],
    });
  } else {
    ids.delete(userId);
    writeGuideState({
      ...s,
      completedVersion: 0,
      seenUserIds: [...ids],
    });
  }
}

export function markUserSeenGuide(userId: string | null | undefined) {
  if (!userId) return;
  cacheGuideSeenFromServer(userId, true);
}

/** 오버레이 등 소켓 없는 창에서 설정 창에 markSeen 요청 */
export function requestServerGuideMarkSeen() {
  try {
    localStorage.setItem(GUIDE_MARK_SEEN_REQUEST_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** @deprecated hasUserSeenGuide 사용 */
export function isGuideComplete(): boolean {
  const s = readGuideState();
  return (s.completedVersion ?? 0) >= GUIDE_CONTENT_VERSION;
}

export function markGuideComplete(userId?: string | null) {
  if (userId) {
    markUserSeenGuide(userId);
  } else {
    writeGuideState({
      ...readGuideState(),
      completedVersion: GUIDE_CONTENT_VERSION,
    });
  }
  clearGuideSession();
}

export function readGuideSession(): GuideSession | null {
  try {
    const raw = localStorage.getItem(GUIDE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuideSession>;
    if (!parsed.active) return null;
    if (parsed.phase !== "settings" && parsed.phase !== "overlay") return null;
    if (typeof parsed.step !== "number" || parsed.step < 0) return null;
    const startedAt =
      typeof parsed.startedAt === "number" ? parsed.startedAt : Date.now();
    // 강제 종료 등으로 세션만 남은 경우 — 클릭 통과 고착 방지
    if (Date.now() - startedAt > GUIDE_SESSION_TTL_MS) {
      localStorage.removeItem(GUIDE_SESSION_KEY);
      dispatchGuideEvent();
      return null;
    }
    return {
      active: true,
      phase: parsed.phase,
      step: parsed.step,
      startedAt,
    };
  } catch {
    return null;
  }
}

/**
 * 설정 창이 안 보이는데 settings phase 세션만 남은 고착을 해제.
 * (작업관리자 종료 후 재실행 시 캐릭터 클릭 먹통의 주원인)
 */
export function clearOrphanSettingsGuideSession(settingsVisible: boolean): boolean {
  if (settingsVisible) return false;
  try {
    const raw = localStorage.getItem(GUIDE_SESSION_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<GuideSession>;
    if (!parsed.active || parsed.phase !== "settings") return false;
    clearGuideSession();
    return true;
  } catch {
    return false;
  }
}

export function writeGuideSession(session: GuideSession) {
  localStorage.setItem(GUIDE_SESSION_KEY, JSON.stringify(session));
  dispatchGuideEvent();
}

export function clearGuideSession() {
  localStorage.removeItem(GUIDE_SESSION_KEY);
  dispatchGuideEvent();
}

export function startGuideSession(
  phase: GuidePhase = "settings",
  step = 0,
): GuideSession {
  const session: GuideSession = {
    active: true,
    phase,
    step,
    startedAt: Date.now(),
  };
  writeGuideSession(session);
  return session;
}

function dispatchGuideEvent() {
  window.dispatchEvent(new Event(GUIDE_EVENT));
}

export function getStepDef(session: GuideSession): GuideStepDef | null {
  const steps = stepsForPhase(session.phase);
  return steps[session.step] ?? null;
}
