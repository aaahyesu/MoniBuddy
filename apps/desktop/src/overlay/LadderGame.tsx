import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { LadderState, Member } from "@monibuddy/shared";
import { CharacterView } from "../components/CharacterView";

type Props = {
  ladder: LadderState;
  members: Member[];
  selfMemberId: string | null;
  serverUrl: string;
  onStart: (payload: {
    memberIds: string[];
    outcomes?: string[];
    mode: "winlose" | "custom";
  }) => void;
  onCancel: () => void;
  onDismissDone: () => void;
};

type Pt = { x: number; y: number };

/** 열 간격(유닛). 레일 x = (col + 0.5) 로 CSS 그리드 중앙과 일치 */
const COL_W = 1;
const CELL_H = 1;
/** 경로 이동 속도 (viewBox 단위 / ms) — 가로 이동이 눈에 띄게 */
const SPEED = 0.0032;

function outcomeKind(text: string): "win" | "lose" | "custom" {
  const t = text.trim();
  if (/^(당첨|선물|win|gift)$/i.test(t)) return "win";
  if (/^(꽝|폭탄|lose|bomb)$/i.test(t)) return "lose";
  return "custom";
}

function railX(col: number): number {
  return (col + 0.5) * COL_W;
}

/** 세로↓ → 가로→ → 세로↓ 연속 좌표 */
function buildWaypoints(
  startCol: number,
  columns: number,
  rungs: boolean[][],
): Pt[] {
  const pts: Pt[] = [];
  let col = startCol;
  pts.push({ x: railX(col), y: 0 });
  for (let ri = 0; ri < rungs.length; ri++) {
    const row = rungs[ri]!;
    const yMid = (ri + 0.5) * CELL_H;
    const yBot = (ri + 1) * CELL_H;
    pts.push({ x: railX(col), y: yMid });
    let next = col;
    if (col > 0 && row[col - 1]) next = col - 1;
    else if (col < columns - 1 && row[col]) next = col + 1;
    if (next !== col) {
      pts.push({ x: railX(next), y: yMid });
      col = next;
    }
    pts.push({ x: railX(col), y: yBot });
  }
  return pts;
}

function pathLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

function pointAt(pts: Pt[], dist: number): Pt {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0]!;
  let left = Math.max(0, dist);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y) || 1e-6;
    if (left <= seg) {
      const t = left / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= seg;
  }
  return pts[pts.length - 1]!;
}

function endColOf(startCol: number, columns: number, rungs: boolean[][]): number {
  let col = startCol;
  for (const row of rungs) {
    if (col > 0 && row[col - 1]) col -= 1;
    else if (col < columns - 1 && row[col]) col += 1;
  }
  return col;
}

