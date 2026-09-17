import type { ChatMessage, Member } from "@monibuddy/shared";

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
    <section className="card">
      <h2 style={{ marginTop: 0 }}>방 · 채팅</h2>
      {!props.connected && (
        <p className="error">서버에 연결되지 않았습니다. 서버 URL과 실행 상태를 확인하세요.</p>
      )}
      {props.error && <p className="error">{props.error}</p>}

      {props.roomCode ? (
        <>
          <div className="muted">초대코드</div>
          <div className="invite">{props.roomCode}</div>
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button type="button" onClick={props.onToggleMotion}>
              이동/정지 토글
            </button>
            <button type="button" className="ghost" onClick={props.onLeave}>
              방 나가기
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => void navigator.clipboard?.writeText(props.roomCode || "")}
            >
              코드 복사
            </button>
          </div>
          <p className="muted">멤버: {props.members.map((m) => m.nickname).join(", ")}</p>
        </>
      ) : (
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={props.onCreate}
            disabled={!props.connected}
          >
            방 만들기
          </button>
          <input
            value={props.inviteInput}
            onChange={(e) => props.onInviteInput(e.target.value.toUpperCase())}
            placeholder="초대코드"
            maxLength={6}
            style={{ width: 120 }}
          />
          <button type="button" onClick={props.onJoin} disabled={!props.connected}>
            입장
          </button>
        </div>
      )}

      <div style={{ marginTop: "1rem" }}>
        <div className="chat-log">
          {props.messages.length === 0 && (
            <div className="muted">채팅이 여기에 표시됩니다. 말풍선은 오버레이에 뜹니다.</div>
          )}
          {props.messages.map((m) => (
            <div key={m.id} className="chat-line">
              <strong>{m.nickname}</strong>: {m.text}
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: "0.55rem" }}>
          <input
            style={{ flex: 1 }}
            value={props.chatInput}
            maxLength={80}
            placeholder="메시지 (최대 80자)"
            onChange={(e) => props.onChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") props.onSend();
            }}
            disabled={!props.roomCode}
          />
          <button
            type="button"
            className="primary"
            onClick={props.onSend}
            disabled={!props.roomCode}
          >
            전송
          </button>
        </div>
      </div>
    </section>
  );
}
