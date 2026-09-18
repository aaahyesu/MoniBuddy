import { useEffect, useState } from "react";
import { Btn } from "./ui";
import {
  canUseUpdater,
  checkForUpdate,
  installPendingUpdate,
  type UpdateStatus,
} from "../lib/updater";

function statusText(status: UpdateStatus): string {
  switch (status.kind) {
    case "checking":
      return "업데이트 확인 중…";
    case "available":
      return `새 버전 v${status.version} 이 있어요`;
    case "downloading":
      return `v${status.version} 다운로드 중…`;
    case "installing":
      return "설치 후 재시작합니다…";
    case "upToDate":
      return "최신 버전입니다";
    case "error":
      return `업데이트 확인 실패: ${status.message}`;
    default:
      return "업데이트를 확인할 수 있어요";
  }
}

/** 설정 창 공통 — 온보딩/로비/프로필 상단에 표시 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canUseUpdater()) return;
    void checkForUpdate(setStatus);
  }, []);

  if (!canUseUpdater()) return null;

  const available = status.kind === "available";
  const installing =
    status.kind === "downloading" || status.kind === "installing";

  return (
    <div className="grid gap-2 border border-accent-cyan/50 bg-black/50 p-3 text-left">
      <p
        className={`m-0 text-[0.82rem] leading-relaxed ${
          status.kind === "error"
            ? "text-danger"
            : available
              ? "text-accent-cyan"
              : "text-mute"
        }`}
      >
        {statusText(status)}
      </p>
      {available ? (
        <Btn
          variant="primary"
          size="md"
          disabled={busy || installing}
          onClick={() => {
            setBusy(true);
            void installPendingUpdate(setStatus).finally(() => setBusy(false));
          }}
        >
          {busy || installing ? "설치 중…" : "지금 업데이트"}
        </Btn>
      ) : (
        <Btn
          variant="ghost"
          size="md"
          disabled={busy || installing || status.kind === "checking"}
          onClick={() => {
            setBusy(true);
            void checkForUpdate(setStatus).finally(() => setBusy(false));
          }}
        >
          {busy || status.kind === "checking" ? "확인 중…" : "다시 확인"}
        </Btn>
      )}
    </div>
  );
}
