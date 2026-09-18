import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  type Character,
  type CharState,
  type ChatMessage,
  type Member,
  type RoomSnapshot,
  SocketEvents,
  defaultCharState,
} from "@monibuddy/shared";

type Options = {
  serverUrl: string;
  nickname: string;
  character: Character;
};

export function useRoomSocket(opts: Options) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seenIds = useRef(new Set<string>());
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const socket = io(opts.serverUrl, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      reconnection: true,
    });
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      setError(null);
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = () => {
      setConnected(false);
      setError("서버에 연결할 수 없습니다.");
    };
    const onSync = (snap: RoomSnapshot) => {
      setRoomCode(snap.code);
      setMembers(snap.members);
    };
    const onChat = (msg: ChatMessage) => {
      if (seenIds.current.has(msg.id)) return;
      seenIds.current.add(msg.id);
      setMessages((prev) => [...prev, msg].slice(-50));
    };
    const onChar = (payload: { memberId: string; state: CharState }) => {
      setMembers((prev) =>
        prev.map((m) => (m.id === payload.memberId ? { ...m, state: payload.state } : m)),
      );
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on(SocketEvents.MemberSync, onSync);
    socket.on(SocketEvents.ChatBroadcast, onChat);
    socket.on(SocketEvents.CharState, onChar);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off(SocketEvents.MemberSync, onSync);
      socket.off(SocketEvents.ChatBroadcast, onChat);
      socket.off(SocketEvents.CharState, onChar);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [opts.serverUrl]);

  // Forward overlay self motion to peers
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
          prev.map((m) => (m.id === memberId ? { ...m, state: parsed.state } : m)),
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
    const { nickname, character } = optsRef.current;
    const ack = await new Promise<{
      ok: boolean;
      code?: string;
      memberId?: string;
      error?: string;
      room?: RoomSnapshot;
    }>((resolve) => {
      socket.emit(SocketEvents.RoomCreate, { nickname, character }, resolve);
    });
    if (!ack?.ok) {
      setError(ack?.error ?? "방 생성 실패");
      return false;
    }
    setRoomCode(ack.code!);
    setMemberId(ack.memberId!);
    if (ack.room) setMembers(ack.room.members);
    return true;
  }, []);

  const joinRoom = useCallback(async (code: string) => {
    setError(null);
    const socket = socketRef.current;
    if (!socket) return false;
    const { nickname, character } = optsRef.current;
    const ack = await new Promise<{
      ok: boolean;
      memberId?: string;
      error?: string;
      room?: RoomSnapshot;
    }>((resolve) => {
      socket.emit(
        SocketEvents.RoomJoin,
        { code: code.trim().toUpperCase(), nickname, character },
        resolve,
      );
    });
    if (!ack?.ok) {
      setError(ack?.error ?? "입장 실패");
      return false;
    }
    const codeNorm = code.trim().toUpperCase();
    setMemberId(ack.memberId!);
    setRoomCode(ack.room?.code ?? codeNorm);
    if (ack.room) setMembers(ack.room.members);
    return true;
  }, []);

  const leaveRoom = useCallback(() => {
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

  const publishState = useCallback(
    (state: CharState) => {
      socketRef.current?.emit(SocketEvents.CharState, { state });
      if (!memberId) return;
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, state } : m)));
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
    createRoom,
    joinRoom,
    leaveRoom,
    sendChat,
    publishState,
    toggleLocalMotion,
  };
}
