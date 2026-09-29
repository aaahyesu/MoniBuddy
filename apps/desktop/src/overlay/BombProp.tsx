import { useEffect, useState, type MouseEvent } from "react";

type Props = {
  isHolder: boolean;
  /** top edge → bomb below actor; else above */
  placeBelow: boolean;
  peerNicks: string[];
  onPassRandom: () => void;
  onPassNick: (nick: string) => void;
  onNoPeers?: () => void;
};

/** 16×16 격자 폭탄 */
export function PixelBombIcon({
  className = "",
  large = false,
}: {
  className?: string;
  large?: boolean;
}) {
  return (
    <span
      className={`pixel-bomb-icon${large ? " large" : ""} ${className}`.trim()}
      aria-hidden
    >
      <svg
        viewBox="0 0 16 16"
        width={large ? 96 : 40}
        height={large ? 96 : 40}
        shapeRendering="crispEdges"
      >
        <rect x="7" y="1" width="1" height="1" fill="#111" />
        <rect x="8" y="0" width="1" height="1" fill="#111" />
        <rect x="9" y="0" width="1" height="1" fill="#111" />
        <rect x="10" y="0" width="1" height="1" className="bomb-spark-core" />
        <rect x="11" y="0" width="1" height="1" className="bomb-spark-mid" />
        <rect x="10" y="1" width="1" height="1" className="bomb-spark-mid" />
        <rect x="9" y="1" width="1" height="1" className="bomb-spark-outer" />
        <rect x="11" y="1" width="1" height="1" className="bomb-spark-outer" />
        <rect x="7" y="2" width="2" height="2" fill="#111" />
        <rect x="4" y="4" width="8" height="1" fill="#111" />
        <rect x="3" y="5" width="10" height="1" fill="#111" />
        <rect x="2" y="6" width="12" height="1" fill="#111" />
        <rect x="2" y="7" width="12" height="1" fill="#111" />
        <rect x="2" y="8" width="12" height="1" fill="#111" />
        <rect x="2" y="9" width="12" height="1" fill="#111" />
        <rect x="2" y="10" width="12" height="1" fill="#111" />
        <rect x="3" y="11" width="10" height="1" fill="#111" />
        <rect x="4" y="12" width="8" height="1" fill="#111" />
        <rect x="5" y="13" width="6" height="1" fill="#111" />
        <rect x="10" y="6" width="1" height="3" fill="#fff" />
        <rect x="11" y="7" width="1" height="2" fill="#fff" />
        <rect x="9" y="7" width="1" height="1" fill="#fff" />
        <rect x="4" y="10" width="1" height="1" fill="#fff" />
        <rect x="3" y="9" width="1" height="1" fill="#fff" />
      </svg>
    </span>
  );
}

export function BombProp({
  isHolder,
  placeBelow,
  peerNicks,
  onPassRandom,
  onPassNick,
  onNoPeers,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!isHolder) setMenuOpen(false);
  }, [isHolder]);

  const passTo = (nick: string) => {
    onPassNick(nick);
    setMenuOpen(false);
  };

  const onBombClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!isHolder) return;
    if (peerNicks.length === 0) {
      onNoPeers?.();
      return;
    }
    // 상대 1명이면 바로 넘김
    if (peerNicks.length === 1) {
      passTo(peerNicks[0]);
      return;
    }
    setMenuOpen((v) => !v);
  };

  return (
    <div
      className={`bomb-prop ${placeBelow ? "below" : "above"}${isHolder ? " holder" : ""}${menuOpen ? " menu-open" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="bomb-prop-hit"
        aria-label={isHolder ? "클릭해서 폭탄 넘기기" : "폭탄"}
        title={isHolder ? "클릭해서 넘기기" : undefined}
        disabled={!isHolder}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onBombClick}
      >
        <PixelBombIcon className="tick" />
      </button>
      {isHolder && menuOpen ? (
        <div className="bomb-prop-actions">
          <button
            type="button"
            className="bomb-pass-random"
            onClick={(e) => {
              e.stopPropagation();
              onPassRandom();
              setMenuOpen(false);
            }}
          >
            랜덤
          </button>
          {peerNicks.map((n) => (
            <button
              key={n}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                passTo(n);
              }}
            >
              {n}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
