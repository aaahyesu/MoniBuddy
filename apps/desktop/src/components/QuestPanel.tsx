import { QUESTS } from "../lib/quests";

type QuestRow = {
  id: string;
  title: string;
  description: string;
  rewardBuddyId: string;
  target: number;
  progress: number;
  done: boolean;
};

type Props = {
  quests: QuestRow[];
  unlockNotices: string[];
  onDismissNotices: () => void;
  compact?: boolean;
};

export function QuestPanel({ quests, unlockNotices, onDismissNotices, compact }: Props) {
  return (
    <section className={compact ? "quest-compact" : "card"}>
      {!compact && <h2 style={{ marginTop: 0 }}>퀘스트 · 해금</h2>}
      {!compact && (
        <p className="muted" style={{ marginTop: 0 }}>
          미션을 완료해 보상 버디를 해금하세요. 보상 GIF 파일은 나중에 추가해도 됩니다.
        </p>
      )}

      {unlockNotices.length > 0 && (
        <div className="unlock-banner">
          해금됨: {unlockNotices.join(", ")}
          <button type="button" className="ghost" onClick={onDismissNotices}>
            확인
          </button>
        </div>
      )}

      <div className="quest-list">
        {quests.map((q) => {
          const pct = Math.min(100, Math.round((q.progress / q.target) * 100));
          return (
            <div key={q.id} className={`quest-item${q.done ? " done" : ""}`}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{q.title}</strong>
                <span className="muted">
                  {Math.min(q.progress, q.target)}/{q.target}
                  {q.done ? " · 완료" : ""}
                </span>
              </div>
              <div className="muted">{q.description}</div>
              <div className="muted">보상: {q.rewardBuddyId}</div>
              <div className="quest-bar">
                <div style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {QUESTS.length === 0 && <p className="muted">등록된 퀘스트가 없습니다.</p>}
    </section>
  );
}
