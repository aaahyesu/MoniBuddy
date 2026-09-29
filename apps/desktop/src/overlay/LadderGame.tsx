import { useEffect, useState } from "react";
import type { LadderState, Member } from "@monibuddy/shared";

type Props = {
  ladder: LadderState;
  members: Member[];
  selfMemberId: string | null;
  onStart: (payload: {
    memberIds: string[];
    outcomes?: string[];
    mode: "winlose" | "custom";
  }) => void;
  onCancel: () => void;
  onDismissDone: () => void;
};

export function LadderGame({
  ladder,
  members,
  selfMemberId,
  onStart,
  onCancel,
  onDismissDone,
}: Props) {
  const isHost = selfMemberId === ladder.hostMemberId;
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"winlose" | "custom">("winlose");
  const [customs, setCustoms] = useState<string[]>([]);
  const [animCol, setAnimCol] = useState(-1);

  useEffect(() => {
    if (ladder.phase !== "setup") return;
    setSelected(members.map((m) => m.id));
  }, [ladder.phase, members]);

  useEffect(() => {
    if (ladder.phase !== "running" || ladder.names.length === 0) return;
    let i = 0;
    setAnimCol(0);
    const id = window.setInterval(() => {
      i += 1;
      if (i >= ladder.names.length) {
        window.clearInterval(id);
        return;
      }
      setAnimCol(i);
    }, 700);
    return () => window.clearInterval(id);
  }, [ladder.phase, ladder.names.length]);

  if (ladder.phase === "setup" && isHost) {
    return (
      <div className="ladder-panel">
        <h3>사다리타기</h3>
        <p className="ladder-hint">참가할 멤버를 고르세요 (2명+)</p>
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
            onClick={() => {
              setMode("custom");
              setCustoms(selected.map((_, i) => (i === 0 ? "당첨" : "꽝")));
            }}
          >
            사용자 지정
          </button>
        </div>
        {mode === "custom" ? (
          <div className="ladder-customs">
            {selected.map((id, i) => {
              const m = members.find((x) => x.id === id);
              return (
                <label key={id}>
                  <span>{m?.nickname ?? i + 1}</span>
                  <input
                    value={customs[i] ?? ""}
                    maxLength={12}
                    onChange={(e) => {
                      const next = [...customs];
                      next[i] = e.target.value;
                      setCustoms(next);
                    }}
                  />
                </label>
              );
            })}
          </div>
        ) : null}
        <div className="ladder-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            className="primary"
            disabled={selected.length < 2}
            onClick={() =>
              onStart({
                memberIds: selected,
                mode,
                outcomes:
                  mode === "custom"
                    ? selected.map((_, i) => customs[i] || `결과${i + 1}`)
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
    const cols = ladder.names.length;
    return (
      <div className="ladder-panel reveal">
        <h3>사다리타기</h3>
        <div
          className="ladder-board"
          style={{ ["--cols" as string]: String(Math.max(cols, 1)) }}
        >
          <div className="ladder-names">
            {ladder.names.map((n, i) => (
              <span key={`t-${n}-${i}`} className={animCol === i ? "active" : ""}>
                {n}
              </span>
            ))}
          </div>
          <svg
            className="ladder-svg"
            viewBox={`0 0 ${cols * 40} ${(ladder.rungs.length + 1) * 24}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {Array.from({ length: cols }, (_, c) => (
              <line
                key={`v-${c}`}
                x1={20 + c * 40}
                y1={8}
                x2={20 + c * 40}
                y2={8 + ladder.rungs.length * 24}
                stroke="currentColor"
                strokeWidth="3"
              />
            ))}
            {ladder.rungs.map((row, ri) =>
              row.map((on, gi) =>
                on ? (
                  <line
                    key={`h-${ri}-${gi}`}
                    x1={20 + gi * 40}
                    y1={20 + ri * 24}
                    x2={20 + (gi + 1) * 40}
                    y2={20 + ri * 24}
                    stroke="currentColor"
                    strokeWidth="3"
                  />
                ) : null,
              ),
            )}
          </svg>
          <div className="ladder-outcomes">
            {ladder.outcomes.map((o, i) => (
              <span key={`o-${i}`}>{o}</span>
            ))}
          </div>
        </div>
        {ladder.phase === "done" && ladder.results ? (
          <ul className="ladder-results">
            {ladder.results.map((r) => (
              <li key={r.name}>
                <strong>{r.name}</strong> → {r.outcome}
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
