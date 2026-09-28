import { useCallback, useEffect, useState } from "react";
import {
  clearGuideSession,
  GUIDE_EVENT,
  GUIDE_SESSION_KEY,
  getStepDef,
  isGuideComplete,
  markGuideComplete,
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
  /** settings phase 마지막 다음 → overlay 전환 직전 (오버레이 표시 등) */
  onEnterOverlayPhase?: () => void;
};

export function useProductGuide({
  windowKind,
  onEnterOverlayPhase,
}: UseProductGuideOptions) {
  const [session, setSession] = useState<GuideSession | null>(() =>
    readGuideSession(),
  );
  const [complete, setComplete] = useState(() => isGuideComplete());

  const sync = useCallback(() => {
    setSession(readGuideSession());
    setComplete(isGuideComplete());
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === GUIDE_SESSION_KEY ||
        e.key === "monibuddy.guide.v1" ||
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

  const start = useCallback((phase: GuidePhase = "settings", step = 0) => {
    const next = startGuideSession(phase, step);
    setSession(next);
  }, []);

  /** ? 로 끄기 — 세션만 삭제 (완료 처리 안 함) */
  const dismiss = useCallback(() => {
    clearGuideSession();
    setSession(null);
  }, []);

  const skipAndComplete = useCallback(() => {
    markGuideComplete();
    setSession(null);
    setComplete(true);
  }, []);

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
      markGuideComplete();
      setSession(null);
      setComplete(true);
      return;
    }

    const nextSession: GuideSession = {
      ...cur,
      step: cur.step + 1,
    };
    writeGuideSession(nextSession);
    setSession(nextSession);
  }, [onEnterOverlayPhase]);

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
    isComplete: complete,
    /** 이 창에서 스포트라이트를 그릴지 */
    activeForWindow,
    stepDef,
    stepIndex,
    stepTotal,
    start,
    dismiss,
    skipAndComplete,
    next,
    prev,
    toggleFromHeader,
  };
}
