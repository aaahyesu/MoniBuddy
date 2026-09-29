import { useEffect, useState } from "react";
import type { BombExplodePayload } from "@monibuddy/shared";

type Props = {
  payload: BombExplodePayload;
  onDone: () => void;
};

export function BombBoom({ payload, onDone }: Props) {
  const [phase, setPhase] = useState<"in" | "boom" | "out">("in");

  useEffect(() => {
    const t1 = window.setTimeout(() => setPhase("boom"), 900);
    const t2 = window.setTimeout(() => setPhase("out"), 1800);
    const t3 = window.setTimeout(onDone, 2600);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [onDone, payload.at]);

  return (
    <div className={`bomb-boom phase-${phase}`} role="img" aria-label="폭탄 폭발">
      <div className="bomb-boom-core">
        {phase === "boom" || phase === "out" ? "💥" : "💣"}
      </div>
      <p className="bomb-boom-caption">
        <strong>{payload.holderNickname}</strong> 님 폭탄!
      </p>
    </div>
  );
}
