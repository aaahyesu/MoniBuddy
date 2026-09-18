import { useEffect, useMemo, useState } from "react";
import type { Character } from "@monibuddy/shared";
import {
  BUDDY_GROUPS,
  buddyAssetUrl,
  buddyGroupOf,
  clearBuddyManifestCache,
  loadBuddyManifest,
  toBuddyCharacter,
  type BuddyGroup,
  type BuddyDef,
} from "../lib/defaultBuddies";
import { CharacterView } from "./CharacterView";
import { cn } from "../lib/cn";

type Props = {
  character: Character;
  serverUrl: string;
  onChange: (c: Character) => void;
  isUnlocked: (id: string) => boolean;
  getXp: (id: string) => number;
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
  const [group, setGroup] = useState<BuddyGroup>("ank");

  useEffect(() => {
    clearBuddyManifestCache();
    void loadBuddyManifest().then((m) => setBuddies(m.buddies));
  }, []);

  useEffect(() => {
    if (character.kind !== "buddy" || buddies.length === 0) return;
    const current = buddies.find((b) => b.id === character.id);
    if (current) setGroup(buddyGroupOf(current));
  }, [character, buddies]);

  useEffect(() => {
    if (character.kind === "buddy" || buddies.length === 0) return;
    const free = buddies.find((b) => b.free && b.fileReady !== false);
    if (free && isUnlocked(free.id)) {
      onChange(toBuddyCharacter(free, getXp(free.id)));
    }
  }, [buddies]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    const base = showLocked ? buddies : buddies.filter((b) => isUnlocked(b.id));
    return base.filter((b) => buddyGroupOf(b) === group);
  }, [buddies, group, showLocked, isUnlocked]);

  const selectedDef =
    character.kind === "buddy"
      ? buddies.find((b) => b.id === character.id)
      : undefined;
  const selectedLabel = selectedDef?.label ?? (character.kind === "buddy" ? character.id : "캐릭터를 골라 주세요");

  return (
    <div className="grid gap-3.5">
      <div className="grid justify-items-center gap-2 border border-black/15 bg-buddy px-2 py-3.5">
        <CharacterView
          character={character}
          serverUrl={serverUrl}
          size={112}
          buddyDef={selectedDef}
        />
        <div className="text-center text-[0.78rem] text-[#4a5060]">{selectedLabel}</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {BUDDY_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGroup(g.id)}
            className={cn(
              "border px-3 py-2 text-[0.72rem] uppercase tracking-wider transition",
              group === g.id
                ? "border-white bg-white font-bold text-black"
                : "border-white/40 bg-transparent text-mute hover:border-white hover:text-white",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
        {visible.map((b) => {
          const unlocked = isUnlocked(b.id);
          const ready = b.fileReady !== false;
          // 파일 미정이면 퀘스트 해금 여부와 관계없이 잠금 표시
          const available = unlocked && ready;
          const selected = character.kind === "buddy" && character.id === b.id;
          return (
            <button
              key={b.id}
              type="button"
              className={cn(
                "grid min-h-[110px] justify-items-center gap-1.5 border bg-buddy px-1.5 py-2.5 transition",
                selected
                  ? "border-black ring-2 ring-black/40"
                  : "border-black/15 hover:border-black/35",
                !available && "opacity-50",
              )}
              onClick={() => {
                if (!ready) {
                  setHint("아직 준비 중이에요");
                  return;
                }
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
                setHint(null);
                onChange(toBuddyCharacter(b, getXp(b.id)));
              }}
            >
              {available ? (
                <img
                  src={buddyAssetUrl(b, b.stages?.[0]?.file ?? b.id)}
                  alt=""
                  className="h-14 w-14 object-contain"
                />
              ) : (
                <span className="grid h-14 w-14 place-items-center bg-[#e4e7ee] text-lg">
                  🔒
                </span>
              )}
              <span className="text-center text-[0.75rem] leading-snug text-[#5c6370]">
                {available ? b.label ?? b.id : "잠김"}
              </span>
            </button>
          );
        })}
      </div>
      {visible.length === 0 && (
        <p className="m-0 text-center text-[0.78rem] text-mute">이 그룹에 캐릭터가 없어요</p>
      )}
      {hint && <p className="m-0 text-[0.85rem] text-mute">{hint}</p>}
    </div>
  );
}
