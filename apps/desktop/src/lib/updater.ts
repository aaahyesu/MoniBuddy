import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "./tauri";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string }
  | { kind: "installing"; version: string }
  | { kind: "upToDate" }
  | { kind: "error"; message: string };

/**
 * GitHub Releases latest.json 을 확인하고, 새 버전이면 내려받아 설치 후 재실행.
 * 설치본(프로덕션)에서만 동작. 실패해도 앱 사용은 계속.
 */
export async function checkAndInstallUpdate(
  onStatus?: (s: UpdateStatus) => void,
): Promise<boolean> {
  if (!isTauri() || !import.meta.env.PROD) {
    onStatus?.({ kind: "idle" });
    return false;
  }

  onStatus?.({ kind: "checking" });
  try {
    const update = await check();
    if (!update) {
      onStatus?.({ kind: "upToDate" });
      return false;
    }

    onStatus?.({ kind: "available", version: update.version });
    onStatus?.({ kind: "downloading", version: update.version });
    await update.downloadAndInstall();
    onStatus?.({ kind: "installing", version: update.version });
    await relaunch();
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onStatus?.({ kind: "error", message });
    return false;
  }
}
