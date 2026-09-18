import { useState } from "react";
import { APP_NAME } from "@monibuddy/shared";
import type { Character } from "@monibuddy/shared";
import { SimpleBuddyPicker } from "./SimpleBuddyPicker";
import { Brand, Btn, Field, SectionLabel, ShellCard, inputClass } from "./ui";
import { UpdateBanner } from "./UpdateBanner";
import { cn } from "../lib/cn";

type Props = {
  nickname: string;
  character: Character;
  serverUrl: string;
  onNickname: (v: string) => void;
  onCharacter: (c: Character) => void;
  isUnlocked: (id: string) => boolean;
  getXp: (id: string) => number;
  onFinish: () => void;
};

export function OnboardingFlow({
  nickname,
  character,
  serverUrl,
  onNickname,
  onCharacter,
  isUnlocked,
  getXp,
  onFinish,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const nickOk = nickname.trim().length >= 1;

  return (
    <ShellCard>
      <Brand title={APP_NAME} subtitle={`SETUP  ${step} / 2`} />
      <UpdateBanner />

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "border px-2.5 py-1 text-[0.68rem] uppercase tracking-wider",
            step === 1
              ? "border-white bg-white font-bold text-black"
              : "border-white/40 text-mute",
          )}
        >
          1 Name
        </span>
        <span className="text-mute">→</span>
        <span
          className={cn(
            "border px-2.5 py-1 text-[0.68rem] uppercase tracking-wider",
            step === 2
              ? "border-white bg-white font-bold text-black"
              : "border-white/40 text-mute",
          )}
        >
          2 Buddy
        </span>
      </div>

      {step === 1 && (
        <>
          <SectionLabel tone="pink">Nickname</SectionLabel>
          <p className="m-0 text-[0.85rem] leading-relaxed text-mute">
            친구 화면에 이 이름으로 표시돼요.
          </p>
          <Field label="닉네임">
            <input
              autoFocus
              className={inputClass}
              value={nickname}
              maxLength={16}
              placeholder="예: 만두"
              onChange={(e) => onNickname(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nickOk) setStep(2);
              }}
            />
          </Field>
          <Btn
            variant="primary"
            size="lg"
            disabled={!nickOk}
            onClick={() => setStep(2)}
          >
            Next →
          </Btn>
        </>
      )}

      {step === 2 && (
        <>
          <SectionLabel tone="purple">Character</SectionLabel>
          <p className="m-0 text-[0.85rem] leading-relaxed text-mute">
            모니터 테두리를 걸어다닐 버디를 고르세요.
          </p>
          <SimpleBuddyPicker
            character={character}
            serverUrl={serverUrl}
            onChange={onCharacter}
            isUnlocked={isUnlocked}
            getXp={getXp}
            showLocked={false}
          />
          <div className="flex gap-2">
            <Btn variant="default" className="flex-1" onClick={() => setStep(1)}>
              ← Back
            </Btn>
            <Btn
              variant="primary"
              size="lg"
              className="flex-[1.4]"
              onClick={onFinish}
              disabled={character.kind !== "buddy"}
            >
              Launch
            </Btn>
          </div>
          <p className="m-0 text-center text-[0.72rem] leading-relaxed text-mute">
            The border awaits… 캐릭터를 누르고 + 에서 방에 입장해요
          </p>
        </>
      )}
    </ShellCard>
  );
}
