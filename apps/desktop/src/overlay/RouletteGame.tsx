import { useEffect, useId, useMemo, useState } from "react";
import { ROULETTE_MAX_SLOTS, ROULETTE_MIN_SLOTS, type RouletteState } from "@monibuddy/shared";

const SLICE_COLORS = ["#55ddff", "#ffe14d", "#ff6b8a", "#7dffb3", "#ffffff", "#c9a6ff"];
const WHEEL = 200;
const CX = 100;
const CY = 100;
const R = 90;
const LABEL_R = 56;
const SPIN_MS = 4200;

type Props = {
  roulette: RouletteState;
  selfMemberId: string | null;
  onSpin: (slots: string[]) => void;
  onCancel: () => void;
  onDismiss: () => void;
};

function polar(degFromTop: number, radius: number): [number, number] {
  const rad = ((degFromTop - 90) * Math.PI) / 180;
  return [CX + Math.cos(rad) * radius, CY + Math.sin(rad) * radius];
}

function slicePath(index: number, count: number): string {
  const slice = 360 / count;
  const a0 = index * slice;
  const a1 = (index + 1) * slice;
  const [x0, y0] = polar(a0, R);
  const [x1, y1] = polar(a1, R);
  const large = slice > 180 ? 1 : 0;
  return `M ${CX} ${CY} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`;
}

export function RouletteGame({
  roulette,
  selfMemberId,
  onSpin,
  onCancel,
  onDismiss,
}: Props) {
  const isHost = Boolean(selfMemberId) && selfMemberId === roulette.hostMemberId;
  const [count, setCount] = useState(4);
  const [values, setValues] = useState<string[]>(() => Array.from({ length: 4 }, () => ""));
  const [rotation, setRotation] = useState(
    roulette.phase === "done" ? roulette.stopAngle : 0,
  );

  useEffect(() => {
    setValues((prev) => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push("");
      return next;
    });
  }, [count]);

  useEffect(() => {
    if (roulette.phase === "setup") {
      setRotation(0);
      return;
    }
    const frame = requestAnimationFrame(() => setRotation(roulette.stopAngle));
    return () => cancelAnimationFrame(frame);
  }, [roulette.phase, roulette.stopAngle]);

  if (roulette.phase === "setup" && isHost) {
    return (
      <div className="roulette-panel setup">
        <header className="roulette-head">
          <p className="roulette-brand">ROULETTE</p>
          <h3>룰렛</h3>
          <p className="roulette-hint">칸 수를 정하고 값을 적은 뒤 돌리세요</p>
        </header>
        <div className="roulette-count">
          <button
            type="button"
            aria-label="칸 줄이기"
            disabled={count <= ROULETTE_MIN_SLOTS}
            onClick={() => setCount((n) => Math.max(ROULETTE_MIN_SLOTS, n - 1))}
          >
            −
          </button>
          <span>{count}칸</span>
          <button
            type="button"
            aria-label="칸 늘리기"
            disabled={count >= ROULETTE_MAX_SLOTS}
            onClick={() => setCount((n) => Math.min(ROULETTE_MAX_SLOTS, n + 1))}
          >
            +
          </button>
        </div>
        <div className="roulette-slots">
          {values.map((value, i) => (
            <label key={i}>
              <span className="roulette-slot-no">{i + 1}</span>
              <input
                value={value}
                maxLength={16}
                placeholder={`칸 ${i + 1}`}
                onChange={(e) => {
                  const next = values.slice();
                  next[i] = e.target.value;
                  setValues(next);
                }}
              />
            </label>
          ))}
        </div>
        <div className="roulette-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            className="primary"
            onClick={() =>
              onSpin(values.map((v, i) => v.trim() || `칸 ${i + 1}`))
            }
          >
            돌리기
          </button>
        </div>
      </div>
    );
  }

  if (roulette.phase === "setup" && !isHost) {
    return (
      <div className="roulette-panel wait">
        <p className="roulette-brand">ROULETTE</p>
        <p>
          <strong>{roulette.hostNickname}</strong> 님이 룰렛을 준비 중…
        </p>
      </div>
    );
  }

  const slots = roulette.slots.length > 0 ? roulette.slots : ["?"];
  const winner = slots[roulette.winnerIndex] ?? slots[0];
  return (
    <RouletteWheel
      slots={slots}
      winner={winner}
      phase={roulette.phase}
      rotation={rotation}
      onDismiss={onDismiss}
    />
  );
}

