import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import {
  SKETCH_CATEGORIES,
  SKETCH_MIN_YES,
  type SketchCategoryId,
  type SketchState,
  type SketchStroke,
  type SketchVote,
} from "@monibuddy/shared";

const PEN_COLORS = ["#111111", "#e74c3c", "#3498db", "#2ecc71", "#f1c40f"];
const PEN_WIDTHS = [2, 4, 7, 11] as const;
const PALETTE_COLORS = [
  "#111111",
  "#ffffff",
  "#7f8c8d",
  "#e74c3c",
  "#e67e22",
  "#f1c40f",
  "#2ecc71",
  "#1abc9c",
  "#3498db",
  "#2980b9",
  "#9b59b6",
  "#e91e63",
  "#8d6e63",
  "#ff6b8a",
  "#55ddff",
  "#7dffb3",
  "#ffe14d",
  "#c9a6ff",
];

const SKETCH_OPACITY_KEY = "monibuddy.sketchUiOpacity.v1";
const SKETCH_OPACITY_MIN = 25;
const SKETCH_OPACITY_MAX = 100;
const SKETCH_OPACITY_DEFAULT = 94;

function readSketchOpacity(): number {
  try {
    const n = Number(localStorage.getItem(SKETCH_OPACITY_KEY));
    if (!Number.isFinite(n)) return SKETCH_OPACITY_DEFAULT;
    return Math.max(SKETCH_OPACITY_MIN, Math.min(SKETCH_OPACITY_MAX, Math.round(n)));
  } catch {
    return SKETCH_OPACITY_DEFAULT;
  }
}

type Props = {
  sketch: SketchState;
  selfMemberId: string | null;
  uiRef?: Ref<HTMLDivElement>;
  onVote: (vote: SketchVote) => void;
  onCategory: (categoryId: SketchCategoryId) => void;
  onStart: (categoryId: SketchCategoryId) => void;
  onStroke: (stroke: SketchStroke) => void;
  onClear: () => void;
  onReveal: () => void;
  onCancel: () => void;
  onDismiss: () => void;
};

function useCountdown(endsAt: number | null) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!endsAt) {
      setLeft(0);
      return;
    }
    const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [endsAt]);
  return left;
}

