import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  canUseUpdater,
  checkForUpdate,
  installPendingUpdate,
  type UpdateStatus,
} from "../lib/updater";

function statusText(status: UpdateStatus, currentVersion: string): string {
  const cur = currentVersion ? ` (현재 v${currentVersion})` : "";
  switch (status.kind) {
    case "checking":
      return `업데이트 확인 중…${cur}`;
    case "available":
      return `새 버전 v${status.version}${cur}`;
    case "downloading":
      return `v${status.version} 받는 중…`;
    case "installing":
      return "설치 후 재시작…";
    case "upToDate":
      return `최신 버전입니다${cur}`;
    case "error":
      return `확인 실패: ${status.message}${cur}`;
    default:
      return `업데이트${cur}`;
  }
}

/** 설정 창 공통 — 한 줄 컴팩트 배너 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("");

  useEffect(() => {
    if (!canUseUpdater()) return;
    void getVersion()
      .then(setCurrentVersion)
      .catch(() => setCurrentVersion(""));
    void checkForUpdate(setStatus);
  }, []);

  if (!canUseUpdater()) return null;

  const available = status.kind === "available";
  const installing =
    status.kind === "downloading" || status.kind === "installing";

  return (
    <div className="flex items-center gap-2 border border-white/40 bg-black/40 px-2.5 py-1.5 text-left">
      <p
        className={`m-0 min-w-0 flex-1 truncate text-[0.72rem] leading-none ${
          status.kind === "error"
            ? "text-danger"
            : available
              ? "text-accent-cyan"
              : "text-mute"
        }`}
      >
        {statusText(status, currentVersion)}
      </p>
      {available ? (
        <button
          type="button"
          disabled={busy || installing}
          className="shrink-0 border border-white bg-white px-2 py-0.5 text-[0.68rem] font-bold text-black disabled:opacity-50"
          onClick={() => {
            setBusy(true);
            void installPendingUpdate(setStatus).finally(() => setBusy(false));
          }}
        >
          {busy || installing ? "설치 중" : "업데이트"}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy || installing || status.kind === "checking"}
          className="shrink-0 border border-white/50 px-2 py-0.5 text-[0.68rem] text-white/80 disabled:opacity-50"
          onClick={() => {
            setBusy(true);
            void checkForUpdate(setStatus).finally(() => setBusy(false));
          }}
        >
          {busy || status.kind === "checking" ? "확인 중" : "확인"}
        </button>
      )}
    </div>
  );
}
