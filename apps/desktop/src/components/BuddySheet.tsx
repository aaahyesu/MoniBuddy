import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Character } from "@monibuddy/shared";
import { SimpleBuddyPicker } from "./SimpleBuddyPicker";
import { QuestPanel } from "./QuestPanel";
import { Brand, Btn, ShellCard } from "./ui";
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
  character: Character;
  serverUrl: string;
  onChange: (c: Character) => void;
  isUnlocked: (id: string) => boolean;
  getXp: (id: string) => number;
  quests: QuestRow[];
  unlockNotices: string[];
  onDismissNotices: () => void;
  onClose: () => void;
  title?: string;
  initialTab?: "character" | "quests";
};

export function BuddySheet({
  character,
  serverUrl,
  onChange,
  isUnlocked,
  getXp,
  quests,
  unlockNotices,
  onDismissNotices,
  onClose,
  title = "내 캐릭터",
  initialTab = "character",
}: Props) {
  const [tab, setTab] = useState<"character" | "quests">(initialTab);

  return (
    <ShellCard>
      <Brand title={title} />
      <div className="grid grid-cols-2 gap-2">
        <TabBtn active={tab === "character"} onClick={() => setTab("character")}>
          캐릭터 바꾸기
        </TabBtn>
        <TabBtn active={tab === "quests"} onClick={() => setTab("quests")}>
          퀘스트
        </TabBtn>
      </div>

      {tab === "character" && (
        <SimpleBuddyPicker
          character={character}
          serverUrl={serverUrl}
          onChange={onChange}
          isUnlocked={isUnlocked}
          getXp={getXp}
        />
      )}

      {tab === "quests" && (
        <QuestPanel
          quests={quests}
          unlockNotices={unlockNotices}
          onDismissNotices={onDismissNotices}
          compact
        />
      )}

      <Btn variant="primary" size="lg" onClick={onClose}>
        확인
      </Btn>
    </ShellCard>
  );
}

function TabBtn({
  active,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "border px-3 py-2 text-[0.72rem] uppercase tracking-wider transition",
        active
          ? "border-white bg-white font-bold text-black"
          : "border-white/40 bg-transparent text-mute hover:border-white hover:text-white",
      )}
      {...props}
    >
      {children}
    </button>
  );
}
