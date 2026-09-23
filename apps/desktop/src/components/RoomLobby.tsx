import { APP_NAME } from "@monibuddy/shared";
import { CharacterView } from "./CharacterView";
import type { Character } from "@monibuddy/shared";
import { formatHotkeyLabel } from "../lib/overlayHotkey";
import { Brand, Btn, SectionLabel, ShellCard } from "./ui";
import { UpdateBanner } from "./UpdateBanner";

type Props = {
  nickname: string;
  character: Character;
  serverUrl: string;
  inRoom: boolean;
  roomCode: string | null;
  connected: boolean;
  error: string | null;
  forcePolling?: boolean;
  overlayHotkey?: string;
  onEditProfile: () => void;
  onShowOverlay?: () => void;
  onOpenRoomInfo?: () => void;
};

export function RoomLobby({
  nickname,
  character,
  serverUrl,
  inRoom,
  roomCode,
  connected,
  error,
  forcePolling = true,
  overlayHotkey = "",
  onEditProfile,
  onShowOverlay,
  onOpenRoomInfo,
}: Props) {
  return (
    <ShellCard>
      <Brand title={APP_NAME} subtitle={`HELLO, ${nickname}`} />
      <UpdateBanner />

      <SectionLabel tone="pink">Profile</SectionLabel>
      <button
        type="button"
        onClick={onEditProfile}
        className="grid w-full justify-items-center gap-3 border border-white/50 bg-black/40 p-4 transition hover:bg-black/55"
      >
        <div className="border border-black/20 bg-buddy p-2">
          <CharacterView character={character} serverUrl={serverUrl} size={80} />
        </div>
        <span className="text-[0.72rem] uppercase tracking-wider text-mute">
          이름 · 캐릭터 · 단축키 설정
        </span>
        <span className="text-[0.68rem] text-mute">
          오버레이 단축키:{" "}
          <span className="text-accent-cyan">
            {formatHotkeyLabel(overlayHotkey)}
          </span>
        </span>
      </button>

      {!connected && (
        <p className="m-0 text-[0.78rem] text-danger">
          서버 연결 중… 첫 접속은 Render 깨우느라 최대 1분 걸릴 수 있어요
        </p>
      )}
      {error && <p className="m-0 break-all text-[0.78rem] text-danger">{error}</p>}
      <p className="m-0 break-all text-[0.68rem] text-mute">서버: {serverUrl}</p>
      <p className="m-0 text-[0.68rem] text-mute">
        전송: {forcePolling ? "HTTPS 폴링 (회사망 호환)" : "WebSocket 허용"}
      </p>

      <div className="pixel-divider" />

      {inRoom && roomCode ? (
        <div className="grid justify-items-center gap-3 border border-white/50 bg-black/40 p-4 text-center">
          <SectionLabel tone="orange">In Room</SectionLabel>
          <p className="m-0 text-[0.85rem] text-mute">
            초대코드{" "}
            <strong className="font-mono tracking-[0.2em] text-accent-cyan">
              {roomCode}
            </strong>
          </p>
          <Btn variant="primary" size="lg" onClick={onOpenRoomInfo}>
            Room Info
          </Btn>
        </div>
      ) : (
        <div className="grid gap-2 border border-white/50 bg-black/40 p-4">
          <SectionLabel tone="purple">How To Play</SectionLabel>
          <p className="m-0 text-left text-[0.82rem] leading-relaxed text-mute">
            모니터 테두리의{" "}
            <span className="text-ok">내 캐릭터</span>를 누른 뒤{" "}
            <span className="text-warn">+</span> 에서 방을 만들거나 입장해요.
          </p>
        </div>
      )}

      {onShowOverlay && (
        <Btn variant="primary" size="lg" onClick={onShowOverlay}>
          Show Overlay
        </Btn>
      )}
    </ShellCard>
  );
}
