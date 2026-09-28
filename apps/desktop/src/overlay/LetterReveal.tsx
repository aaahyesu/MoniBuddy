import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

export type LetterItem = {
  id: string;
  nickname: string;
  text: string;
};

type Phase = "icon" | "opening" | "revealed";

type Props = {
  letter: LetterItem;
  onDismiss: () => void;
  onPhaseChange?: (phase: Phase) => void;
};

const OPEN_MS = 1400;
const ICON_TTL_MS = 10000;
const REVEALED_TTL_MS = 4500;

const CONFETTI = ["#55ddff", "#ff4d88", "#ffe14d", "#fff", "#c084fc", "#fb7185", "#4ade80"];

function hashSeed(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

function nextHash(h: number) {
  return (h * 1664525 + 1013904223) >>> 0;
}

function buildParticles(seed: string) {
  let h = hashSeed(seed);
  return Array.from({ length: 18 }, (_, i) => {
    h = nextHash(h);
    return {
      id: `${seed}-rise-${i}`,
      color: CONFETTI[h % CONFETTI.length],
      left: 8 + (h % 84),
      delay: 0.25 + (h % 700) / 1000,
      duration: 1.6 + (h % 800) / 1000,
      size: 6 + (h % 7),
      heart: h % 6 === 0,
    };
  });
}

/** 개봉 순간 방사형 팡파레 */
function buildFanfare(seed: string) {
  let h = hashSeed(`${seed}-fanfare`);
  return Array.from({ length: 42 }, (_, i) => {
    h = nextHash(h);
    const angle = (i / 42) * 360 + (h % 28) - 14;
    const dist = 110 + (h % 160);
    const rad = (angle * Math.PI) / 180;
    return {
      id: `${seed}-burst-${i}`,
      color: CONFETTI[h % CONFETTI.length],
      dx: Math.cos(rad) * dist,
      dy: Math.sin(rad) * dist - 40,
      delay: (h % 180) / 1000,
      duration: 0.85 + (h % 450) / 1000,
      size: 7 + (h % 10),
      kind: h % 7 === 0 ? "heart" : h % 5 === 0 ? "star" : "bit",
      spin: (h % 3) - 1,
    } as const;
  });
}

function playLetterFanfare() {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const now = ctx.currentTime;
    // C5 · E5 · G5 · C6 트럼펫식 팡파레
    const notes = [
      { f: 523.25, t: 0, d: 0.18 },
      { f: 659.25, t: 0.12, d: 0.18 },
      { f: 783.99, t: 0.24, d: 0.2 },
      { f: 1046.5, t: 0.4, d: 0.55 },
      { f: 783.99, t: 0.42, d: 0.5 },
      { f: 659.25, t: 0.44, d: 0.48 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = n.f;
      gain.gain.setValueAtTime(0.0001, now + n.t);
      gain.gain.exponentialRampToValueAtTime(0.09, now + n.t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.t);
      osc.stop(now + n.t + n.d + 0.02);
    }
    window.setTimeout(() => {
      void ctx.close();
    }, 1200);
  } catch {
    /* 오디오 차단 시 무시 */
  }
}

function fill(
  ctx: CanvasRenderingContext2D,
  px: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x * px), Math.round(y * px), Math.round(w * px), Math.round(h * px));
}

/** 16×14 픽셀 봉투. flap 0=닫힘, 1=뚜껑이 위로 열림 */
function drawPixelEnvelope(ctx: CanvasRenderingContext2D, px: number, flap: number) {
  const ink = "#1c2430";
  const paper = "#fff6fb";
  const shade = "#f7b6d0";
  const flapC = "#ffd0e6";
  const flapHi = "#fff";
  const heart = "#ff4d88";
  const wax = "#e11d48";

  ctx.clearRect(0, 0, px * 16, px * 14);

  fill(ctx, px, 2, 6, 12, 7, paper);
  fill(ctx, px, 2, 6, 12, 1, ink);
  fill(ctx, px, 2, 12, 12, 1, ink);
  fill(ctx, px, 2, 6, 1, 7, ink);
  fill(ctx, px, 13, 6, 1, 7, ink);
  fill(ctx, px, 3, 7, 10, 1, shade);

  fill(ctx, px, 6, 9, 1, 1, heart);
  fill(ctx, px, 9, 9, 1, 1, heart);
  fill(ctx, px, 7, 9, 2, 1, heart);
  fill(ctx, px, 6, 10, 4, 1, heart);
  fill(ctx, px, 7, 11, 2, 1, heart);
  fill(ctx, px, 7, 8, 2, 1, wax);

  const lift = flap * 6;
  const fy = 2 - lift;
  const rows: Array<[number, number, number]> = [
    [6, fy, 4],
    [5, fy + 1, 6],
    [4, fy + 2, 8],
    [3, fy + 3, 10],
    [2, fy + 4, 12],
  ];
  for (const [x, y, w] of rows) {
    if (y < -1 || y > 13) continue;
    fill(ctx, px, x, y, w, 1, flapC);
    fill(ctx, px, x, y, 1, 1, ink);
    fill(ctx, px, x + w - 1, y, 1, 1, ink);
    fill(ctx, px, x + 1, y, Math.max(1, w - 2), 0.35, flapHi);
  }
}

