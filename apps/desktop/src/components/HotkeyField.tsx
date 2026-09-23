import { useEffect, useState } from "react";
import { eventToHotkey, formatHotkeyLabel } from "../lib/overlayHotkey";
import { Btn } from "./ui";

type Props = {
  value: string;
  onChange: (hotkey: string) => void;
  disabled?: boolean;
};

export function HotkeyField({ value, onChange, disabled }: Props) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!listening) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setListening(false);
        setError("");
        return;
      }
      const hotkey = eventToHotkey(e);
      if (!hotkey) {
        setError("Ctrl/Alt/Shift + 키 조합으로 지정하세요");
        return;
      }
      setError("");
      onChange(hotkey);
      setListening(false);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [listening, onChange]);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className={`min-w-[10rem] flex-1 rounded-xl border px-3 py-2 text-left text-[0.9rem] ${
            listening
              ? "border-accent-cyan bg-white/10 text-accent-cyan"
              : "border-white/15 bg-black/25 text-white/90"
          }`}
        >
          {listening ? "키 조합을 누르세요…" : formatHotkeyLabel(value)}
        </div>
        <Btn
          type="button"
          variant="ghost"
          className="px-3 py-2 text-[0.82rem]"
          disabled={disabled}
          onClick={() => {
            setError("");
            setListening((v) => !v);
          }}
        >
          {listening ? "취소" : value ? "다시 지정" : "지정하기"}
        </Btn>
        {value ? (
          <Btn
            type="button"
            variant="ghost"
            className="px-3 py-2 text-[0.82rem]"
            disabled={disabled || listening}
            onClick={() => {
              setError("");
              onChange("");
            }}
          >
            지우기
          </Btn>
        ) : null}
      </div>
      {error ? (
        <p className="m-0 text-[0.72rem] text-rose-300">{error}</p>
      ) : (
        <p className="m-0 text-[0.72rem] leading-relaxed text-mute">
          지정한 단축키로 오버레이를 켜고 끌 수 있어요. Esc로 입력을 취소합니다.
        </p>
      )}
    </div>
  );
}
