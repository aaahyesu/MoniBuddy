export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function invokeSafe<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** 클릭 통과 적용 성공 여부 (실패·양보 중이면 false → 재시도) */
export async function setClickThrough(enabled: boolean): Promise<boolean> {
  if (!isTauri()) return true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_click_through", { enabled });
    return true;
  } catch {
    return false;
  }
}
