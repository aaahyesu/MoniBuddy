import type { Member, Character } from "@monibuddy/shared";
import { CharacterView } from "./CharacterView";

type Props = {
  roomCode: string;
  nickname: string;
  character: Character;
  serverUrl: string;
  members: Member[];
  onLeave: () => void;
  onOpenBuddyMenu: () => void;
};

export function InRoomView({
  roomCode,
  nickname,
  character,
  serverUrl,
  members,
  onLeave,
  onOpenBuddyMenu,
}: Props) {
  return (
    <div className="wizard">
      <div className="wizard-card">
        <p className="muted" style={{ margin: 0 }}>
          방에 들어왔어요
        </p>
        <div className="invite">{roomCode}</div>
        <button
          type="button"
          className="ghost"
          onClick={() => void navigator.clipboard?.writeText(roomCode)}
        >
          초대코드 복사
        </button>

        <div className="inroom-tip">
          <CharacterView character={character} serverUrl={serverUrl} size={64} />
          <p>
            <strong>{nickname}</strong>
            <br />
            모니터 테두리의 <strong>내 캐릭터</strong>를 누르면
            <br />
            채팅창이 열려요. <strong>+</strong> 로 방·퀘스트도 바꿀 수 있어요.
          </p>
        </div>

        <p className="muted" style={{ margin: 0, textAlign: "center" }}>
          함께 {members.length}명 · {members.map((m) => m.nickname).join(", ")}
        </p>

        <button type="button" className="ghost" onClick={onOpenBuddyMenu}>
          퀘스트 · 캐릭터 (설정)
        </button>
        <button type="button" className="ghost" onClick={onLeave}>
          방 나가기
        </button>
      </div>
    </div>
  );
}
