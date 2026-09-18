import { check, type Update } from "@tauri-apps/plugin-updater";
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

let pendingUpdate: Update | null = null;

export function canUseUpdater(): boolean {
  return isTauri() && Boolean(import.meta.env.PROD);
}

/** 새 버전만 확인 (설치는 하지 않음) */
export async function checkForUpdate(
  onStatus?: (s: UpdateStatus) => void,
): Promise<string | null> {
  if (!canUseUpdater()) {
    onStatus?.({ kind: "idle" });
    return null;
  }

  onStatus?.({ kind: "checking" });
  try {
    const update = await check();
    if (!update) {
      pendingUpdate = null;
      onStatus?.({ kind: "upToDate" });
      return null;
    }
    pendingUpdate = update;
    onStatus?.({ kind: "available", version: update.version });
    return update.version;
  } catch (err) {
    pendingUpdate = null;
    const message = err instanceof Error ? err.message : String(err);
    onStatus?.({ kind: "error", message });
    return null;
  }
}

/** 확인된(또는 재확인한) 업데이트 설치 후 재실행 */
export async function installPendingUpdate(
  onStatus?: (s: UpdateStatus) => void,
): Promise<boolean> {
  if (!canUseUpdater()) {
    onStatus?.({ kind: "idle" });
    return false;
  }

  try {
    let update = pendingUpdate;
    if (!update) {
      onStatus?.({ kind: "checking" });
      update = await check();
      if (!update) {
        onStatus?.({ kind: "upToDate" });
        return false;
      }
      pendingUpdate = update;
    }

    onStatus?.({ kind: "downloading", version: update.version });
    await update.downloadAndInstall();
    onStatus?.({ kind: "installing", version: update.version });
    pendingUpdate = null;
    await relaunch();
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onStatus?.({ kind: "error", message });
    return false;
  }
}
