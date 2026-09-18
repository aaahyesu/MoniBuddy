import type { Edge } from "@monibuddy/shared";

export type BorderPoint = { x: number; y: number; edge: Edge; facing: 1 | -1 };

/** Which screen edges the buddy may walk on. */
export type PathMode = "all" | "top" | "bottom" | "left" | "right";

export const PATH_MODE_OPTIONS: Array<{ value: PathMode; label: string }> = [
  { value: "all", label: "사방 전체" },
  { value: "bottom", label: "하단만" },
  { value: "top", label: "상단만" },
  { value: "left", label: "왼쪽만" },
  { value: "right", label: "오른쪽만" },
];

type Seg = {
  edge: Edge;
  length: number;
  /** Local t in [0,1] → world point */
  at: (t: number) => { x: number; y: number; facing: 1 | -1 };
};

const FIXED_INSET = 40;

function edgesForMode(mode: PathMode): Edge[] {
  if (mode === "all") return ["top", "right", "bottom", "left"];
  return [mode];
}

function buildSegments(
  width: number,
  height: number,
  inset: number,
  mode: PathMode,
): Seg[] {
  const left = inset;
  const top = inset;
  const right = Math.max(inset + 1, width - inset);
  const bottom = Math.max(inset + 1, height - inset);
  const w = Math.max(1, right - left);
  const h = Math.max(1, bottom - top);

  const all: Record<Edge, Seg> = {
    top: {
      edge: "top",
      length: w,
      at: (t) => ({ x: left + t * w, y: top, facing: 1 }),
    },
    right: {
      edge: "right",
      length: h,
      at: (t) => ({ x: right, y: top + t * h, facing: 1 }),
    },
    bottom: {
      edge: "bottom",
      length: w,
      at: (t) => ({ x: right - t * w, y: bottom, facing: -1 }),
    },
    left: {
      edge: "left",
      length: h,
      at: (t) => ({ x: left, y: bottom - t * h, facing: -1 }),
    },
  };

  return edgesForMode(mode).map((e) => all[e]);
}

function totalLength(segs: Seg[]) {
  return Math.max(1, segs.reduce((s, seg) => s + seg.length, 0));
}

/** Walk along allowed edges. progress in [0,1). */
export function pointOnBorder(
  width: number,
  height: number,
  inset: number,
  progress: number,
  mode: PathMode = "all",
): BorderPoint {
  const segs = buildSegments(width, height, inset || FIXED_INSET, mode);
  const peri = totalLength(segs);
  let d = (((progress % 1) + 1) % 1) * peri;

  for (const seg of segs) {
    if (d <= seg.length) {
      const t = seg.length <= 0 ? 0 : d / seg.length;
      const p = seg.at(t);
      return { x: p.x, y: p.y, edge: seg.edge, facing: p.facing };
    }
    d -= seg.length;
  }

  const last = segs[segs.length - 1];
  const p = last.at(1);
  return { x: p.x, y: p.y, edge: last.edge, facing: p.facing };
}

export function advanceProgress(progress: number, dtSec: number, speed = 0.04): number {
  return (progress + dtSec * speed) % 1;
}

/** Map a screen point to the nearest progress on the allowed path. */
export function nearestProgressOnBorder(
  width: number,
  height: number,
  inset: number,
  x: number,
  y: number,
  mode: PathMode = "all",
): number {
  const segs = buildSegments(width, height, inset || FIXED_INSET, mode);
  const peri = totalLength(segs);

  let bestDist = Infinity;
  let bestD = 0;
  let offset = 0;

  for (const seg of segs) {
    // Sample densely enough for nearest point on segment
    const steps = Math.max(8, Math.ceil(seg.length / 12));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const p = seg.at(t);
      const dist = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        bestD = offset + t * seg.length;
      }
    }
    offset += seg.length;
  }

  return (((bestD % peri) + peri) % peri) / peri;
}

/** Shift progress by a pixel delta along the path (for relative grip drag). */
export function scrubProgress(
  width: number,
  height: number,
  inset: number,
  progress: number,
  dx: number,
  dy: number,
  mode: PathMode = "all",
): number {
  const segs = buildSegments(width, height, inset || FIXED_INSET, mode);
  const peri = totalLength(segs);
  const pt = pointOnBorder(width, height, inset, progress, mode);

  // Project pointer delta onto the current edge tangent
  let along = 0;
  if (pt.edge === "top") along = dx;
  else if (pt.edge === "bottom") along = -dx;
  else if (pt.edge === "right") along = dy;
  else along = -dy;

  return (((progress + along / peri) % 1) + 1) % 1;
}

export { FIXED_INSET };