function PixelEnvelope({
  size = 128,
  opening = false,
}: {
  size?: number;
  opening?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const flapRef = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cols = 16;
    const rows = 14;
    const unit = 8;
    canvas.width = cols * unit;
    canvas.height = rows * unit;
    ctx.imageSmoothingEnabled = false;

    let raf = 0;
    let start = 0;
    const frame = (t: number) => {
      if (!start) start = t;
      const elapsed = t - start;
      flapRef.current = opening ? Math.min(1, elapsed / 1100) : 0;
      ctx.imageSmoothingEnabled = false;
      drawPixelEnvelope(ctx, unit, flapRef.current);
      if (opening && flapRef.current < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [opening]);

  return (
    <canvas
      ref={ref}
      className="pixel-envelope"
      width={128}
      height={112}
      style={{ width: size, height: Math.round(size * (14 / 16)) }}
      aria-hidden
    />
  );
}

export function LetterReveal({ letter, onDismiss, onPhaseChange }: Props) {
  const [phase, setPhase] = useState<Phase>("icon");
  const particles = useMemo(() => buildParticles(letter.id), [letter.id]);
  const fanfare = useMemo(() => buildFanfare(letter.id), [letter.id]);
  const fanfarePlayed = useRef(false);
  const onPhaseChangeRef = useRef(onPhaseChange);
  const onDismissRef = useRef(onDismiss);
  onPhaseChangeRef.current = onPhaseChange;
  onDismissRef.current = onDismiss;

  useEffect(() => {
    setPhase("icon");
    fanfarePlayed.current = false;
  }, [letter.id]);

  useEffect(() => {
    onPhaseChangeRef.current?.(phase);
  }, [phase]);

  useEffect(() => {
    if (phase !== "icon") return;
    const t = window.setTimeout(() => onDismissRef.current(), ICON_TTL_MS);
    return () => window.clearTimeout(t);
  }, [phase, letter.id]);

  useEffect(() => {
    if (phase !== "opening") return;
    const t = window.setTimeout(() => setPhase("revealed"), OPEN_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "revealed") return;
    const t = window.setTimeout(() => onDismissRef.current(), REVEALED_TTL_MS);
    return () => window.clearTimeout(t);
  }, [phase, letter.id]);

  useEffect(() => {
    if (phase !== "revealed" || fanfarePlayed.current) return;
    fanfarePlayed.current = true;
    playLetterFanfare();
  }, [phase]);

  if (phase === "icon") {
    return (
      <button
        type="button"
        className="letter-icon"
        aria-label="편지 열기"
        onClick={(e) => {
          e.stopPropagation();
          setPhase("opening");
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="letter-icon-glow" aria-hidden />
        <span className="letter-spark letter-spark-a" aria-hidden />
        <span className="letter-spark letter-spark-b" aria-hidden />
        <span className="letter-spark letter-spark-c" aria-hidden />
        <PixelEnvelope size={132} />
        <span className="letter-icon-bang">!</span>
        <span className="letter-icon-label">편지 도착</span>
      </button>
    );
  }

  return (
    <div
      className={`letter-reveal-layer${phase === "revealed" ? " revealed" : " opening"}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (phase === "revealed") onDismiss();
      }}
    >
      <div
        className="letter-reveal-card"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className={`letter-open-stage${phase === "opening" ? " opening" : " open"}`}>
          <PixelEnvelope size={phase === "revealed" ? 96 : 168} opening />
        </div>

        {phase === "opening" && <p className="letter-wait">두근… 두근…</p>}

        <div className="letter-particles" aria-hidden>
          {particles.map((p) => (
            <span
              key={p.id}
              className={`letter-particle${p.heart ? " heart" : ""}`}
              style={{
                left: `${p.left}%`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                width: p.size,
                height: p.size,
                background: p.color,
              }}
            />
          ))}
        </div>

        {phase === "revealed" && (
          <>
            <div className="letter-fanfare" aria-hidden>
              <span className="letter-fanfare-flash" />
              <span className="letter-fanfare-ray a" />
              <span className="letter-fanfare-ray b" />
              <span className="letter-fanfare-ray c" />
              <span className="letter-fanfare-ray d" />
              <span className="letter-fanfare-banner">♪ 짠!</span>
              {fanfare.map((p) => (
                <span
                  key={p.id}
                  className={`letter-fanfare-bit ${p.kind}`}
                  style={
                    {
                      "--dx": `${p.dx}px`,
                      "--dy": `${p.dy}px`,
                      "--spin": `${p.spin * 90}deg`,
                      animationDelay: `${p.delay}s`,
                      animationDuration: `${p.duration}s`,
                      width: p.size,
                      height: p.size,
                      background: p.color,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
            <p className="letter-from">{letter.nickname}의 편지</p>
            <p className="letter-reveal-text">{letter.text}</p>
            <button
              type="button"
              className="letter-dismiss"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
            >
              닫기
            </button>
          </>
        )}
      </div>
    </div>
  );
}