export function SketchGame({
  sketch,
  selfMemberId,
  uiRef,
  onVote,
  onCategory,
  onStart,
  onStroke,
  onClear,
  onReveal,
  onCancel,
  onDismiss,
}: Props) {
  const isHost = Boolean(selfMemberId) && selfMemberId === sketch.hostMemberId;
  const isDrawer =
    Boolean(selfMemberId) && selfMemberId === sketch.drawerMemberId;
  const myVote = sketch.votes.find((v) => v.memberId === selfMemberId)?.vote;
  const yesCount = sketch.playerIds.length;
  const seconds = useCountdown(
    sketch.phase === "drawing" ? sketch.endsAt : null,
  );
  const [uiOpacity, setUiOpacity] = useState(readSketchOpacity);
  const rootStyle = { opacity: uiOpacity / 100 };

  const opacityGauge = (
    <label className="sketch-opacity">
      <span className="sketch-opacity-label">투명도</span>
      <input
        type="range"
        min={SKETCH_OPACITY_MIN}
        max={SKETCH_OPACITY_MAX}
        value={uiOpacity}
        aria-label="스케치 창 투명도"
        onChange={(e) => {
          const next = Number(e.target.value);
          setUiOpacity(next);
          try {
            localStorage.setItem(SKETCH_OPACITY_KEY, String(next));
          } catch {
            /* ignore */
          }
        }}
      />
      <span className="sketch-opacity-value">{uiOpacity}%</span>
    </label>
  );

  if (sketch.phase === "voting") {
    return (
      <div className="sketch-root voting" ref={uiRef} style={rootStyle}>
        <div className="sketch-topbar">
          <div className="sketch-topbar-row">
            <p className="sketch-brand">SKETCH</p>
            {opacityGauge}
          </div>
          <p className="sketch-meta">
            {sketch.totalRounds}판 · 찬성 {yesCount}명
          </p>
          <div className="sketch-cats">
            {SKETCH_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={sketch.categoryId === cat.id ? "on" : ""}
                disabled={!isHost}
                onClick={() => onCategory(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
        <div className="sketch-vote-card">
          <h3>스케치 참가할까요?</h3>
          <p className="sketch-hint">
            <strong>{sketch.hostNickname}</strong> 님이 열었어요 · 찬성한 사람만
            참가
          </p>
          <div className="sketch-vote-actions">
            <button
              type="button"
              className={myVote === "yes" ? "primary on" : "primary"}
              onClick={() => onVote("yes")}
            >
              찬성
            </button>
            <button
              type="button"
              className={myVote === "no" ? "ghost on" : "ghost"}
              onClick={() => onVote("no")}
            >
              반대
            </button>
          </div>
          {isHost ? (
            <div className="sketch-host-actions">
              <button type="button" className="ghost" onClick={onCancel}>
                취소
              </button>
              <button
                type="button"
                className="primary"
                disabled={yesCount < SKETCH_MIN_YES || !sketch.categoryId}
                onClick={() =>
                  sketch.categoryId && onStart(sketch.categoryId)
                }
              >
                시작
              </button>
            </div>
          ) : (
            <p className="sketch-hint wait">주최자가 카테고리를 고르고 시작해요</p>
          )}
        </div>
      </div>
    );
  }

  if (sketch.phase === "done") {
    return (
      <div className="sketch-root done" ref={uiRef} style={rootStyle}>
        <div className="sketch-vote-card">
          <div className="sketch-topbar-row">
            <p className="sketch-brand">SKETCH</p>
            {opacityGauge}
          </div>
          <h3>스케치 종료</h3>
          <p className="sketch-hint">{sketch.totalRounds}판 끝났어요</p>
          <button type="button" className="primary" onClick={onDismiss}>
            닫기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sketch-root play" ref={uiRef} style={rootStyle}>
      <div className="sketch-topbar">
        <div className="sketch-topbar-row">
          <p className="sketch-brand">SKETCH</p>
          {opacityGauge}
        </div>
        <p className="sketch-meta">
          {sketch.roundIndex}/{sketch.totalRounds} ·{" "}
          {sketch.drawerNickname ?? "출제자"}
          {sketch.phase === "drawing" ? ` · ${seconds}초` : ""}
        </p>
        {isDrawer && sketch.phase === "drawing" && sketch.topic ? (
          <p className="sketch-topic">주제: {sketch.topic}</p>
        ) : (
          <p className="sketch-topic dim">
            {sketch.phase === "roundReveal"
              ? "정답 공개"
              : "출제자가 그리는 중… 채팅으로 맞춰 보세요"}
          </p>
        )}
      </div>
      <SketchBoard
        strokes={sketch.strokes}
        canDraw={isDrawer && sketch.phase === "drawing"}
        onStroke={onStroke}
      />
      {sketch.phase === "roundReveal" ? (
        <div className="sketch-reveal">
          <p>
            정답 <strong>{sketch.topic}</strong>
          </p>
          <p className="sketch-hint">
            {sketch.endReason === "guess" && sketch.winnerNickname
              ? `${sketch.winnerNickname} 님이 맞혔어요`
              : sketch.endReason === "timeout"
                ? "시간 종료"
                : "출제자가 공개했어요"}
          </p>
        </div>
      ) : null}
      {isDrawer && sketch.phase === "drawing" ? (
        <div className="sketch-tools">
          <button type="button" className="ghost" onClick={onClear}>
            지우기
          </button>
          <button type="button" className="primary" onClick={onReveal}>
            정답 공개
          </button>
        </div>
      ) : null}
      {isHost && sketch.phase === "drawing" ? (
        <button type="button" className="sketch-cancel ghost" onClick={onCancel}>
          게임 취소
        </button>
      ) : null}
    </div>
  );
}

function SketchBoard({
  strokes,
  canDraw,
  onStroke,
}: {
  strokes: SketchStroke[];
  canDraw: boolean;
  onStroke: (stroke: SketchStroke) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [color, setColor] = useState(PEN_COLORS[0]!);
  const [width, setWidth] = useState<number>(PEN_WIDTHS[1]!);
  const [brushOpen, setBrushOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [palettePos, setPalettePos] = useState({ x: 0, y: 0 });
  const customColorRef = useRef<HTMLInputElement | null>(null);
  const paletteDragRef = useRef<{
    ox: number;
    oy: number;
    sx: number;
    sy: number;
  } | null>(null);
  const isPreset = PEN_COLORS.includes(color);
  const drawingRef = useRef<{
    id: string;
    color: string;
    width: number;
    points: Array<{ x: number; y: number }>;
  } | null>(null);

  const onPaletteFrameDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // 테두리(프레임)만 — 안쪽 색/버튼은 제외
    if ((e.target as HTMLElement).closest(".sketch-palette-body")) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    paletteDragRef.current = {
      ox: palettePos.x,
      oy: palettePos.y,
      sx: e.clientX,
      sy: e.clientY,
    };
  };

  const onPaletteFrameMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = paletteDragRef.current;
    if (!drag) return;
    setPalettePos({
      x: drag.ox + (e.clientX - drag.sx),
      y: drag.oy + (e.clientY - drag.sy),
    });
  };

  const onPaletteFrameUp = () => {
    paletteDragRef.current = null;
  };

  const paint = (extra?: SketchStroke | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#f7f4ea";
    ctx.fillRect(0, 0, w, h);
    const all = extra ? [...strokes, extra] : strokes;
    for (const stroke of all) {
      if (stroke.points.length < 1) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        const x = p.x * w;
        const y = p.y * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      paint(drawingRef.current);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    paint(drawingRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  const toNorm = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!canDraw) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = toNorm(e);
    drawingRef.current = {
      id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      color,
      width,
      points: [pt],
    };
    paint(drawingRef.current);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || !drawingRef.current) return;
    drawingRef.current.points.push(toNorm(e));
    paint(drawingRef.current);
  };

  const endStroke = () => {
    const stroke = drawingRef.current;
    drawingRef.current = null;
    if (!stroke || stroke.points.length < 1) return;
    onStroke(stroke);
  };

  return (
    <div className="sketch-board-wrap">
      <canvas
        ref={canvasRef}
        className="sketch-board"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        style={{ touchAction: "none", cursor: canDraw ? "crosshair" : "default" }}
      />
      {canDraw ? (
        <div className="sketch-pens">
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={color === c ? "on" : ""}
              style={{ background: c }}
              aria-label={`색 ${c}`}
              onClick={() => {
                setColor(c);
                setBrushOpen(false);
                setPaletteOpen(false);
              }}
            />
          ))}
          <div className="sketch-palette">
            <button
              type="button"
              className={`palette-toggle${paletteOpen || !isPreset ? " on" : ""}`}
              aria-label="색 팔레트"
              aria-expanded={paletteOpen}
              title="색 팔레트"
              style={
                !isPreset
                  ? { background: color }
                  : undefined
              }
              onClick={() => {
                setPaletteOpen((v) => !v);
                setBrushOpen(false);
              }}
            >
              <span className="palette-icon" aria-hidden>
                ▦
              </span>
            </button>
            {paletteOpen ? (
              <div
                className="sketch-palette-menu"
                role="dialog"
                aria-label="색 고르기"
                style={{
                  transform: `translate(calc(-50% + ${palettePos.x}px), ${palettePos.y}px)`,
                }}
              >
                <div
                  className="sketch-palette-frame"
                  onPointerDown={onPaletteFrameDown}
                  onPointerMove={onPaletteFrameMove}
                  onPointerUp={onPaletteFrameUp}
                  onPointerCancel={onPaletteFrameUp}
                  title="테두리를 잡고 옮기기"
                >
                  <div className="sketch-palette-body">
                    <div className="sketch-palette-grid">
                      {PALETTE_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={
                            color.toLowerCase() === c.toLowerCase() ? "on" : ""
                          }
                          style={{ background: c }}
                          aria-label={`팔레트 ${c}`}
                          onClick={() => {
                            setColor(c);
                            setPaletteOpen(false);
                          }}
                        />
                      ))}
                    </div>
                    <label className="sketch-palette-custom">
                      <span>직접 고르기</span>
                      <button
                        type="button"
                        className="custom-swatch"
                        style={{ background: color }}
                        onClick={() => customColorRef.current?.click()}
                      />
                      <input
                        ref={customColorRef}
                        type="color"
                        value={
                          /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#111111"
                        }
                        onChange={(e) => setColor(e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <div className="sketch-brush">
            <button
              type="button"
              className={`brush-toggle${brushOpen ? " on" : ""}`}
              aria-label="붓펜 굵기"
              aria-expanded={brushOpen}
              title="붓펜 굵기"
              onClick={() => {
                setBrushOpen((v) => !v);
                setPaletteOpen(false);
              }}
            >
              <span className="brush-icon" aria-hidden>
                <i style={{ height: Math.max(2, Math.round(width * 0.7)) }} />
              </span>
            </button>
            {brushOpen ? (
              <div className="sketch-brush-menu" role="listbox" aria-label="굵기 선택">
                {PEN_WIDTHS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    role="option"
                    aria-selected={width === w}
                    className={width === w ? "on" : ""}
                    onClick={() => {
                      setWidth(w);
                      setBrushOpen(false);
                    }}
                  >
                    <span className="brush-sample">
                      <i style={{ height: Math.max(2, Math.round(w * 0.85)) }} />
                    </span>
                    <span>{w === 2 ? "얇게" : w === 4 ? "보통" : w === 7 ? "굵게" : "아주 굵게"}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
