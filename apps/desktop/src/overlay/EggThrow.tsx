import { useEffect, useRef } from "react";

type Props = {
  onDone: () => void;
};

const TOTAL_MS = 4200;
const APPROACH_END = 0.32;
const IMPACT_END = 0.42;
const CELL = 10;

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

function drawWholeEgg(ctx: CanvasRenderingContext2D, px: number) {
  const shell = "#fff6e8";
  const shade = "#f3d7a4";
  const hi = "#fff";
  const ink = "#1c2430";
  ctx.clearRect(0, 0, px * 16, px * 16);
  const rows: Array<[number, number, number]> = [
    [6, 1, 4],
    [4, 2, 8],
    [3, 3, 10],
    [2, 4, 12],
    [2, 5, 12],
    [1, 6, 14],
    [1, 7, 14],
    [1, 8, 14],
    [1, 9, 14],
    [2, 10, 12],
    [2, 11, 12],
    [3, 12, 10],
    [5, 13, 6],
  ];
  for (const [x, y, w] of rows) {
    fill(ctx, px, x, y, w, 1, shell);
    fill(ctx, px, x, y, 1, 1, ink);
    fill(ctx, px, x + w - 1, y, 1, 1, ink);
  }
  fill(ctx, px, 6, 1, 4, 1, ink);
  fill(ctx, px, 5, 13, 6, 1, ink);
  fill(ctx, px, 4, 4, 2, 3, hi);
  fill(ctx, px, 11, 8, 2, 3, shade);
}

function drawCrackedEgg(ctx: CanvasRenderingContext2D, px: number) {
  const shell = "#fff6e8";
  const ink = "#1c2430";
  const yolk = "#ffe14d";
  const yolkDk = "#f5b942";
  const white = "#fff";
  ctx.clearRect(0, 0, px * 16, px * 16);

  fill(ctx, px, 1, 4, 5, 1, shell);
  fill(ctx, px, 0, 5, 6, 1, shell);
  fill(ctx, px, 0, 6, 5, 1, shell);
  fill(ctx, px, 1, 7, 4, 1, shell);
  fill(ctx, px, 1, 4, 1, 1, ink);
  fill(ctx, px, 5, 4, 1, 1, ink);
  fill(ctx, px, 0, 5, 1, 2, ink);
  fill(ctx, px, 5, 5, 1, 1, ink);
  fill(ctx, px, 4, 6, 1, 1, ink);

  fill(ctx, px, 10, 4, 5, 1, shell);
  fill(ctx, px, 10, 5, 6, 1, shell);
  fill(ctx, px, 11, 6, 5, 1, shell);
  fill(ctx, px, 12, 7, 3, 1, shell);
  fill(ctx, px, 10, 4, 1, 1, ink);
  fill(ctx, px, 14, 4, 1, 1, ink);
  fill(ctx, px, 15, 5, 1, 2, ink);
  fill(ctx, px, 10, 5, 1, 1, ink);

  fill(ctx, px, 5, 8, 6, 1, white);
  fill(ctx, px, 4, 9, 8, 2, white);
  fill(ctx, px, 5, 11, 6, 1, white);
  fill(ctx, px, 6, 9, 4, 3, yolk);
  fill(ctx, px, 7, 10, 2, 2, yolkDk);
  fill(ctx, px, 7, 12, 2, 2, yolk);
  fill(ctx, px, 6, 14, 1, 1, yolkDk);
}

function stamp(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x / CELL) * CELL, Math.round(y / CELL) * CELL, CELL, CELL);
}

