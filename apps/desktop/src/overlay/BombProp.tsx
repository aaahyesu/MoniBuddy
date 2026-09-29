import { useEffect, useState } from "react";
import type { BombState } from "@monibuddy/shared";

type Props = {
  bomb: BombState;
  isHolder: boolean;
  /** top edge → bomb below actor; else above */
  placeBelow: boolean;
  peerNicks: string[];
  onPassRandom: () => void;
  onPassNick: (nick: string) => void;
};

export function BombProp({
  bomb,
  isHolder,
  placeBelow,
  peerNicks,
  onPassRandom,
  onPassNick,
}: Props) {
  const [left, setLeft] = useState(0);
  const [pickOpen, setPickOpen] = useState(false);

  useEffect(() => {
    const tick = () => {
      setLeft(Math.max(0, Math.ceil((bomb.endsAt - Date.now()) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [bomb.endsAt]);

  return (
    <div
      className={`bomb-prop ${placeBelow ? "below" : "above"}${isHolder ? " holder" : ""}`}
    >
      <div className="bomb-prop-icon" aria-hidden>
        💣
      </div>
      <div className="bomb-prop-meta">
        <strong>{left}s</strong>
        <span>{bomb.holderNickname}</span>
      </div>
      {isHolder ? (
        <div className="bomb-prop-actions">
          <button type="button" onClick={onPassRandom}>
            랜덤 넘기기
          </button>
          <button type="button" onClick={() => setPickOpen((v) => !v)}>
            지정 넘기기
          </button>
          {pickOpen ? (
            <div className="bomb-prop-picks">
              {peerNicks.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    onPassNick(n);
                    setPickOpen(false);
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
