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

type GroupEditor =
  | { mode: "create" }
  | { mode: "members"; group: FriendGroup };

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
  /** 성공 시 새 그룹 id, 실패 시 false */
  onCreateGroup: (name: string) => Promise<string | false> | string | false;
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
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [editor, setEditor] = useState<GroupEditor | null>(null);
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

  const syncGroupMembers = async (groupId: string, selectedIds: Set<string>) => {
    for (const f of friends) {
      const has = (f.groupIds ?? []).includes(groupId);
      const want = selectedIds.has(f.userId);
      if (has === want) continue;
      const next = new Set(f.groupIds ?? []);
      if (want) next.add(groupId);
      else next.delete(groupId);
      const ok = await Promise.resolve(onAssignGroup(f.userId, [...next]));
      if (ok === false) return false;
    }
    return true;
  };

  return (
    <div
      data-guide="guide-friends"
      className="relative grid gap-3 border border-white/50 bg-black/40 p-4"
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
        <Btn
          type="button"
          variant="default"
          className="px-2.5 py-1 text-[0.72rem]"
          disabled={!canAdd || groupBusy}
          title={!canAdd ? "서버 연결 후 사용할 수 있어요" : "그룹 만들기"}
          onClick={() => setEditor({ mode: "create" })}
        >
          + 그룹
        </Btn>
      </div>

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
                variant="default"
                className="px-2 py-1 text-[0.72rem]"
                disabled={!canAdd || groupBusy}
                onClick={() =>
                  setEditor({ mode: "members", group: selectedGroup })
                }
              >
                멤버
              </Btn>
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

      <ul className="pixel-scroll m-0 grid max-h-[240px] list-none gap-2 overflow-y-auto border border-white/25 bg-black/30 p-2">
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

      {editor ? (
        <GroupEditorModal
          editor={editor}
          friends={friends}
          serverUrl={serverUrl}
          busy={groupBusy}
          onClose={() => {
            if (groupBusy) return;
            setEditor(null);
          }}
          onSubmit={async (name, selectedIds) => {
            setGroupBusy(true);
            try {
              if (editor.mode === "create") {
                const trimmed = name.trim();
                if (!trimmed) return false;
                const groupId = await Promise.resolve(onCreateGroup(trimmed));
                if (!groupId) return false;
                const ok = await syncGroupMembers(groupId, selectedIds);
                if (!ok) return false;
                setFilter(groupId);
                setEditor(null);
                return true;
              }
              const ok = await syncGroupMembers(editor.group.id, selectedIds);
              if (!ok) return false;
              setEditor(null);
              return true;
            } finally {
              setGroupBusy(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function GroupEditorModal({
  editor,
  friends,
  serverUrl,
  busy,
  onClose,
  onSubmit,
}: {
  editor: GroupEditor;
  friends: FriendInfo[];
  serverUrl: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string, selectedIds: Set<string>) => Promise<boolean>;
}) {
  const initialSelected = useMemo(() => {
    if (editor.mode === "create") return new Set<string>();
    return new Set(
      friends
        .filter((f) => (f.groupIds ?? []).includes(editor.group.id))
        .map((f) => f.userId),
    );
  }, [editor, friends]);

  const [name, setName] = useState(
    editor.mode === "create" ? "" : editor.group.name,
  );
  const [selected, setSelected] = useState<Set<string>>(initialSelected);

  useEffect(() => {
    setSelected(initialSelected);
  }, [initialSelected]);

  const title = editor.mode === "create" ? "새 그룹" : "멤버 관리";
  const subtitle =
    editor.mode === "create"
      ? "이름을 정하고 친구를 눌러 넣어요"
      : `"${editor.group.name}" — 눌러서 넣기/빼기`;

  return (
    <div
      className="absolute inset-0 z-20 grid place-items-center bg-black/75 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="grid w-full max-w-[380px] gap-3 border border-white bg-black/95 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.2)]"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="m-0 text-[0.9rem] font-bold uppercase tracking-wide text-white">
              {title}
            </h3>
            <p className="m-0 mt-1 text-[0.72rem] text-mute">{subtitle}</p>
          </div>
          <button
            type="button"
            className="border border-white/40 px-2 py-0.5 text-[0.72rem] text-mute hover:border-white hover:text-white"
            aria-label="닫기"
            disabled={busy}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {editor.mode === "create" ? (
          <input
            autoFocus
            className={`${inputClass} py-2 text-[0.85rem]`}
            maxLength={24}
            placeholder="그룹 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        ) : null}

        <ul className="pixel-scroll m-0 grid max-h-[200px] list-none gap-1.5 overflow-y-auto border border-white/30 bg-black/50 p-2">
          {friends.length === 0 ? (
            <li className="px-1 py-2 text-[0.78rem] text-mute">
              아직 친구가 없어요. 나중에 멤버에서 넣을 수 있어요.
            </li>
          ) : (
            friends.map((f) => {
              const on = selected.has(f.userId);
              return (
                <li key={f.userId}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(f.userId)) next.delete(f.userId);
                        else next.add(f.userId);
                        return next;
                      });
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 border px-2 py-1.5 text-left transition",
                      on
                        ? "border-white bg-white/15 text-white"
                        : "border-white/20 bg-transparent text-mute hover:border-white/50 hover:text-white",
                    )}
                  >
                    <div className="grid size-9 shrink-0 place-items-center overflow-hidden border border-black/20 bg-buddy">
                      <CharacterView
                        character={f.character as Character}
                        serverUrl={serverUrl}
                        size={36}
                        fixedSize
                      />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-[0.8rem]">
                      {f.nickname}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 border px-1.5 py-0.5 text-[0.65rem]",
                        on
                          ? "border-white bg-white text-black"
                          : "border-white/30",
                      )}
                    >
                      {on ? "IN" : "+"}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <p className="m-0 text-[0.68rem] text-mute">
          선택 {selected.size}명
          {editor.mode === "members" ? " · 다시 누르면 제외" : ""}
        </p>

        <div className="flex gap-2">
          <Btn
            type="button"
            variant="ghost"
            className="flex-1"
            disabled={busy}
            onClick={onClose}
          >
            취소
          </Btn>
          <Btn
            type="button"
            variant="primary"
            className="flex-[1.4]"
            disabled={
              busy || (editor.mode === "create" && !name.trim())
            }
            onClick={() => {
              void onSubmit(name, selected);
            }}
          >
            {busy ? "저장 중…" : editor.mode === "create" ? "만들기" : "저장"}
          </Btn>
        </div>
      </div>
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
}: {
  friend: FriendInfo;
  groups: FriendGroup[];
  serverUrl: string;
  canInvite: boolean;
  onInvite: () => void;
  onRemove: () => void;
}) {
  const labels = groups
    .filter((g) => (friend.groupIds ?? []).includes(g.id))
    .map((g) => g.name);

  return (
    <li className="flex items-center gap-3 border border-white/20 bg-black/40 p-2">
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
        {labels.length > 0 ? (
          <p className="m-0 mt-1 truncate text-[0.65rem] text-accent-cyan">
            {labels.join(" · ")}
          </p>
        ) : (
          <p className="m-0 mt-1 text-[0.65rem] text-mute">미분류</p>
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
