import { useCallback, useEffect, useState } from "react";
import {
  clearGuideSession,
  GUIDE_EVENT,
  GUIDE_SESSION_KEY,
  GUIDE_STATE_KEY,
  getStepDef,
  hasUserSeenGuide,
  markGuideComplete,
  markUserSeenGuide,
  readGuideSession,
  startGuideSession,
  stepsForPhase,
  writeGuideSession,
  type GuidePhase,
  type GuideSession,
  type GuideStepDef,
} from "../lib/productGuide";

export type UseProductGuideOptions = {
  windowKind: "settings" | "overlay";
  /** 자동 가이드 1회 기록용 — 없으면 dismiss 시 seen 미기록 */
  userId?: string | null;
  /**
   * 서버(DB) 기준 가이드 완료 여부.
   * null = PresenceHello 전 — 자동 시작 판정에 쓰지 않음.
   */
  serverGuideSeen?: boolean | null;
  /** dismiss / skip / complete / auto-start 시 서버 markSeen */
  onMarkSeen?: () => void;
  /** settings phase 마지막 다음 → overlay 전환 직전 (오버레이 표시 등) */
  onEnterOverlayPhase?: () => void;
};

export function useProductGuide({
  windowKind,
  userId,
  serverGuideSeen = null,
  onMarkSeen,
  onEnterOverlayPhase,
}: UseProductGuideOptions) {
  const [session, setSession] = useState<GuideSession | null>(() =>
    readGuideSession(),
  );
  const [seen, setSeen] = useState(() =>
    serverGuideSeen === true || hasUserSeenGuide(userId),
  );

  const sync = useCallback(() => {
    setSession(readGuideSession());
    setSeen(
      serverGuideSeen === true ||
        (serverGuideSeen !== false && hasUserSeenGuide(userId)),
    );
  }, [userId, serverGuideSeen]);

  useEffect(() => {
    if (serverGuideSeen === true) {
      setSeen(true);
      return;
    }
    if (serverGuideSeen === false) {
      setSeen(false);
      return;
    }
    setSeen(hasUserSeenGuide(userId));
  }, [userId, serverGuideSeen]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === GUIDE_SESSION_KEY ||
        e.key === GUIDE_STATE_KEY ||
        e.key === null
      ) {
        sync();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(GUIDE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(GUIDE_EVENT, sync);
    };
  }, [sync]);

  const recordSeen = useCallback(() => {
    markUserSeenGuide(userId);
    onMarkSeen?.();
    setSeen(true);
  }, [userId, onMarkSeen]);

  /** 수동(?) 시작 — seen과 무관 */
  const start = useCallback((phase: GuidePhase = "settings", step = 0) => {
    const next = startGuideSession(phase, step);
    setSession(next);
  }, []);

  /**
   * 최초 1회 자동 시작.
   * 서버가 이미 봄이면(또는 오프라인 캐시) 스킵. 시작하면 즉시 seen 처리.
   */
  const startAutoOnce = useCallback(
    (phase: GuidePhase = "settings", step = 0) => {
      const already =
        serverGuideSeen === true ||
        (serverGuideSeen == null && hasUserSeenGuide(userId));
      if (already) {
        clearGuideSession();
        setSession(null);
        setSeen(true);
        return false;
      }
      recordSeen();
      const next = startGuideSession(phase, step);
      setSession(next);
      return true;
    },
    [userId, serverGuideSeen, recordSeen],
  );

  /** 닫기 — 다시 자동으로 안 뜨게 seen 기록 */
  const dismiss = useCallback(() => {
    recordSeen();
    clearGuideSession();
    setSession(null);
  }, [recordSeen]);

  const skipAndComplete = useCallback(() => {
    markGuideComplete(userId);
    onMarkSeen?.();
    setSession(null);
    setSeen(true);
  }, [userId, onMarkSeen]);

  const next = useCallback(() => {
    const cur = readGuideSession();
    if (!cur) return;

    const steps = stepsForPhase(cur.phase);
    if (cur.step >= steps.length - 1) {
      if (cur.phase === "settings") {
        onEnterOverlayPhase?.();
        const nextSession = startGuideSession("overlay", 0);
        setSession(nextSession);
        return;
      }
      markGuideComplete(userId);
      onMarkSeen?.();
      setSession(null);
      setSeen(true);
      return;
    }

    const nextSession: GuideSession = {
      ...cur,
      step: cur.step + 1,
    };
    writeGuideSession(nextSession);
    setSession(nextSession);
  }, [onEnterOverlayPhase, userId, onMarkSeen]);

  const prev = useCallback(() => {
    const cur = readGuideSession();
    if (!cur) return;

    if (cur.step <= 0) {
      if (cur.phase === "overlay") {
        const nextSession = startGuideSession(
          "settings",
          stepsForPhase("settings").length - 1,
        );
        setSession(nextSession);
        return;
      }
      return;
    }

    const nextSession: GuideSession = {
      ...cur,
      step: cur.step - 1,
    };
    writeGuideSession(nextSession);
    setSession(nextSession);
  }, []);

  const toggleFromHeader = useCallback(() => {
    const cur = readGuideSession();
    if (cur?.active) {
      dismiss();
      return;
    }
    start("settings", 0);
  }, [dismiss, start]);

  const activeForWindow =
    Boolean(session?.active) && session?.phase === windowKind;

  const stepDef: GuideStepDef | null =
    activeForWindow && session ? getStepDef(session) : null;

  const stepIndex = session?.step ?? 0;
  const stepTotal = session ? stepsForPhase(session.phase).length : 0;

  return {
    session,
    isComplete: seen,
    hasSeen: seen,
    /** 이 창에서 스포트라이트를 그릴지 */
    activeForWindow,
    stepDef,
    stepIndex,
    stepTotal,
    start,
    startAutoOnce,
    dismiss,
    skipAndComplete,
    next,
    prev,
    toggleFromHeader,
  };
}
