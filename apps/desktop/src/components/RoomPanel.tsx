import type { ChatMessage, Member } from "@monibuddy/shared";
import { Btn, inputClass } from "./ui";

type Props = {
  connected: boolean;
  roomCode: string | null;
  error: string | null;
  members: Member[];
  messages: ChatMessage[];
  inviteInput: string;
  chatInput: string;
  onInviteInput: (v: string) => void;
  onChatInput: (v: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onSend: () => void;
  onToggleMotion: () => void;
};

export function RoomPanel(props: Props) {
  return (
    <section className="rounded-2xl border border-white/20 bg-white/[0.08] px-4 py-4">
      <h2 className="m-0 text-lg font-semibold text-white">방 · 채팅</h2>
      {!props.connected && (
        <p className="m-0 text-[0.85rem] text-danger">
          서버에 연결되지 않았습니다. 서버 URL과 실행 상태를 확인하세요.
        </p>
      )}
      {props.error && (
        <p className="m-0 text-[0.85rem] text-danger">{props.error}</p>
      )}

      {props.roomCode ? (
        <>
          <div className="mt-3 text-[0.9rem] text-mute">초대코드</div>
          <div className="rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-center font-mono text-2xl font-semibold tracking-[0.22em] text-white">
            {props.roomCode}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Btn type="button" onClick={props.onToggleMotion}>
              이동/정지 토글
            </Btn>
            <Btn type="button" variant="ghost" onClick={props.onLeave}>
              방 나가기
            </Btn>
            <Btn
              type="button"
              variant="ghost"
              onClick={() =>
                void navigator.clipboard?.writeText(props.roomCode || "")
              }
            >
              코드 복사
            </Btn>
          </div>
          <p className="m-0 text-[0.9rem] text-mute">
            멤버: {props.members.map((m) => m.nickname).join(", ")}
          </p>
        </>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Btn
            type="button"
            variant="primary"
            onClick={props.onCreate}
            disabled={!props.connected}
          >
            방 만들기
          </Btn>
          <input
            className={`${inputClass} w-[7.5rem]`}
            value={props.inviteInput}
            onChange={(e) => props.onInviteInput(e.target.value.toUpperCase())}
            placeholder="초대코드"
            maxLength={6}
          />
          <Btn
            type="button"
            onClick={props.onJoin}
            disabled={!props.connected}
          >
            입장
          </Btn>
        </div>
      )}

      <div className="mt-4 grid gap-2">
        <div className="grid max-h-[180px] gap-1.5 overflow-auto">
          {props.messages.length === 0 && (
            <div className="text-[0.9rem] text-mute">
              채팅이 여기에 표시됩니다. 말풍선은 오버레이에 뜹니다.
            </div>
          )}
          {props.messages.map((m) => (
            <div key={m.id} className="text-[0.92rem] text-white">
              <strong>{m.nickname}</strong>: {m.text}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className={`${inputClass} min-w-0 flex-1`}
            value={props.chatInput}
            maxLength={80}
            placeholder="메시지 (최대 80자)"
            onChange={(e) => props.onChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") props.onSend();
            }}
            disabled={!props.roomCode}
          />
          <Btn
            type="button"
            variant="primary"
            onClick={props.onSend}
            disabled={!props.roomCode}
          >
            전송
          </Btn>
        </div>
      </div>
    </section>
  );
}
