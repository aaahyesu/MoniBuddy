import { invokeSafe, isTauri } from "./tauri";

/** 현재 앱에 등록된 오버레이 토글 단축키 */
let registeredHotkey: string | null = null;

const MOD_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS"]);

/** KeyboardEvent → Tauri global-shortcut 문자열 (예: Ctrl+Shift+O) */
export function eventToHotkey(e: KeyboardEvent): string | null {
  if (MOD_KEYS.has(e.key)) return null;

  const parts: string[] = [];
  // Windows/Linux: Ctrl, macOS: Meta → CmdOrControl
  if (e.ctrlKey || e.metaKey) parts.push("CmdOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  const key = codeToHotkeyKey(e.code);
  if (!key) return null;
  // 단일 키는 다른 앱과 충돌하기 쉬워 수정자 필수
  if (parts.length === 0) return null;

  parts.push(key);
  return parts.join("+");
}

function codeToHotkeyKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  const map: Record<string, string> = {
    Space: "Space",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    Escape: "Escape",
    Tab: "Tab",
    Enter: "Enter",
    Backspace: "Backspace",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Minus: "Minus",
    Equal: "Equal",
    BracketLeft: "BracketLeft",
    BracketRight: "BracketRight",
    Semicolon: "Semicolon",
    Quote: "Quote",
    Backquote: "Backquote",
    Backslash: "Backslash",
    Comma: "Comma",
    Period: "Period",
    Slash: "Slash",
  };
  return map[code] ?? null;
}

export function formatHotkeyLabel(hotkey: string): string {
  if (!hotkey.trim()) return "지정 안 함";
  return hotkey
    .split("+")
    .map((p) => {
      if (p === "CmdOrControl") return "Ctrl";
      return p;
    })
    .join(" + ");
}

/** 오버레이 표시/숨김 글로벌 단축키 등록·해제 */
export async function applyOverlayHotkey(hotkey: string | null | undefined) {
  if (!isTauri()) return { ok: true as const };

  const next = (hotkey || "").trim();
  try {
    const { unregister, register } = await import(
      "@tauri-apps/plugin-global-shortcut"
    );

    if (registeredHotkey) {
      try {
        await unregister(registeredHotkey);
      } catch {
        /* 이미 없음 */
      }
      registeredHotkey = null;
    }

    if (!next) return { ok: true as const };

    await register(next, (event) => {
      if (event.state !== "Pressed") return;
      void invokeSafe("flip_overlay_visibility");
    });
    registeredHotkey = next;
    return { ok: true as const };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "단축키 등록 실패";
    return { ok: false as const, error: message };
  }
}
