import { useEffect, useRef, useState } from "react";
import type { BombExplodePayload } from "@monibuddy/shared";

type Props = {
  payload: BombExplodePayload;
  onDone: () => void;
};

const SHEET = "/effects/bomb-boom.png";
const FRAME_W = 32;
const FRAME_H = 32;
const FRAME_COUNT = 8;
/** 프레임별 표시 ms — 폭탄 → 균열 → 폭발 → 소멸 */
const FRAME_MS = [90, 110, 90, 100, 140, 160, 140, 120];

export function BombBoom({ payload, onDone }: Props) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [frame, setFrame] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setReady(true);
    img.src = SHEET;
  }, []);

  useEffect(() => {
    if (!ready) return;
    let i = 0;
    setFrame(0);
    let timer = 0;
    let finished = false;
    const tick = () => {
      if (finished) return;
      if (i >= FRAME_COUNT - 1) {
        finished = true;
        // 마지막 프레임을 잠깐 보여 준 뒤 종료 (조기 unmount → 짧은 재재생 체감 완화)
        timer = window.setTimeout(
          () => doneRef.current(),
          FRAME_MS[FRAME_COUNT - 1] ?? 120,
        );
        return;
      }
      i += 1;
      setFrame(i);
      timer = window.setTimeout(tick, FRAME_MS[i] ?? 100);
    };
    timer = window.setTimeout(tick, FRAME_MS[0]);
    return () => {
      finished = true;
      window.clearTimeout(timer);
    };
  }, [ready, payload.at]);

  const scale = 10;
  const display = FRAME_W * scale;

  return (
    <div
      className="bomb-boom boom-play"
      role="img"
      aria-label={`${payload.holderNickname} 폭탄 폭발`}
    >
      <div
        className="bomb-boom-sprite"
        style={{
          width: display,
          height: display,
          backgroundImage: ready ? `url(${SHEET})` : undefined,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${FRAME_W * FRAME_COUNT * scale}px ${FRAME_H * scale}px`,
          backgroundPosition: `-${frame * display}px 0`,
          imageRendering: "pixelated",
        }}
      />
      <p className="bomb-boom-caption">{payload.holderNickname}!</p>
    </div>
  );
}
