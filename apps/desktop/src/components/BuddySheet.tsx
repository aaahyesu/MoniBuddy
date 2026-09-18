import { useState } from "react";
import type { Character } from "@monibuddy/shared";
import { SimpleBuddyPicker } from "./SimpleBuddyPicker";
import { QuestPanel } from "./QuestPanel";

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
    <div className="wizard dark">
      <div className="wizard-card glass-dark">
        <div className="brand" style={{ fontSize: "1.25rem" }}>
          {title}
        </div>
        <div className="sheet-tabs">
          <button
            type="button"
            className={tab === "character" ? "glass-tab on" : "glass-tab"}
            onClick={() => setTab("character")}
          >
            캐릭터 바꾸기
          </button>
          <button
            type="button"
            className={tab === "quests" ? "glass-tab on" : "glass-tab"}
            onClick={() => setTab("quests")}
          >
            퀘스트
          </button>
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

        <div className="wizard-actions">
          <button type="button" className="glass-confirm" onClick={onClose}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
