import { QUESTS } from "../lib/quests";
import { Btn } from "./ui";
import { cn } from "../lib/cn";

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

export function QuestPanel({
  quests,
  unlockNotices,
  onDismissNotices,
  compact,
}: Props) {
  return (
    <section className={cn("grid gap-2.5", !compact && "rounded-2xl border border-white/14 bg-white/[0.08] p-4")}>
      {!compact && (
        <>
          <h2 className="m-0 text-lg font-semibold text-ink">퀘스트 · 해금</h2>
          <p className="m-0 text-[0.9rem] text-mute">
            미션을 완료해 보상 버디를 해금하세요. 보상 GIF 파일은 나중에 추가해도 됩니다.
          </p>
        </>
      )}

      {unlockNotices.length > 0 && (
        <div className="mb-1 flex items-center justify-between gap-3 rounded-xl border border-[rgba(157,186,138,0.32)] bg-[rgba(157,186,138,0.18)] px-3 py-2.5 text-[#e4f0d8]">
          <span>해금됨: {unlockNotices.join(", ")}</span>
          <Btn variant="ghost" onClick={onDismissNotices}>
            확인
          </Btn>
        </div>
      )}

      <div className="grid w-full gap-2.5 border border-white/50 bg-black/40 p-3">
        {quests.map((q) => {
          const pct = Math.min(100, Math.round((q.progress / q.target) * 100));
          return (
            <div
              key={q.id}
              className={cn(
                "border border-white/40 bg-black/50 px-3 py-2.5",
                q.done && "opacity-70",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <strong className="text-[0.82rem] text-white">{q.title}</strong>
                <span className="text-[0.72rem] text-mute">
                  {Math.min(q.progress, q.target)}/{q.target}
                  {q.done ? " · OK" : ""}
                </span>
              </div>
              <div className="mt-1 text-[0.75rem] text-mute">{q.description}</div>
              <div className="text-[0.72rem] text-accent-cyan">보상: {q.rewardBuddyId}</div>
              <div className="mt-2 h-1.5 overflow-hidden border border-white/30 bg-black">
                <div
                  className="h-full bg-white"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {QUESTS.length === 0 && (
        <p className="m-0 text-[0.9rem] text-mute">등록된 퀘스트가 없습니다.</p>
      )}
    </section>
  );
}
