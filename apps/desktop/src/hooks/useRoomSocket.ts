import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  type Character,
  type CharState,
  type ChatMessage,
  type FriendInfo,
  type FriendInviteRecvPayload,
  type Member,
  type PresenceHelloAck,
  type RoomSnapshot,
  SocketEvents,
  defaultCharState,
} from "@monibuddy/shared";

type Options = {
  serverUrl: string;
  nickname: string;
  character: Character;
  statusMessage?: string;
  /** true면 WebSocket 없이 HTTPS 폴링만 사용 (회사망 호환) */
  forcePolling?: boolean;
  userId?: string;
  friendCode?: string;
};

function normalizeBase(url: string) {
  return url.replace(/\/$/, "");
}

export function useRoomSocket(opts: Options) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [friendError, setFriendError] = useState<string | null>(null);
  const [pendingInvite, setPendingInvite] =
    useState<FriendInviteRecvPayload | null>(null);
  const [resolvedFriendCode, setResolvedFriendCode] = useState(
    opts.friendCode ?? "",
  );
  const seenIds = useRef(new Set<string>());
  const optsRef = useRef(opts);
  /** 입장 중인 방 코드. 의도적 퇴장 시에만 비움 — 끊겨도 유지해 재입장에 사용 */
  const roomCodeRef = useRef<string | null>(null);
  const rejoiningRef = useRef(false);
  optsRef.current = opts;
  const forcePolling = opts.forcePolling !== false;

  const clearRoomLocal = useCallback(() => {
    roomCodeRef.current = null;
    setRoomCode(null);
    setMemberId(null);
    setMembers([]);
    setMessages([]);
    seenIds.current.clear();
  }, []);

  const sendPresenceHello = useCallback((socket: Socket) => {
    const { userId, friendCode, nickname, character } = optsRef.current;
    if (!userId || !nickname?.trim() || !character) return;
    socket.emit(
      SocketEvents.PresenceHello,
      {
        userId,
        friendCode: friendCode || "",
        nickname,
        character,
      },
      (ack: PresenceHelloAck) => {
        if (!ack?.ok) {
          setFriendError(ack?.error ?? "친구 서버 등록 실패");
          return;
        }
        setResolvedFriendCode(ack.friendCode);
        setFriends(ack.friends);
        setFriendError(null);
      },
    );
  }, []);

  const joinRoomOnSocket = useCallback(
    async (socket: Socket, code: string, optsJoin?: { silent?: boolean }) => {
      const { nickname, character, statusMessage } = optsRef.current;
      const ack = await new Promise<{
        ok: boolean;
        memberId?: string;
        error?: string;
        room?: RoomSnapshot;
      }>((resolve) => {
        socket.emit(
          SocketEvents.RoomJoin,
          {
            code: code.trim().toUpperCase(),
            nickname,
            character,
            statusMessage: (statusMessage || "").trim().slice(0, 40),
          },
          resolve,
        );
      });
      if (!ack?.ok) {
        if (!optsJoin?.silent) {
          setError(ack?.error ?? "입장 실패");
        }
        return false;
      }
      const codeNorm = code.trim().toUpperCase();
      const nextCode = ack.room?.code ?? codeNorm;
      setMemberId(ack.memberId!);
      setRoomCode(nextCode);
      roomCodeRef.current = nextCode;
      if (ack.room) setMembers(ack.room.members);
      setError(null);
      return true;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let socket: Socket | null = null;
    const base = normalizeBase(opts.serverUrl);

    const connect = async () => {
      setConnected(false);
      setError(null);

      try {
        await fetch(`${base}/health`, { cache: "no-store", mode: "cors" });
      } catch {
        /* socket 쪽에서 재시도 */
      }
      if (cancelled) return;

      socket = io(base, {
        transports: forcePolling ? ["polling"] : ["polling", "websocket"],
        upgrade: !forcePolling,
        rememberUpgrade: false,
        forceBase64: forcePolling,
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 12,
        reconnectionDelay: 1500,
        timeout: 45000,
      });
      socketRef.current = socket;

      const tryRejoin = async () => {
        const code = roomCodeRef.current;
        if (!code || rejoiningRef.current || cancelled) return;
        rejoiningRef.current = true;
        try {
          const ok = await joinRoomOnSocket(socket!, code, { silent: true });
          if (!ok && roomCodeRef.current === code) {
            // 방이 이미 사라졌거나 입장 불가 — 로컬 방 상태만 정리
            clearRoomLocal();
            setError("연결이 끊겨 방에서 나왔어요. 다시 입장해 주세요.");
          }
        } finally {
          rejoiningRef.current = false;
        }
      };

      const onConnect = () => {
        setConnected(true);
        setError(null);
        sendPresenceHello(socket!);
        void tryRejoin();
      };
      const onDisconnect = () => setConnected(false);
      const onConnectError = (err: Error) => {
        setConnected(false);
        setError(
          `서버에 연결할 수 없습니다. (${base}) ${err?.message ? `— ${err.message}` : ""}`.trim(),
        );
      };
      const onSync = (snap: RoomSnapshot) => {
        setRoomCode(snap.code);
        roomCodeRef.current = snap.code;
        setMembers(snap.members);
      };
      const onChat = (msg: ChatMessage) => {
        if (seenIds.current.has(msg.id)) return;
        seenIds.current.add(msg.id);
        setMessages((prev) => [...prev, msg].slice(-50));
      };
      const onChar = (payload: { memberId: string; state: CharState }) => {
        setMembers((prev) =>
          prev.map((m) =>
            m.id === payload.memberId ? { ...m, state: payload.state } : m,
          ),
        );
      };
      const onFriendSync = (payload: { friends: FriendInfo[] }) => {
        setFriends(payload.friends ?? []);
      };
      const onFriendPresence = (payload: {
        userId: string;
        online: boolean;
        nickname?: string;
        character?: Character;
      }) => {
        setFriends((prev) =>
          prev.map((f) =>
            f.userId === payload.userId
              ? {
                  ...f,
                  online: payload.online,
                  ...(payload.nickname ? { nickname: payload.nickname } : {}),
                  ...(payload.character ? { character: payload.character } : {}),
                }
              : f,
          ),
        );
      };
      const onInvite = (payload: FriendInviteRecvPayload) => {
        setPendingInvite(payload);
      };

      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("connect_error", onConnectError);
      socket.on(SocketEvents.MemberSync, onSync);
      socket.on(SocketEvents.ChatBroadcast, onChat);
      socket.on(SocketEvents.CharState, onChar);
      socket.on(SocketEvents.FriendSync, onFriendSync);
      socket.on(SocketEvents.FriendPresence, onFriendPresence);
      socket.on(SocketEvents.FriendInviteRecv, onInvite);
    };

    void connect();

    return () => {
      cancelled = true;
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [
    opts.serverUrl,
    forcePolling,
    sendPresenceHello,
    joinRoomOnSocket,
    clearRoomLocal,
  ]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    sendPresenceHello(socket);
  }, [
    opts.userId,
    opts.friendCode,
    opts.nickname,
    opts.character,
    sendPresenceHello,
  ]);

  useEffect(() => {
    if (!roomCode || !memberId) return;
    const id = window.setInterval(() => {
      try {
        const raw = localStorage.getItem("monibuddy.selfState.v1");
        if (!raw) return;
        const parsed = JSON.parse(raw) as { state: CharState; at: number };
        if (Date.now() - parsed.at > 2000) return;
        socketRef.current?.emit(SocketEvents.CharState, { state: parsed.state });
        setMembers((prev) =>
          prev.map((m) =>
            m.id === memberId ? { ...m, state: parsed.state } : m,
          ),
        );
      } catch {
        /* ignore */
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [roomCode, memberId]);

  const createRoom = useCallback(async () => {
    setError(null);
    const socket = socketRef.current;
    if (!socket) return false;
    const { nickname, character, statusMessage } = optsRef.current;
    const ack = await new Promise<{
      ok: boolean;
      code?: string;
      memberId?: string;
      error?: string;
      room?: RoomSnapshot;
    }>((resolve) => {
      socket.emit(
        SocketEvents.RoomCreate,
        {
          nickname,
          character,
          statusMessage: (statusMessage || "").trim().slice(0, 40),
        },
        resolve,
      );
    });
    if (!ack?.ok) {
      setError(ack?.error ?? "방 생성 실패");
      return false;
    }
    setRoomCode(ack.code!);
    roomCodeRef.current = ack.code!;
    setMemberId(ack.memberId!);
    if (ack.room) setMembers(ack.room.members);
    return true;
  }, []);

  const joinRoom = useCallback(
    async (code: string) => {
      setError(null);
      const socket = socketRef.current;
      if (!socket) return false;
      return joinRoomOnSocket(socket, code);
    },
    [joinRoomOnSocket],
  );

  const leaveRoom = useCallback(() => {
    // 재입장 방지: 의도적 퇴장 플래그를 먼저 지움
    roomCodeRef.current = null;
    socketRef.current?.emit(SocketEvents.RoomLeave);
    setRoomCode(null);
    setMemberId(null);
    setMembers([]);
    setMessages([]);
    seenIds.current.clear();
  }, []);

  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    socketRef.current?.emit(SocketEvents.ChatSend, { text: trimmed });
  }, []);

  const publishStatusMessage = useCallback(
    (statusMessage: string) => {
      const next = statusMessage.trim().slice(0, 40);
      socketRef.current?.emit(SocketEvents.MemberProfile, {
        statusMessage: next,
      });
      if (!memberId) return;
      setMembers((prev) =>
        prev.map((m) =>
          m.id === memberId ? { ...m, statusMessage: next } : m,
        ),
      );
    },
    [memberId],
  );

  const publishState = useCallback(
    (state: CharState) => {
      socketRef.current?.emit(SocketEvents.CharState, { state });
      if (!memberId) return;
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, state } : m)),
      );
    },
    [memberId],
  );

  const toggleLocalMotion = useCallback(() => {
    if (!memberId) {
      setMembers((prev) =>
        prev.map((m) =>
          m.id === "local"
            ? {
                ...m,
                state: {
                  ...m.state,
                  motion: m.state.motion === "walk" ? "idle" : "walk",
                },
              }
            : m,
        ),
      );
      return;
    }
    setMembers((prev) => {
      const me = prev.find((m) => m.id === memberId);
      if (!me) return prev;
      const next: CharState = {
        ...me.state,
        motion: me.state.motion === "walk" ? "idle" : "walk",
      };
      socketRef.current?.emit(SocketEvents.CharState, { state: next });
      return prev.map((m) => (m.id === memberId ? { ...m, state: next } : m));
    });
  }, [memberId]);

  const addFriend = useCallback(async (friendCode: string) => {
    setFriendError(null);
    const socket = socketRef.current;
    if (!socket?.connected) {
      setFriendError("서버에 연결되지 않았어요");
      return false;
    }
    const ack = await new Promise<{
      ok: boolean;
      friends?: FriendInfo[];
      error?: string;
    }>((resolve) => {
      socket.emit(
        SocketEvents.FriendAdd,
        { friendCode: friendCode.trim().toUpperCase() },
        resolve,
      );
    });
    if (!ack?.ok) {
      setFriendError(ack?.error ?? "친구 추가 실패");
      return false;
    }
    setFriends(ack.friends ?? []);
    return true;
  }, []);

  const removeFriend = useCallback(async (userId: string) => {
    setFriendError(null);
    const socket = socketRef.current;
    if (!socket?.connected) return false;
    const ack = await new Promise<{
      ok: boolean;
      friends?: FriendInfo[];
      error?: string;
    }>((resolve) => {
      socket.emit(SocketEvents.FriendRemove, { userId }, resolve);
    });
    if (!ack?.ok) {
      setFriendError(ack?.error ?? "삭제 실패");
      return false;
    }
    setFriends(ack.friends ?? []);
    return true;
  }, []);

  const inviteFriend = useCallback(
    async (toUserId: string) => {
      setFriendError(null);
      const socket = socketRef.current;
      if (!socket?.connected) {
        setFriendError("서버에 연결되지 않았어요");
        return false;
      }
      let code = roomCodeRef.current;
      if (!code) {
        const created = await createRoom();
        if (!created) return false;
        code = roomCodeRef.current;
      }
      if (!code) {
        setFriendError("방을 먼저 만들어 주세요");
        return false;
      }
      const ack = await new Promise<{ ok: boolean; error?: string }>(
        (resolve) => {
          socket.emit(
            SocketEvents.FriendInvite,
            { toUserId, roomCode: code },
            resolve,
          );
        },
      );
      if (!ack?.ok) {
        setFriendError(ack?.error ?? "초대 실패");
        return false;
      }
      return true;
    },
    [createRoom],
  );

  useEffect(() => {
    if (roomCode) return;
    setMembers([
      {
        id: "local",
        nickname: opts.nickname,
        character: opts.character,
        state: defaultCharState(0.1),
        offset: 10,
      },
    ]);
    setMemberId("local");
  }, [roomCode, opts.nickname, opts.character]);

  return {
    connected,
    roomCode,
    memberId,
    members,
    messages,
    error,
    friends,
    friendError,
    pendingInvite,
    resolvedFriendCode,
    createRoom,
    joinRoom,
    leaveRoom,
    sendChat,
    publishState,
    publishStatusMessage,
    toggleLocalMotion,
    addFriend,
    removeFriend,
    inviteFriend,
    setPendingInvite,
    setFriendError,
  };
}
