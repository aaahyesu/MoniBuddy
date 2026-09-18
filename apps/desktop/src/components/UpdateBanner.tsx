import { useEffect, useState } from "react";
import { Btn } from "./ui";
import { checkAndInstallUpdate, type UpdateStatus } from "../lib/updater";
import { isTauri } from "../lib/tauri";

function label(status: UpdateStatus): string | null {
  switch (status.kind) {
    case "checking":
      return "업데이트 확인 중…";
    case "available":
      return `새 버전 ${status.version} 발견`;
    case "downloading":
      return `v${status.version} 다운로드 중…`;
    case "installing":
      return "설치 후 재시작합니다…";
    case "error":
      return `업데이트 실패: ${status.message}`;
    default:
      return null;
  }
}

/** 설정 창 상단 — 시작 시 자동 확인 + 수동 버튼 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauri() || !import.meta.env.PROD) return;
    void checkAndInstallUpdate(setStatus);
  }, []);

  if (!isTauri()) return null;

  const text = label(status);
  const showBar =
    text != null &&
    status.kind !== "upToDate" &&
    status.kind !== "idle";

  return (
    <div className="mb-3 grid gap-2">
      {showBar && (
        <p
          className={`m-0 text-[0.78rem] ${
            status.kind === "error" ? "text-danger" : "text-accent-cyan"
          }`}
        >
          {text}
        </p>
      )}
      <Btn
        variant="ghost"
        size="md"
        disabled={busy || status.kind === "downloading" || status.kind === "installing"}
        onClick={() => {
          setBusy(true);
          void checkAndInstallUpdate(setStatus).finally(() => setBusy(false));
        }}
      >
        {busy ? "확인 중…" : "업데이트 확인"}
      </Btn>
    </div>
  );
}
