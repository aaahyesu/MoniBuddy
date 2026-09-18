import { APP_NAME } from "@monibuddy/shared";
import { CharacterView } from "./CharacterView";
import type { Character } from "@monibuddy/shared";

type Props = {
  nickname: string;
  character: Character;
  serverUrl: string;
  inRoom: boolean;
  roomCode: string | null;
  connected: boolean;
  error: string | null;
  onEditProfile: () => void;
  onShowOverlay?: () => void;
  onOpenRoomInfo?: () => void;
};

/** Post-onboarding home — rooms are joined from the overlay + menu. */
export function RoomLobby({
  nickname,
  character,
  serverUrl,
  inRoom,
  roomCode,
  connected,
  error,
  onEditProfile,
  onShowOverlay,
  onOpenRoomInfo,
}: Props) {
  return (
    <div className="wizard">
      <div className="wizard-card">
        <div className="brand">{APP_NAME}</div>
        <p className="muted" style={{ margin: 0 }}>
          안녕하세요, <strong>{nickname}</strong>님
        </p>

        <button type="button" className="lobby-me-btn" onClick={onEditProfile}>
          <CharacterView character={character} serverUrl={serverUrl} size={80} />
          <span className="muted">이름 · 캐릭터 바꾸기</span>
        </button>

        {!connected && (
          <p className="error">서버에 연결하는 중… (서버가 켜져 있는지 확인해 주세요)</p>
        )}
        {error && <p className="error">{error}</p>}

        {inRoom && roomCode ? (
          <div className="inroom-tip">
            <p style={{ margin: 0 }}>
              방에 있어요 · 초대코드 <strong>{roomCode}</strong>
            </p>
            <button type="button" className="primary big" onClick={onOpenRoomInfo}>
              방 정보 보기
            </button>
          </div>
        ) : (
          <div className="inroom-tip">
            <p>
              모니터 테두리의 <strong>내 캐릭터</strong>를 누른 뒤
              <br />
              <strong>+</strong> 에서 방을 만들거나 입장해요.
            </p>
          </div>
        )}

        {onShowOverlay && (
          <button type="button" className="big" onClick={onShowOverlay} style={{ width: "100%" }}>
            오버레이 보이기
          </button>
        )}
      </div>
    </div>
  );
}