function easeInQuint(t: number) {
  return t ** 5;
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

type Stream = {
  xOff: number;
  color: string;
  delay: number;
  cells: number;
};

type ShellShard = {
  xOff: number;
  delay: number;
  drift: number;
  spin: number;
  cells: Array<[number, number]>;
};

function drawShellShard(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  cells: Array<[number, number]>,
  rot: number,
) {
  const shell = "#fff6e8";
  const ink = "#1c2430";
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  for (const [sx, sy] of cells) {
    const rx = sx * cos - sy * sin;
    const ry = sx * sin + sy * cos;
    stamp(ctx, ox + rx * CELL, oy + ry * CELL, shell);
    if (sx === 0 || sy === 0) stamp(ctx, ox + rx * CELL, oy + ry * CELL, ink);
  }
}

export function EggThrow({ onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eggWholeRef = useRef<HTMLCanvasElement>(null);
  const eggCrackRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const whole = eggWholeRef.current;
    const crack = eggCrackRef.current;
    if (whole) {
      const ctx = whole.getContext("2d");
      if (ctx) {
        whole.width = 128;
        whole.height = 128;
        ctx.imageSmoothingEnabled = false;
        drawWholeEgg(ctx, 8);
      }
    }
    if (crack) {
      const ctx = crack.getContext("2d");
      if (ctx) {
        crack.width = 128;
        crack.height = 128;
        ctx.imageSmoothingEnabled = false;
        drawCrackedEgg(ctx, 8);
      }
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = window.innerWidth;
    let h = window.innerHeight;
    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w;
      canvas.height = h;
      ctx.imageSmoothingEnabled = false;
    };
    resize();
    window.addEventListener("resize", resize);

    const streams: Stream[] = [
      { xOff: -6, color: "#ffe14d", delay: 0, cells: 4 },
      { xOff: 34, color: "#f5b942", delay: 0.08, cells: 2 },
      { xOff: -42, color: "#fff6e8", delay: 0.04, cells: 2 },
      { xOff: 8, color: "#fff", delay: 0.12, cells: 1 },
    ];

    const shards: ShellShard[] = [
      {
        xOff: -38,
        delay: 0.02,
        drift: -55,
        spin: -2.4,
        cells: [
          [0, 0],
          [1, 0],
          [2, 0],
          [0, 1],
          [1, 1],
          [2, 1],
          [0, 2],
          [1, 2],
        ],
      },
      {
        xOff: 36,
        delay: 0.06,
        drift: 62,
        spin: 2.1,
        cells: [
          [0, 0],
          [1, 0],
          [2, 0],
          [3, 0],
          [0, 1],
          [1, 1],
          [2, 1],
          [1, 2],
          [2, 2],
        ],
      },
      {
        xOff: -8,
        delay: 0.1,
        drift: 18,
        spin: 1.4,
        cells: [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
          [2, 1],
        ],
      },
      {
        xOff: 16,
        delay: 0.14,
        drift: -28,
        spin: -1.7,
        cells: [
          [0, 0],
          [1, 0],
          [2, 0],
          [1, 1],
          [2, 1],
        ],
      },
    ];

    let raf = 0;
    const t0 = performance.now();
    let finished = false;

    const frame = (now: number) => {
      const elapsed = now - t0;
      const t = Math.min(1, elapsed / TOTAL_MS);
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = false;

      const cx = w * 0.5;
      const cy = h * 0.48;
      let scale = 0.08;
      let rot = -12;
      let cracked = false;
      let eggAlpha = 1;
      let flash = 0;
      let shakeX = 0;
      let shakeY = 0;
      let dripT = 0;

      if (t < APPROACH_END) {
        const p = easeInQuint(t / APPROACH_END);
        scale = lerp(0.06, 2.05, p);
        rot = lerp(-10, 8, p);
      } else if (t < IMPACT_END) {
        const p = (t - APPROACH_END) / (IMPACT_END - APPROACH_END);
        const e = easeOutCubic(p);
        scale = lerp(2.05, 2.2, e);
        rot = lerp(8, -2, e);
        cracked = true;
        flash = Math.max(0, 1 - p * 2.2) * 0.45;
        shakeX = Math.sin(p * Math.PI * 6) * (1 - p) * 10;
        shakeY = Math.cos(p * Math.PI * 5) * (1 - p) * 6;
      } else {
        cracked = true;
        const p = (t - IMPACT_END) / (1 - IMPACT_END);
        scale = lerp(2.2, 1.85, Math.min(1, p * 2.4));
        rot = -2;
        eggAlpha = Math.max(0, 1 - p * 4.5);
        dripT = p;
        flash = 0;
      }

      if (flash > 0.01) {
        ctx.fillStyle = `rgba(255,255,255,${flash})`;
        ctx.fillRect(0, 0, w, h);
      }

      if (eggAlpha > 0.02) {
        const eggSrc = cracked ? eggCrackRef.current : eggWholeRef.current;
        if (eggSrc) {
          const size = 180 * scale;
          ctx.save();
          ctx.globalAlpha = eggAlpha;
          ctx.translate(cx + shakeX, cy + shakeY);
          ctx.rotate((rot * Math.PI) / 180);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(eggSrc, -size / 2, -size / 2, size, size);
          ctx.restore();
        }
      }

      if (dripT > 0) {
        const originY = cy + 28;
        const dripSec = (dripT * ((1 - IMPACT_END) * TOTAL_MS)) / 1000;
        for (const s of streams) {
          const local = dripSec - s.delay;
          if (local <= 0) continue;
          const dist = Math.min(h - originY - CELL, 95 * local * local + 52 * local);
          const head = originY + dist;
          if (head > h + CELL * 4) continue;
          const sway = Math.sin(local * 6.5) * CELL;
          // 고정 시작점에서 길게 남기지 않고, 떨어지는 덩어리 뒤쪽만 짧게 따라감
          const trail = Math.min(dist, CELL * (10 + s.cells * 2));
          const top = head - trail;
          for (let y = top; y <= head; y += CELL) {
            const along = (y - top) / Math.max(CELL, trail);
            const wobble = Math.sin(along * 5 + local * 3) * (CELL * 0.45);
            const width =
              along > 0.78 ? s.cells + 2 : along < 0.2 ? Math.max(1, s.cells - 1) : s.cells;
            for (let i = 0; i < width; i++) {
              stamp(
                ctx,
                cx + s.xOff + sway * along + wobble + (i - (width - 1) / 2) * CELL,
                y,
                s.color,
              );
            }
          }
        }

        for (const shard of shards) {
          const local = dripSec - shard.delay;
          if (local <= 0) continue;
          const fall = 80 * local * local + 40 * local;
          const x = cx + shard.xOff + shard.drift * Math.min(1, local * 0.55);
          const y = originY + fall;
          if (y > h + 40) continue;
          drawShellShard(ctx, x, y, shard.cells, shard.spin * local);
        }
      }

      if (t >= 1) {
        if (!finished) {
          finished = true;
          doneRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="egg-layer">
      <canvas ref={canvasRef} className="egg-scene-canvas" aria-hidden />
      <canvas ref={eggWholeRef} className="egg-sprite-src" width={128} height={128} aria-hidden />
      <canvas ref={eggCrackRef} className="egg-sprite-src" width={128} height={128} aria-hidden />
    </div>
  );
}
