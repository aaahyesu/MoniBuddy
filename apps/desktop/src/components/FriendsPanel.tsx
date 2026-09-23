import { CharacterView } from "./CharacterView";
import type { Character, FriendInfo, FriendInviteRecvPayload } from "@monibuddy/shared";
import { Btn, SectionLabel, inputClass } from "./ui";

type Props = {
  myFriendCode: string;
  friends: FriendInfo[];
  connected: boolean;
  roomCode: string | null;
  pendingInvite: FriendInviteRecvPayload | null;
  error: string | null;
  serverUrl: string;
  onCopyCode: () => void;
  onAddFriend: (code: string) => void;
  onRemoveFriend: (userId: string) => void;
  onInviteFriend: (userId: string) => void;
  onAcceptInvite: () => void;
  onDismissInvite: () => void;
};

export function FriendsPanel({
  myFriendCode,
  friends,
  connected,
  roomCode,
  pendingInvite,
  error,
  serverUrl,
  onCopyCode,
  onAddFriend,
  onRemoveFriend,
  onInviteFriend,
  onAcceptInvite,
  onDismissInvite,
}: Props) {
  return (
    <div className="grid gap-3 border border-white/50 bg-black/40 p-4">
      <SectionLabel tone="orange">Friends</SectionLabel>

      <div className="flex flex-nowrap items-center gap-2">
        <span className="shrink-0 text-[0.72rem] uppercase tracking-wider text-mute">
          내 친구 코드
        </span>
        <code className="min-w-0 truncate rounded border border-white/30 bg-black/50 px-2.5 py-1 font-mono text-[0.95rem] tracking-[0.18em] text-accent-cyan">
          {myFriendCode || "------"}
        </code>
        <Btn
          type="button"
          variant="ghost"
          className="shrink-0 px-2.5 py-1 text-[0.78rem]"
          onClick={onCopyCode}
        >
          복사
        </Btn>
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const code = String(fd.get("code") ?? "");
          onAddFriend(code);
          e.currentTarget.reset();
        }}
      >
        <input
          name="code"
          className={`${inputClass} min-w-[8rem] flex-1 uppercase tracking-[0.15em]`}
          maxLength={8}
          placeholder="친구 코드"
          disabled={!connected}
        />
        <Btn type="submit" variant="default" disabled={!connected}>
          친구 추가
        </Btn>
      </form>

      {error ? (
        <p className="m-0 text-[0.78rem] text-danger">{error}</p>
      ) : null}

      {pendingInvite ? (
        <div className="grid gap-2 border border-accent-cyan/50 bg-black/50 p-3">
          <p className="m-0 text-[0.85rem] text-white">
            <strong className="text-accent-cyan">{pendingInvite.fromNickname}</strong>
            님이 방으로 초대했어요
          </p>
          <p className="m-0 font-mono tracking-[0.18em] text-mute">
            {pendingInvite.roomCode}
          </p>
          <div className="flex gap-2">
            <Btn type="button" variant="primary" className="flex-1" onClick={onAcceptInvite}>
              입장
            </Btn>
            <Btn type="button" variant="ghost" onClick={onDismissInvite}>
              거절
            </Btn>
          </div>
        </div>
      ) : null}

      <ul className="m-0 grid list-none gap-2 p-0">
        {friends.length === 0 ? (
          <li className="text-[0.78rem] text-mute">아직 친구가 없어요</li>
        ) : (
          friends.map((f) => (
            <FriendRow
              key={f.userId}
              friend={f}
              serverUrl={serverUrl}
              canInvite={f.online}
              onInvite={() => onInviteFriend(f.userId)}
              onRemove={() => onRemoveFriend(f.userId)}
            />
          ))
        )}
      </ul>

      {!roomCode ? (
        <p className="m-0 text-[0.68rem] text-mute">
          초대 시 방이 없으면 자동으로 방을 만들어요.
        </p>
      ) : (
        <p className="m-0 text-[0.68rem] text-mute">
          현재 방 {roomCode} 으로 온라인 친구를 초대할 수 있어요.
        </p>
      )}
    </div>
  );
}

function FriendRow({
  friend,
  serverUrl,
  canInvite,
  onInvite,
  onRemove,
}: {
  friend: FriendInfo;
  serverUrl: string;
  canInvite: boolean;
  onInvite: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-3 border border-white/20 bg-black/30 p-2">
      <div className="relative shrink-0 border border-black/20 bg-buddy p-1">
        <CharacterView
          character={friend.character as Character}
          serverUrl={serverUrl}
          size={40}
        />
        <span
          className={`absolute -right-1 -top-1 size-2.5 rounded-full border border-black ${
            friend.online ? "bg-ok" : "bg-white/30"
          }`}
          title={friend.online ? "온라인" : "오프라인"}
        />
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="m-0 truncate text-[0.85rem] text-white">{friend.nickname}</p>
        <p className="m-0 text-[0.68rem] text-mute">
          {friend.online ? "온라인" : "오프라인"} · {friend.friendCode}
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <Btn
          type="button"
          variant="ghost"
          className="px-2 py-1 text-[0.72rem]"
          disabled={!canInvite}
          onClick={onInvite}
        >
          초대
        </Btn>
        <Btn
          type="button"
          variant="ghost"
          className="px-2 py-1 text-[0.72rem]"
          onClick={onRemove}
        >
          삭제
        </Btn>
      </div>
    </li>
  );
}