function ptsToPolyline(pts: Pt[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(" ");
}

export function LadderGame({
  ladder,
  members,
  selfMemberId,
  serverUrl,
  onStart,
  onCancel,
  onDismissDone,
}: Props) {
  const isHost = selfMemberId === ladder.hostMemberId;
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"winlose" | "custom">("winlose");
  const [customs, setCustoms] = useState<string[]>([]);
  const [animPlayer, setAnimPlayer] = useState(-1);
  const [revealedEnds, setRevealedEnds] = useState<number[]>([]);
  const [traveling, setTraveling] = useState(false);
  const [tracePts, setTracePts] = useState<Pt[]>([]);
  const animGenRef = useRef(0);
  const travelerElRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const vbRef = useRef({ w: 1, h: 1 });

  // sync 폴링이 rungs 참조를 바꿔도 연출이 리셋되지 않게 고정 키
  const runKey =
    ladder.phase === "running"
      ? `${ladder.memberIds.join(",")}|${ladder.outcomes.join("\0")}|${ladder.rungs.length}`
      : "";

  useEffect(() => {
    if (ladder.phase !== "setup") return;
    setSelected(members.map((m) => m.id));
  }, [ladder.phase, members]);

  useEffect(() => {
    if (mode !== "custom") return;
    setCustoms((prev) =>
      selected.map((_, i) => prev[i] ?? (i === 0 ? "당첨" : "꽝")),
    );
  }, [selected, mode]);

  useEffect(() => {
    if (ladder.phase !== "running" || !runKey) return;
    const cols = ladder.names.length;
    if (cols === 0) return;
    const rungs = ladder.rungs.map((row) => row.map((v) => Boolean(v)));
    const gen = ++animGenRef.current;
    let raf = 0;
    let player = 0;
    let pts = buildWaypoints(0, cols, rungs);
    let dist = 0;
    let last = performance.now();
    let pauseUntil = 0;

    /** SVG viewBox 좌표 → wrap 기준 px (레일·가로줄과 동일 투영) */
    const place = (pt: Pt | null) => {
      const el = travelerElRef.current;
      const svg = svgRef.current;
      const wrap = wrapRef.current;
      if (!el) return;
      if (!pt || !svg || !wrap) {
        el.style.opacity = "0";
        return;
      }
      const { w, h } = vbRef.current;
      const s = svg.getBoundingClientRect();
      const box = wrap.getBoundingClientRect();
      const x = s.left - box.left + (pt.x / w) * s.width;
      const y = s.top - box.top + (pt.y / h) * s.height;
      el.style.opacity = "1";
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };

    setAnimPlayer(0);
    setRevealedEnds([]);
    setTraveling(true);
    setTracePts(pts);
    place(pts[0] ?? null);

    const tick = (now: number) => {
      if (gen !== animGenRef.current) return;
      const dt = Math.min(48, now - last);
      last = now;

      if (now < pauseUntil) {
        raf = requestAnimationFrame(tick);
        return;
      }

      dist += SPEED * dt;
      const total = pathLength(pts);
      if (dist >= total) {
        place(pts[pts.length - 1] ?? null);
        const end = endColOf(player, cols, rungs);
        setRevealedEnds((prev) =>
          prev.includes(end) ? prev : [...prev, end],
        );
        player += 1;
        if (player >= cols) {
          setAnimPlayer(-1);
          setTraveling(false);
          setTracePts([]);
          place(null);
          return;
        }
        setAnimPlayer(player);
        pts = buildWaypoints(player, cols, rungs);
        setTracePts(pts);
        dist = 0;
        pauseUntil = now + 280;
        place(pts[0] ?? null);
        raf = requestAnimationFrame(tick);
        return;
      }

      place(pointAt(pts, dist));
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      animGenRef.current += 1;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  useEffect(() => {
    if (ladder.phase !== "done") return;
    setRevealedEnds(ladder.outcomes.map((_, i) => i));
    setTraveling(false);
    setAnimPlayer(-1);
  }, [ladder.phase, ladder.outcomes.length]);

  const memberById = useMemo(() => {
    const map = new Map(members.map((m) => [m.id, m]));
    return map;
  }, [members]);

  if (ladder.phase === "setup" && isHost) {
    return (
      <div className="ladder-panel setup">
        <header className="ladder-head">
          <h3>사다리타기</h3>
          <p className="ladder-hint">
            결과 칸은 인원수만큼 · 누가 뭘 받을지는 항상 랜덤
          </p>
        </header>

        <section className="ladder-section">
          <div className="ladder-section-label">참가자</div>
          <div className="ladder-picks">
            {members.map((m) => {
              const on = selected.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  className={on ? "on" : ""}
                  onClick={() =>
                    setSelected((prev) =>
                      on ? prev.filter((id) => id !== m.id) : [...prev, m.id],
                    )
                  }
                >
                  {m.nickname}
                </button>
              );
            })}
          </div>
        </section>

        <section className="ladder-section">
          <div className="ladder-section-label">결과 칸</div>
          <div className="ladder-modes">
            <button
              type="button"
              className={mode === "winlose" ? "on" : ""}
              onClick={() => setMode("winlose")}
            >
              꽝 / 당첨
            </button>
            <button
              type="button"
              className={mode === "custom" ? "on" : ""}
              onClick={() => setMode("custom")}
            >
              사용자 지정
            </button>
          </div>
          {mode === "winlose" ? (
            <p className="ladder-mode-note">
              당첨 1 · 꽝 {Math.max(0, selected.length - 1)} · 배치는 랜덤
            </p>
          ) : (
            <div className="ladder-customs">
              {selected.map((_, i) => (
                <label key={`slot-${i}`}>
                  <span className="ladder-slot-no">{i + 1}</span>
                  <input
                    value={customs[i] ?? ""}
                    maxLength={12}
                    placeholder={`결과 ${i + 1}`}
                    onChange={(e) => {
                      const next = [...customs];
                      next[i] = e.target.value;
                      setCustoms(next);
                    }}
                  />
                </label>
              ))}
            </div>
          )}
        </section>

        <div className="ladder-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            className="primary"
            disabled={selected.length < 1}
            onClick={() =>
              onStart({
                memberIds: selected,
                mode,
                outcomes:
                  mode === "custom"
                    ? selected.map(
                        (_, i) => customs[i]?.trim() || `결과${i + 1}`,
                      )
                    : undefined,
              })
            }
          >
            시작
          </button>
        </div>
      </div>
    );
  }

  if (ladder.phase === "setup" && !isHost) {
    return (
      <div className="ladder-panel wait">
        <p>
          <strong>{ladder.hostNickname}</strong> 님이 사다리를 준비 중…
        </p>
      </div>
    );
  }

  if (ladder.phase === "running" || ladder.phase === "done") {
    const cols = Math.max(ladder.names.length, 1);
    const rows = Math.max(ladder.rungs.length, 1);
    const vbW = cols * COL_W;
    const vbH = rows * CELL_H;
    vbRef.current = { w: vbW, h: vbH };
    const movingMember =
      animPlayer >= 0
        ? memberById.get(ladder.memberIds[animPlayer] ?? "")
        : undefined;

    return (
      <div className="ladder-panel reveal">
        <header className="ladder-head">
          <h3>사다리타기</h3>
          <p className="ladder-hint">
            {ladder.phase === "running" ? "내려가는 중…" : "결과"}
          </p>
        </header>

        <div
          className="ladder-board"
          style={
            {
              ["--cols" as string]: String(cols),
              ["--vb-w" as string]: String(vbW),
              ["--vb-h" as string]: String(vbH),
            } as CSSProperties
          }
        >
          <div className="ladder-stage">
            <div className="ladder-tops">
              {ladder.names.map((n, i) => {
                const m = memberById.get(ladder.memberIds[i] ?? "");
                const hiding = traveling && animPlayer === i;
                return (
                  <div
                    key={`t-${ladder.memberIds[i] ?? n}-${i}`}
                    className={`ladder-top${animPlayer === i ? " active" : ""}${hiding ? " traveling" : ""}`}
                  >
                    <span className="ladder-num">{i + 1}</span>
                    <div className="ladder-avatar">
                      {m ? (
                        <CharacterView
                          character={m.character}
                          serverUrl={serverUrl}
                          size={26}
                          fixedSize
                        />
                      ) : (
                        <span className="ladder-avatar-fallback">
                          {n.slice(0, 1)}
                        </span>
                      )}
                    </div>
                    <span className="ladder-nick">{n}</span>
                  </div>
                );
              })}
            </div>

            <div className="ladder-svg-wrap" ref={wrapRef}>
              <svg
                ref={svgRef}
                className="ladder-svg"
                viewBox={`0 0 ${vbW} ${vbH}`}
                preserveAspectRatio="none"
              >
                {Array.from({ length: cols }, (_, c) => (
                  <line
                    key={`v-${c}`}
                    x1={railX(c)}
                    y1={0}
                    x2={railX(c)}
                    y2={vbH}
                    className="ladder-rail"
                  />
                ))}
                {ladder.rungs.map((row, ri) =>
                  row.map((on, gi) =>
                    on ? (
                      <line
                        key={`h-${ri}-${gi}`}
                        x1={railX(gi)}
                        y1={(ri + 0.5) * CELL_H}
                        x2={railX(gi + 1)}
                        y2={(ri + 0.5) * CELL_H}
                        className="ladder-rung"
                      />
                    ) : null,
                  ),
                )}
                {tracePts.length > 1 ? (
                  <polyline
                    points={ptsToPolyline(tracePts)}
                    className="ladder-trace"
                  />
                ) : null}
              </svg>
              <div
                ref={travelerElRef}
                className={`ladder-traveler${movingMember ? "" : " dot"}`}
                style={{ opacity: 0 }}
              >
                {movingMember ? (
                  <CharacterView
                    character={movingMember.character}
                    serverUrl={serverUrl}
                    size={22}
                    fixedSize
                  />
                ) : null}
              </div>
            </div>

            <div className="ladder-bottoms">
              {ladder.outcomes.map((o, i) => {
                const kind = outcomeKind(o);
                const show =
                  ladder.phase === "done" || revealedEnds.includes(i);
                return (
                  <div
                    key={`o-${i}`}
                    className={`ladder-outcome ${kind}${show ? " show" : ""}`}
                  >
                    <span className="ladder-outcome-text">
                      {show ? o : "·"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {ladder.phase === "done" && ladder.results ? (
          <ul className="ladder-results">
            {ladder.results.map((r, i) => (
              <li key={`${r.name}-${i}`}>
                <span className="ladder-num sm">{i + 1}</span>
                <strong>{r.name}</strong>
                <span className="ladder-arrow">→</span>
                <span>{r.outcome}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {ladder.phase === "done" ? (
          <button type="button" className="primary" onClick={onDismissDone}>
            닫기
          </button>
        ) : null}
      </div>
    );
  }

  return null;
}
