import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GuideStepDef } from "../lib/productGuide";
import { Btn } from "./ui";
import { cn } from "../lib/cn";

type Rect = { top: number; left: number; width: number; height: number };

type Props = {
  stepDef: GuideStepDef;
  stepIndex: number;
  stepTotal: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onDismiss: () => void;
  /** false면 이전 숨김 (settings 0단계) */
  canPrev?: boolean;
  /** 오버레이 등 어두운 배경 위에서도 잘 보이게 */
  variant?: "settings" | "overlay";
};

const PAD = 8;

function findAnchorRect(anchorId: string | undefined): Rect | null {
  if (!anchorId) return null;
  const el = document.querySelector(
    `[data-guide="${anchorId}"]`,
  ) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 && r.height < 1) return null;
  return {
    top: Math.max(0, r.top - PAD),
    left: Math.max(0, r.left - PAD),
    width: Math.min(window.innerWidth - (r.left - PAD), r.width + PAD * 2),
    height: Math.min(window.innerHeight - (r.top - PAD), r.height + PAD * 2),
  };
}

export function GuideSpotlight({
  stepDef,
  stepIndex,
  stepTotal,
  onNext,
  onPrev,
  onSkip,
  onDismiss,
  canPrev = true,
  variant = "settings",
}: Props) {
  const [hole, setHole] = useState<Rect | null>(null);
  const openedAtRef = useRef(Date.now());

  useLayoutEffect(() => {
    openedAtRef.current = Date.now();
    const measure = () => setHole(findAnchorRect(stepDef.anchor));
    measure();
    // 앵커 DOM이 늦게 열릴 수 있음 (오버레이 + 메뉴 등)
    const t1 = window.setTimeout(measure, 50);
    const t2 = window.setTimeout(measure, 200);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    const el = stepDef.anchor
      ? document.querySelector(`[data-guide="${stepDef.anchor}"]`)
      : null;
    if (el) ro.observe(el);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      ro.disconnect();
    };
  }, [stepDef.anchor, stepIndex]);

  const dismissFromBackdrop = () => {
    // 가이드를 연 직후 같은 클릭/포커스 이동으로 바로 닫히지 않게
    if (Date.now() - openedAtRef.current < 350) return;
    onDismiss();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const isLast = stepIndex >= stepTotal - 1;
  const cardBelow =
    hole && hole.top + hole.height + 200 < window.innerHeight
      ? hole.top + hole.height + 12
      : null;
  const cardTop =
    cardBelow ??
    (hole ? Math.max(16, hole.top - 180) : window.innerHeight / 2 - 90);

  return (
    <div
      className="fixed inset-0 z-[9999]"
      style={{ pointerEvents: "auto" }}
      role="dialog"
      aria-modal="true"
      aria-label="기능 가이드"
    >
      {/* dim + hole via 4 panels */}
      {hole ? (
        <>
          <div
            className="absolute bg-black/70"
            style={{
              top: 0,
              left: 0,
              right: 0,
              height: hole.top,
            }}
            onClick={dismissFromBackdrop}
          />
          <div
            className="absolute bg-black/70"
            style={{
              top: hole.top + hole.height,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            onClick={dismissFromBackdrop}
          />
          <div
            className="absolute bg-black/70"
            style={{
              top: hole.top,
              left: 0,
              width: hole.left,
              height: hole.height,
            }}
            onClick={dismissFromBackdrop}
          />
          <div
            className="absolute bg-black/70"
            style={{
              top: hole.top,
              left: hole.left + hole.width,
              right: 0,
              height: hole.height,
            }}
            onClick={dismissFromBackdrop}
          />
          <div
            className="pointer-events-none absolute border border-white"
            style={{
              top: hole.top,
              left: hole.left,
              width: hole.width,
              height: hole.height,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.35)",
            }}
          />
        </>
      ) : (
        <div
          className="absolute inset-0 bg-black/70"
          onClick={dismissFromBackdrop}
        />
      )}

      <div
        className={cn(
          "absolute left-1/2 z-[10000] w-[min(340px,calc(100vw-2rem))] -translate-x-1/2 border border-white bg-black/90 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.2)]",
          variant === "overlay" && "bg-black/95",
        )}
        style={{ top: Math.max(12, Math.min(cardTop, window.innerHeight - 220)) }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <h2 className="m-0 text-[0.95rem] font-bold uppercase tracking-wide text-white">
            {stepDef.title}
          </h2>
          <button
            type="button"
            className="shrink-0 border border-white/40 px-2 py-0.5 text-[0.72rem] text-mute hover:border-white hover:text-white"
            aria-label="가이드 닫기"
            onClick={onDismiss}
          >
            ✕
          </button>
        </div>
        <p className="m-0 mb-3 text-[0.82rem] leading-relaxed text-mute">
          {stepDef.body}
        </p>
        <div className="mb-3 text-[0.68rem] uppercase tracking-wider text-mute">
          {stepIndex + 1} / {stepTotal}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn
            variant="ghost"
            className="px-2 py-1.5 text-[0.72rem]"
            onClick={onSkip}
          >
            건너뛰기
          </Btn>
          <div className="ml-auto flex gap-2">
            <Btn
              variant="default"
              className="px-3 py-1.5 text-[0.72rem]"
              onClick={onPrev}
              style={{
                visibility: canPrev ? "visible" : "hidden",
              }}
            >
              ← 이전
            </Btn>
            <Btn
              variant="primary"
              className="px-3 py-1.5 text-[0.72rem]"
              onClick={onNext}
            >
              {isLast ? "완료" : "다음 →"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
