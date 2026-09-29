import { useState } from "react";
import { Btn } from "./ui";
import {
  clearGuideSession,
  clearOrphanSettingsGuideSession,
  readGuideSession,
} from "../lib/productGuide";
import { GAME_STATE_KEY } from "../lib/overlayBridge";
import { invokeSafe, isTauri } from "../lib/tauri";

type ClickDebugInfo = {
  clickThroughCache: number;
  yieldState: number;
  inRegionSelect: boolean;
  overlayUserVisible: boolean;
  settingsVisible: boolean;
};

function readStorageDump() {
  const guideSession = localStorage.getItem("monibuddy.guideSession.v1");
  const gameState = localStorage.getItem(GAME_STATE_KEY);
  let runtimeSummary = "";
  try {
    const rt = JSON.parse(localStorage.getItem("monibuddy.runtime.v1") || "null");
    runtimeSummary = rt
      ? `room=${rt.roomCode ?? "-"} mid=${rt.memberId ?? "-"} members=${rt.members?.length ?? 0}`
      : "(없음)";
  } catch {
    runtimeSummary = "(파싱 실패)";
  }
  let gameSummary = "(없음)";
  try {
    if (gameState) {
      const g = JSON.parse(gameState);
      gameSummary = `bomb=${Boolean(g.bomb)} ladder=${g.ladder?.phase ?? "-"} explode=${Boolean(g.bombExplode)}`;
    }
  } catch {
    gameSummary = "(파싱 실패)";
  }
  let guideSummary = "(없음)";
  try {
    if (guideSession) {
      const s = JSON.parse(guideSession);
      guideSummary = `active=${s.active} phase=${s.phase} step=${s.step}`;
    }
  } catch {
    guideSummary = guideSession?.slice(0, 80) ?? "(파싱 실패)";
  }
  return { guideSummary, gameSummary, runtimeSummary };
}

/** F12 없는 배포본용 — 클릭 먹통 진단·응급 해제 (기본 접힘) */
export function ClickDebugPanel() {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const dump = readStorageDump();
    const rust = isTauri()
      ? await invokeSafe<ClickDebugInfo>("get_click_debug")
      : null;
    const lines = [
      `guide: ${dump.guideSummary}`,
      `game: ${dump.gameSummary}`,
      `runtime: ${dump.runtimeSummary}`,
      rust
        ? `rust: cache=${rust.clickThroughCache} yield=${rust.yieldState} region=${rust.inRegionSelect} overlayVisible=${rust.overlayUserVisible} settingsVisible=${rust.settingsVisible}`
        : "rust: (웹/비가용)",
      `sessionNow: ${JSON.stringify(readGuideSession())}`,
    ];
    setLog(lines.join("\n"));
    return { lines };
  };

  const clearStuck = async () => {
    setBusy(true);
    try {
      clearGuideSession();
      clearOrphanSettingsGuideSession(false);
      localStorage.removeItem(GAME_STATE_KEY);
      localStorage.removeItem("monibuddy.guideSession.v1");
      if (isTauri()) {
        await invokeSafe("force_overlay_interactive");
      }
      const r = await refresh();
      setLog(`${r.lines.join("\n")}\n\n→ 세션/게임상태 삭제 + 오버레이 클릭 강제 활성`);
    } finally {
      setBusy(false);
    }
  };

  const openDevtools = async (label: "settings" | "overlay") => {
    setBusy(true);
    try {
      await invokeSafe("open_devtools", { label });
      setLog((prev) => `${prev}\n→ ${label} DevTools 오픈 요청`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 grid gap-2 text-left">
      <button
        type="button"
        className="border border-white/25 bg-transparent px-3 py-2 text-left text-[0.72rem] text-mute hover:border-white/50 hover:text-white"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▾" : "▸"} 클릭이 안 될 때 (진단)
      </button>
      {open ? (
        <div className="grid gap-2 rounded-xl border border-white/10 bg-black/25 p-3">
          <p className="m-0 text-[0.72rem] leading-relaxed text-mute">
            「상태 보기」결과를 복사해 알려 주세요. 안 되면 「먹통 해제」를 눌러
            보세요.
          </p>
          <div className="flex flex-wrap gap-2">
            <Btn
              variant="ghost"
              size="md"
              disabled={busy}
              onClick={() => void refresh()}
            >
              상태 보기
            </Btn>
            <Btn
              variant="primary"
              size="md"
              disabled={busy}
              onClick={() => void clearStuck()}
            >
              먹통 해제
            </Btn>
            {isTauri() ? (
              <>
                <Btn
                  variant="ghost"
                  size="md"
                  disabled={busy}
                  onClick={() => void openDevtools("settings")}
                >
                  설정 DevTools
                </Btn>
                <Btn
                  variant="ghost"
                  size="md"
                  disabled={busy}
                  onClick={() => void openDevtools("overlay")}
                >
                  오버레이 DevTools
                </Btn>
              </>
            ) : null}
          </div>
          {log ? (
            <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-2 text-[0.68rem] leading-snug text-white/85">
              {log}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