function RouletteWheel({
  slots,
  winner,
  phase,
  rotation,
  onDismiss,
}: {
  slots: string[];
  winner: string;
  phase: RouletteState["phase"];
  rotation: number;
  onDismiss: () => void;
}) {
  const clipId = useId().replace(/:/g, "");
  const slices = useMemo(() => {
    const n = Math.max(1, slots.length);
    return slots.map((label, i) => {
      const mid = ((i + 0.5) * 360) / n;
      const [lx, ly] = polar(mid, LABEL_R);
      return {
        label: label.slice(0, 6),
        path: slicePath(i, n),
        fill: SLICE_COLORS[i % SLICE_COLORS.length]!,
        lx,
        ly,
        mid,
      };
    });
  }, [slots]);

  const spinStyle =
    phase === "spinning"
      ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.78, 0.08, 1)`
      : "none";

  return (
    <div className="roulette-panel reveal">
      <header className="roulette-head">
        <p className="roulette-brand">ROULETTE</p>
        <h3>룰렛</h3>
        <p className="roulette-hint">
          {phase === "spinning" ? "돌아가는 중…" : "결과"}
        </p>
      </header>
      <div className="roulette-stage">
        <svg className="roulette-pointer-px" viewBox="0 0 11 7" aria-hidden>
          <rect x="0" y="0" width="11" height="1" fill="#1c2430" />
          <rect x="1" y="0" width="9" height="1" fill="#ffe14d" />
          <rect x="1" y="1" width="1" height="1" fill="#1c2430" />
          <rect x="2" y="1" width="7" height="1" fill="#ffe14d" />
          <rect x="9" y="1" width="1" height="1" fill="#1c2430" />
          <rect x="2" y="2" width="1" height="1" fill="#1c2430" />
          <rect x="3" y="2" width="5" height="1" fill="#ffe14d" />
          <rect x="8" y="2" width="1" height="1" fill="#1c2430" />
          <rect x="3" y="3" width="1" height="1" fill="#1c2430" />
          <rect x="4" y="3" width="3" height="1" fill="#ffe14d" />
          <rect x="7" y="3" width="1" height="1" fill="#1c2430" />
          <rect x="4" y="4" width="1" height="1" fill="#1c2430" />
          <rect x="4" y="5" width="1" height="1" fill="#1c2430" />
          <rect x="5" y="4" width="1" height="3" fill="#ffe14d" />
          <rect x="6" y="4" width="1" height="2" fill="#1c2430" />
        </svg>
        <div
          className="roulette-rotor"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: spinStyle,
          }}
        >
          <svg
            className="roulette-wheel"
            viewBox={`0 0 ${WHEEL} ${WHEEL}`}
            aria-hidden
          >
            <defs>
              <clipPath id={clipId}>
                <circle cx={CX} cy={CY} r={R} />
              </clipPath>
            </defs>
            <circle cx={CX} cy={CY} r={R + 5} fill="#1c2430" />
            <circle cx={CX} cy={CY} r={R + 2.5} fill="#fff" />
            <g clipPath={`url(#${clipId})`}>
              {slices.map((slice, i) => (
                <path key={`s-${i}`} d={slice.path} fill={slice.fill} />
              ))}
              {slices.map((slice, i) => (
                <line
                  key={`d-${i}`}
                  x1={CX}
                  y1={CY}
                  x2={polar((i * 360) / slices.length, R)[0]}
                  y2={polar((i * 360) / slices.length, R)[1]}
                  stroke="#111"
                  strokeWidth="2"
                />
              ))}
            </g>
            <circle
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke="#fff"
              strokeWidth="3"
            />
            {slices.map((slice, i) => (
              <text
                key={`t-${i}`}
                x={slice.lx}
                y={slice.ly}
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${slice.mid} ${slice.lx} ${slice.ly})`}
                fill="#111"
                stroke="#fff"
                strokeWidth="2.2"
                paintOrder="stroke"
                style={{ fontSize: 12, fontWeight: 700 }}
              >
                {slice.label}
              </text>
            ))}
            <circle cx={CX} cy={CY} r={15} fill="#111" stroke="#fff" strokeWidth="3" />
            <circle cx={CX} cy={CY} r={7.5} fill="#55ddff" />
          </svg>
        </div>
      </div>
      <div className="roulette-foot" data-empty={phase !== "done" ? "1" : undefined}>
        {phase === "done" ? (
          <>
            <p className="roulette-result">{winner}</p>
            <button type="button" className="primary" onClick={onDismiss}>
              닫기
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
