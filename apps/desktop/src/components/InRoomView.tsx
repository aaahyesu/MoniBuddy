import type { Member, Character } from "@monibuddy/shared";
import { CharacterView } from "./CharacterView";
import { Btn, ShellCard } from "./ui";

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
    <ShellCard>
      <p className="m-0 text-[0.9rem] text-mute">방에 들어왔어요</p>
      <div className="border border-white bg-black/50 px-3 py-2.5 text-center font-mono text-[1.35rem] font-bold tracking-[0.22em] text-accent-cyan">
        {roomCode}
      </div>
      <Btn
        variant="ghost"
        onClick={() => void navigator.clipboard?.writeText(roomCode)}
      >
        초대코드 복사
      </Btn>

      <div className="grid justify-items-center gap-3 border border-white/50 bg-black/40 p-4 text-center">
        <div className="border border-black/20 bg-buddy p-2">
          <CharacterView character={character} serverUrl={serverUrl} size={64} />
        </div>
        <p className="m-0 text-[0.82rem] leading-relaxed text-mute">
          <strong className="text-white">{nickname}</strong>
          <br />
          모니터 테두리의 <span className="text-ok">내 캐릭터</span>를 누르면
          <br />
          채팅창이 열려요. <span className="text-warn">+</span> 로 방·퀘스트도 바꿀 수
          있어요.
        </p>
      </div>

      <p className="m-0 text-center text-[0.9rem] text-mute">
        함께 {members.length}명 · {members.map((m) => m.nickname).join(", ")}
      </p>

      <Btn variant="ghost" onClick={onOpenBuddyMenu}>
        퀘스트 · 캐릭터 (설정)
      </Btn>
      <Btn variant="ghost" onClick={onLeave}>
        방 나가기
      </Btn>
    </ShellCard>
  );
}
