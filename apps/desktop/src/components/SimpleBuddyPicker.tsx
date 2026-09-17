import { useEffect, useState } from "react";
import type { Character } from "@monibuddy/shared";
import {
  buddyAssetUrl,
  loadBuddyManifest,
  toBuddyCharacter,
  type BuddyDef,
} from "../lib/defaultBuddies";
import { CharacterView } from "./CharacterView";

type Props = {
  character: Character;
  serverUrl: string;
  onChange: (c: Character) => void;
  isUnlocked: (id: string) => boolean;
  getXp: (id: string) => number;
  /** show only free/unlocked pickable cards (locked as dim) */
  showLocked?: boolean;
};

export function SimpleBuddyPicker({
  character,
  serverUrl,
  onChange,
  isUnlocked,
  getXp,
  showLocked = true,
}: Props) {
  const [buddies, setBuddies] = useState<BuddyDef[]>([]);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    void loadBuddyManifest().then((m) => setBuddies(m.buddies));
  }, []);

  // first paint: if still on default parts, pick first free buddy
  useEffect(() => {
    if (character.kind === "buddy" || buddies.length === 0) return;
    const free = buddies.find((b) => b.free && b.fileReady !== false);
    if (free && isUnlocked(free.id)) {
      onChange(toBuddyCharacter(free, getXp(free.id)));
    }
  }, [buddies]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = showLocked ? buddies : buddies.filter((b) => isUnlocked(b.id));

  return (
    <div className="simple-picker">
      <div className="simple-preview">
        <CharacterView
          character={character}
          serverUrl={serverUrl}
          size={112}
          buddyDef={
            character.kind === "buddy"
              ? buddies.find((b) => b.id === character.id)
              : undefined
          }
        />
        <div className="muted" style={{ textAlign: "center", marginTop: "0.5rem" }}>
          {character.kind === "buddy"
            ? buddies.find((b) => b.id === character.id)?.label ?? character.id
            : "캐릭터를 골라 주세요"}
        </div>
      </div>

      <div className="simple-grid">
        {visible.map((b) => {
          const unlocked = isUnlocked(b.id);
          const selected = character.kind === "buddy" && character.id === b.id;
          const ready = b.fileReady !== false;
          return (
            <button
              key={b.id}
              type="button"
              className={`simple-card${selected ? " selected" : ""}${
                unlocked ? "" : " locked"
              }`}
              onClick={() => {
                if (!unlocked) {
                  setHint(
                    b.unlock === "quest:first_room"
                      ? "방을 만들거나 입장하면 열려요"
                      : b.unlock === "quest:chat_10"
                        ? "채팅 10번 하면 열려요"
                        : "퀘스트를 완료하면 열려요",
                  );
                  return;
                }
                if (!ready) {
                  setHint("해금됐어요! GIF 파일은 곧 추가될 예정이에요.");
                } else {
                  setHint(null);
                }
                onChange(toBuddyCharacter(b, getXp(b.id)));
              }}
            >
              {ready && unlocked ? (
                <img src={buddyAssetUrl(b, b.id)} alt="" />
              ) : (
                <span className="simple-q">{unlocked ? "…" : "🔒"}</span>
              )}
              <span>{unlocked ? b.label ?? b.id : "잠김"}</span>
            </button>
          );
        })}
      </div>
      {hint && <p className="muted" style={{ margin: 0 }}>{hint}</p>}
    </div>
  );
}
