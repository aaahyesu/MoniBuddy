import { useState } from "react";
import { APP_NAME } from "@monibuddy/shared";
import type { Character } from "@monibuddy/shared";
import { SimpleBuddyPicker } from "./SimpleBuddyPicker";

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
    <div className="wizard">
      <div className="wizard-card">
        <div className="brand">{APP_NAME}</div>
        <p className="muted" style={{ margin: 0 }}>
          처음 설정 · {step} / 2
        </p>

        <div className="steps">
          <span className={step >= 1 ? (step === 1 ? "on" : "done") : ""}>① 이름</span>
          <span className="sep">→</span>
          <span className={step === 2 ? "on" : ""}>② 캐릭터</span>
        </div>

        {step === 1 && (
          <>
            <h2>닉네임을 정해요</h2>
            <p className="muted">친구들 화면에 이 이름으로 보여요.</p>
            <label>
              닉네임
              <input
                autoFocus
                value={nickname}
                maxLength={16}
                placeholder="예: 만두"
                onChange={(e) => onNickname(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && nickOk) setStep(2);
                }}
              />
            </label>
            <button
              type="button"
              className="primary big"
              disabled={!nickOk}
              onClick={() => setStep(2)}
              style={{ width: "100%", marginTop: "0.5rem" }}
            >
              다음
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2>캐릭터를 골라요</h2>
            <p className="muted">하나만 고르면 끝이에요. 나중에 바꿀 수 있어요.</p>
            <SimpleBuddyPicker
              character={character}
              serverUrl={serverUrl}
              onChange={onCharacter}
              isUnlocked={isUnlocked}
              getXp={getXp}
              showLocked={false}
            />
            <div className="wizard-actions" style={{ marginTop: "0.75rem" }}>
              <button type="button" className="ghost" onClick={() => setStep(1)}>
                이전
              </button>
              <button
                type="button"
                className="primary big"
                onClick={onFinish}
                disabled={character.kind !== "buddy"}
                style={{ flex: 1 }}
              >
                시작하기
              </button>
            </div>
            <p className="muted" style={{ margin: 0, textAlign: "center", fontSize: "0.82rem" }}>
              시작 후 캐릭터를 누르고 + 에서 방에 입장해요
            </p>
          </>
        )}
      </div>
    </div>
  );
}
