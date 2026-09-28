import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CharacterView } from "./CharacterView";
import type {
  Character,
  FriendGroup,
  FriendInfo,
  FriendInviteRecvPayload,
} from "@monibuddy/shared";
import { Btn, SectionLabel, inputClass } from "./ui";
import { cn } from "../lib/cn";

type FilterKey = "all" | "ungrouped" | string;

type Props = {
  myFriendCode: string;
  friends: FriendInfo[];
  groups: FriendGroup[];
  connected: boolean;
  friendsReady?: boolean;
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
  onCreateGroup: (name: string) => void | Promise<boolean | void>;
  onRenameGroup: (groupId: string, name: string) => void | Promise<boolean | void>;
  onDeleteGroup: (groupId: string) => void | Promise<boolean | void>;
  onAssignGroup: (
    friendUserId: string,
    groupIds: string[],
  ) => void | Promise<boolean | void>;
};

export function FriendsPanel({
  myFriendCode,
  friends,
  groups,
  connected,
  friendsReady = true,
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
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onAssignGroup,
}: Props) {
  const canAdd = connected && friendsReady;
  const [filter, setFilter] = useState<FilterKey>("all");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);

  const selectedGroup =
    filter !== "all" && filter !== "ungrouped"
      ? groups.find((g) => g.id === filter)
      : undefined;

  useEffect(() => {
    if (
      filter !== "all" &&
      filter !== "ungrouped" &&
      !groups.some((g) => g.id === filter)
    ) {
      setFilter("all");
    }
  }, [filter, groups]);

  const list = useMemo(() => {
    if (filter === "all") return friends;
    if (filter === "ungrouped")
      return friends.filter((f) => (f.groupIds ?? []).length === 0);
    return friends.filter((f) => (f.groupIds ?? []).includes(filter));
  }, [friends, filter]);

  return (
    <div
      data-guide="guide-friends"
      className="grid gap-3 border border-white/50 bg-black/40 p-4"
    >
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
          disabled={!canAdd}
        />
        <Btn type="submit" variant="default" disabled={!canAdd}>
          친구 추가
        </Btn>
      </form>

      {!friendsReady && connected ? (
        <p className="m-0 text-[0.68rem] text-mute">친구 서버 등록 중…</p>
      ) : null}

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

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip
          active={filter === "all"}
          onClick={() => {
            setFilter("all");
            setRenaming(false);
          }}
        >
          전체
        </FilterChip>
        {groups.map((g) => (
          <FilterChip
            key={g.id}
            active={filter === g.id}
            onClick={() => {
              setFilter(g.id);
              setRenaming(false);
              setRenameValue(g.name);
            }}
          >
            {g.name}
          </FilterChip>
        ))}
        <FilterChip
          active={filter === "ungrouped"}
          onClick={() => {
            setFilter("ungrouped");
            setRenaming(false);
          }}
        >
          미분류
        </FilterChip>
        {!creating ? (
          <Btn
            type="button"
            variant="default"
            className="px-2.5 py-1 text-[0.72rem]"
            disabled={!canAdd || groupBusy}
            title={!canAdd ? "서버 연결 후 사용할 수 있어요" : "그룹 만들기"}
            onClick={() => setCreating(true)}
          >
            + 그룹
          </Btn>
        ) : null}
      </div>

      {creating ? (
        <form
          className="flex w-full flex-wrap items-center gap-2 border border-white/30 bg-black/40 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name || groupBusy) return;
            setGroupBusy(true);
            void Promise.resolve(onCreateGroup(name)).then((ok) => {
              setGroupBusy(false);
              if (ok === false) return;
              setNewName("");
              setCreating(false);
            });
          }}
        >
          <input
            autoFocus
            className={`${inputClass} min-w-[10rem] flex-1 py-1.5 text-[0.82rem]`}
            maxLength={24}
            placeholder="그룹 이름 입력"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={!canAdd || groupBusy}
          />
          <Btn
            type="submit"
            variant="primary"
            className="px-3 py-1.5 text-[0.72rem]"
            disabled={!canAdd || groupBusy || !newName.trim()}
          >
            {groupBusy ? "추가 중…" : "추가"}
          </Btn>
          <Btn
            type="button"
            variant="ghost"
            className="px-2 py-1 text-[0.72rem]"
            disabled={groupBusy}
            onClick={() => {
              setCreating(false);
              setNewName("");
            }}
          >
            취소
          </Btn>
        </form>
      ) : null}

      {!canAdd ? (
        <p className="m-0 text-[0.68rem] text-mute">
          그룹은 서버 연결 후 사용할 수 있어요.
        </p>
      ) : null}

      {selectedGroup ? (
        <div className="flex flex-wrap items-center gap-2">
          {renaming ? (
            <form
              className="flex flex-1 flex-wrap gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                const name = renameValue.trim();
                if (!name) return;
                onRenameGroup(selectedGroup.id, name);
                setRenaming(false);
              }}
            >
              <input
                autoFocus
                className={`${inputClass} min-w-[6rem] flex-1 py-1 text-[0.78rem]`}
                maxLength={24}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
              />
              <Btn type="submit" variant="default" className="px-2 py-1 text-[0.72rem]">
                저장
              </Btn>
              <Btn
                type="button"
                variant="ghost"
                className="px-2 py-1 text-[0.72rem]"
                onClick={() => setRenaming(false)}
              >
                취소
              </Btn>
            </form>
          ) : (
            <>
              <Btn
                type="button"
                variant="ghost"
                className="px-2 py-1 text-[0.72rem]"
                onClick={() => {
                  setRenameValue(selectedGroup.name);
                  setRenaming(true);
                }}
              >
                이름변경
              </Btn>
              <Btn
                type="button"
                variant="ghost"
                className="px-2 py-1 text-[0.72rem] text-danger"
                onClick={() => {
                  onDeleteGroup(selectedGroup.id);
                  setFilter("all");
                }}
              >
                그룹 삭제
              </Btn>
            </>
          )}
        </div>
      ) : null}

      <ul className="m-0 grid max-h-[240px] list-none gap-2 overflow-y-auto p-0 pr-1">
        {list.length === 0 ? (
          <li className="text-[0.78rem] text-mute">
            {friends.length === 0 ? "아직 친구가 없어요" : "이 그룹에 친구가 없어요"}
          </li>
        ) : (
          list.map((f) => (
            <FriendRow
              key={f.userId}
              friend={f}
              groups={groups}
              serverUrl={serverUrl}
              canInvite={f.online}
              onInvite={() => onInviteFriend(f.userId)}
              onRemove={() => onRemoveFriend(f.userId)}
              onAssign={(groupIds) => onAssignGroup(f.userId, groupIds)}
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

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border px-2.5 py-1 text-[0.72rem] uppercase tracking-wide transition",
        active
          ? "border-white bg-white font-bold text-black"
          : "border-white/40 text-mute hover:border-white hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function FriendRow({
  friend,
  groups,
  serverUrl,
  canInvite,
  onInvite,
  onRemove,
  onAssign,
}: {
  friend: FriendInfo;
  groups: FriendGroup[];
  serverUrl: string;
  canInvite: boolean;
  onInvite: () => void;
  onRemove: () => void;
  onAssign: (groupIds: string[]) => void;
}) {
  const selected = new Set(friend.groupIds ?? []);
  return (
    <li className="flex items-center gap-3 border border-white/20 bg-black/30 p-2">
      <div className="relative grid size-12 shrink-0 place-items-center overflow-hidden border border-black/20 bg-buddy">
        <CharacterView
          character={friend.character as Character}
          serverUrl={serverUrl}
          size={48}
          fixedSize
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
        {groups.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {groups.map((g) => {
              const checked = selected.has(g.id);
              return (
                <label
                  key={g.id}
                  className={cn(
                    "cursor-pointer border px-1.5 py-0.5 text-[0.65rem] transition",
                    checked
                      ? "border-white bg-white/15 text-white"
                      : "border-white/25 text-mute hover:border-white/50",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => {
                      const next = new Set(selected);
                      if (checked) next.delete(g.id);
                      else next.add(g.id);
                      onAssign([...next]);
                    }}
                  />
                  {g.name}
                </label>
              );
            })}
          </div>
        ) : (
          <p className="m-0 mt-1 text-[0.65rem] text-mute">
            그룹을 만들면 여기에 지정할 수 있어요
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-row items-center gap-1">
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
