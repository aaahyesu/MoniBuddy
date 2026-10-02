import express from "express";
import cors from "cors";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import {
  BUBBLE_TTL_MS,
  CharStatePayload,
  ChatMessage,
  ChatSendPayload,
  FriendAddAck,
  FriendAddPayload,
  FriendGroup,
  FriendGroupAck,
  FriendGroupAssignPayload,
  FriendGroupCreatePayload,
  FriendGroupDeletePayload,
  FriendGroupRenamePayload,
  FriendInfo,
  FriendInviteAck,
  FriendInvitePayload,
  FriendInviteRecvPayload,
  FriendPresencePayload,
  FriendRemoveAck,
  FriendRemovePayload,
  GIF_MAX_BYTES,
  GuideMarkSeenAck,
  MAX_CHAT_LENGTH,
  MAX_ROOM_MEMBERS,
  Member,
  PNG_MAX_BYTES,
  MemberProfilePayload,
  PresenceHelloAck,
  PresenceHelloPayload,
  RoomCreateAck,
  RoomCreatePayload,
  sanitizeChatAttachments,
  RoomJoinAck,
  RoomJoinPayload,
  RoomSnapshot,
  SocketEvents,
  UPLOAD_MAX_EDGE,
  createInviteCode,
  defaultCharState,
  parseEffectChat,
  nicknamesEqual,
} from "@monibuddy/shared";
import { mountDesktopUpdaterProxy } from "./desktopUpdater";
import { FriendStore } from "./friendStore";
import { attachMiniGames, type GameRoom } from "./miniGames";
import { RoomStore } from "./roomStore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, "../uploads");
const DATA_DIR = path.resolve(__dirname, "../data");
// tsx 개발 서버는 3857. dist(`npm start`)와 Render(PORT)는 3847을 기본으로 둔다.
const devFromSource = import.meta.url.replace(/\\/g, "/").includes("/src/index.ts");
const PORT = Number(process.env.PORT ?? (devFromSource ? 3857 : 3847));

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const friends = await FriendStore.create(DATA_DIR);
const roomStore = await RoomStore.create(DATA_DIR);

function sanitizeStatusMessage(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .slice(0, 40);
}

type Room = GameRoom;

const rooms = new Map<string, Room>();
const socketRoom = new Map<string, string>();
/** 끊김 후 빈 방 유지 (클라이언트 재입장 여유) */
const EMPTY_ROOM_GRACE_MS = 45_000;
/** 소켓 끊김 시 멤버를 즉시 제거하지 않고 유지 — 방장 퇴장 레이스 방지 */
const MEMBER_DISCONNECT_GRACE_MS = 45_000;
/** 재시작으로 복원한 멤버. 배포 전환 동안 재접속할 시간을 둠 */
const RESTORE_MEMBER_GRACE_MS = 3 * 60_000;
const emptyRoomTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** key = `${roomCode}:${memberId}` */
const pendingMemberRemovals = new Map<string, ReturnType<typeof setTimeout>>();

function memberRemovalKey(code: string, memberId: string) {
  return `${code}:${memberId}`;
}

const persistTail = new Map<string, Promise<void>>();

function enqueuePersist(code: string, job: () => Promise<void>): Promise<void> {
  const prev = persistTail.get(code) ?? Promise.resolve();
  const result = prev.then(job);
  persistTail.set(
    code,
    result.catch((err) => {
      console.error(`[rooms] persist ${code} failed`, err);
    }),
  );
  return result;
}

function snapshotMembers(room: Room): Member[] {
  return JSON.parse(JSON.stringify([...room.members.values()])) as Member[];
}

function persistRoom(room: Room): Promise<void> {
  const members = snapshotMembers(room);
  return enqueuePersist(room.code, () => roomStore.saveRoom(room.code, members));
}

function persistDelete(code: string): Promise<void> {
  return enqueuePersist(code, () => roomStore.deleteRoom(code));
}

function cancelEmptyRoomTimer(code: string) {
  const t = emptyRoomTimers.get(code);
  if (!t) return;
  clearTimeout(t);
  emptyRoomTimers.delete(code);
}

function cancelPendingMemberRemoval(code: string, memberId: string) {
  const key = memberRemovalKey(code, memberId);
  const t = pendingMemberRemovals.get(key);
  if (!t) return;
  clearTimeout(t);
  pendingMemberRemovals.delete(key);
}

function scheduleEmptyRoomExpiry(code: string) {
  cancelEmptyRoomTimer(code);
  const timer = setTimeout(() => {
    emptyRoomTimers.delete(code);
    const room = rooms.get(code);
    if (room && room.members.size === 0) {
      rooms.delete(code);
    }
  }, EMPTY_ROOM_GRACE_MS);
  emptyRoomTimers.set(code, timer);
}

function memberHasSocket(room: Room, memberId: string): boolean {
  for (const mid of room.socketToMember.values()) {
    if (mid === memberId) return true;
  }
  return false;
}

function scheduleMemberRemoval(
  code: string,
  memberId: string,
  delayMs = MEMBER_DISCONNECT_GRACE_MS,
) {
  cancelPendingMemberRemoval(code, memberId);
  const key = memberRemovalKey(code, memberId);
  const timer = setTimeout(() => {
    pendingMemberRemovals.delete(key);
    const room = rooms.get(code);
    if (!room) return;
    if (memberHasSocket(room, memberId)) return;
    const member = room.members.get(memberId);
    room.members.delete(memberId);
    if (room.members.size === 0) {
      scheduleEmptyRoomExpiry(code);
      void persistDelete(code);
      return;
    }
    void persistRoom(room);
    if (member) {
      io.to(code).emit(SocketEvents.RoomNotice, {
        type: "member-leave",
        nickname: member.nickname,
        memberId,
        at: Date.now(),
      });
    }
    broadcastSync(room);
  }, delayMs);
  pendingMemberRemovals.set(key, timer);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = file.mimetype === "image/gif" ? ".gif" : ".png";
    cb(null, `${nanoid(12)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: GIF_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "image/png" || file.mimetype === "image/gif") {
      cb(null, true);
      return;
    }
    cb(new Error("Only PNG or GIF allowed"));
  },
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "monibuddy-server" });
});

mountDesktopUpdaterProxy(app);

app.post("/assets", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ ok: false, error: "file required" });
    return;
  }
  const maxBytes = req.file.mimetype === "image/gif" ? GIF_MAX_BYTES : PNG_MAX_BYTES;
  if (req.file.size > maxBytes) {
    fs.unlinkSync(req.file.path);
    res.status(400).json({
      ok: false,
      error: `File too large (max ${Math.floor(maxBytes / 1024)}KB)`,
    });
    return;
  }

  const imageId = path.parse(req.file.filename).name;
  const displaySize = Number(req.body.displaySize ?? 64);
  const size = ([32, 64, 80, 128].includes(displaySize) ? displaySize : 64) as
    | 32
    | 64
    | 80
    | 128;

  res.json({
    ok: true,
    imageId,
    mime: req.file.mimetype as "image/png" | "image/gif",
    displaySize: size,
    url: `/assets/${req.file.filename}`,
    maxEdge: UPLOAD_MAX_EDGE,
  });
});

app.get("/assets/:filename", (req, res) => {
  const filePath = path.join(UPLOAD_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.sendFile(filePath);
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1_500_000,
});

function snapshot(room: Room): RoomSnapshot {
  return {
    code: room.code,
    members: Array.from(room.members.values()),
  };
}

function broadcastSync(room: Room) {
  io.to(room.code).emit(SocketEvents.MemberSync, snapshot(room));
}

function leaveSocket(socketId: string, opts?: { intentional?: boolean }) {
  const code = socketRoom.get(socketId);
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  const memberId = room.socketToMember.get(socketId);
  const leaving = memberId ? room.members.get(memberId) : undefined;

  if (memberId) {
    room.socketToMember.delete(socketId);
  }
  socketRoom.delete(socketId);
  void io.sockets.sockets.get(socketId)?.leave(code);

  if (!memberId || !leaving) return;

  if (opts?.intentional) {
    cancelPendingMemberRemoval(code, memberId);
    room.members.delete(memberId);
    if (room.members.size === 0) {
      // 혼자 나간 경우도 즉시 삭제하지 않음 — 동시 재입장 레이스 완화
      scheduleEmptyRoomExpiry(code);
      void persistDelete(code);
      return;
    }
    void persistRoom(room);
    io.to(code).emit(SocketEvents.RoomNotice, {
      type: "member-leave",
      nickname: leaving.nickname,
      memberId,
      at: Date.now(),
    });
    broadcastSync(room);
    return;
  }

  // 네트워크 끊김: 멤버 슬롯을 잠시 유지해 방이 빈 것으로 오인되지 않게 함
  scheduleMemberRemoval(code, memberId);
}

io.on("connection", (socket) => {
  const games = attachMiniGames(io, rooms, (sid) => socketRoom.get(sid));

  socket.on(SocketEvents.BombStart, (payload, ack) => {
    games.startBomb(socket, payload ?? { seconds: 30 }, ack);
  });
  socket.on(SocketEvents.BombPass, (payload, ack) => {
    games.passBomb(socket, payload ?? { random: true }, ack);
  });
  socket.on(SocketEvents.LadderOpen, (payload, ack) => {
    games.openLadder(socket, payload, ack);
  });
  socket.on(SocketEvents.LadderStart, (payload, ack) => {
    games.startLadder(socket, payload ?? { memberIds: [] }, ack);
  });
  socket.on(SocketEvents.LadderCancel, (payload, ack) => {
    games.cancelLadder(socket, payload, ack);
  });

  socket.on(SocketEvents.RoomCreate, async (payload: RoomCreatePayload, ack?: (r: RoomCreateAck) => void) => {
    try {
      if (!payload?.nickname?.trim() || !payload.character) {
        ack?.({ ok: false, error: "nickname and character required" });
        return;
      }
      leaveSocket(socket.id);
      let code = createInviteCode();
      while (rooms.has(code)) code = createInviteCode();

      const memberId = nanoid(10);
      const member: Member = {
        id: memberId,
        nickname: payload.nickname.trim().slice(0, 16),
        character: payload.character,
        state: defaultCharState(0.05),
        offset: 8,
        statusMessage: sanitizeStatusMessage(payload.statusMessage),
      };

      const room: Room = {
        code,
        members: new Map([[memberId, member]]),
        socketToMember: new Map([[socket.id, memberId]]),
      };
      rooms.set(code, room);
      cancelEmptyRoomTimer(code);
      socketRoom.set(socket.id, code);
      void socket.join(code);
      try {
        await persistRoom(room);
      } catch (err) {
        rooms.delete(code);
        socketRoom.delete(socket.id);
        throw err;
      }
      ack?.({ ok: true, code, memberId, room: snapshot(room) });
      broadcastSync(room);
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : "create failed" });
    }
  });

  socket.on(SocketEvents.RoomJoin, async (payload: RoomJoinPayload, ack?: (r: RoomJoinAck) => void) => {
    try {
      const code = payload?.code?.trim().toUpperCase();
      if (!code || !payload?.nickname?.trim() || !payload.character) {
        ack?.({ ok: false, error: "code, nickname and character required" });
        return;
      }
      const room = rooms.get(code);
      if (!room) {
        ack?.({ ok: false, error: "room not found" });
        return;
      }
      leaveSocket(socket.id);
      const nickname = payload.nickname.trim().slice(0, 16);
      // 같은 닉은 항상 한 슬롯만 쓴다. 이전 소켓이 아직 살아 있어도
      // 새 멤버를 만들지 않고 그 캐릭터에 연결만 추가한다.
      const nicknameKey = nickname.toLowerCase();
      const existing = [...room.members.values()].find(
        (m) => m.nickname.trim().toLowerCase() === nicknameKey,
      );

      let memberId: string;
      let member: Member;
      let isNew = false;
      if (existing) {
        memberId = existing.id;
        cancelPendingMemberRemoval(code, memberId);
        member = {
          ...existing,
          nickname,
          character: payload.character,
          statusMessage: sanitizeStatusMessage(payload.statusMessage),
        };
        room.members.set(memberId, member);
      } else {
        if (room.members.size >= MAX_ROOM_MEMBERS) {
          ack?.({ ok: false, error: "room is full" });
          return;
        }
        isNew = true;
        memberId = nanoid(10);
        const slot = room.members.size;
        member = {
          id: memberId,
          nickname,
          character: payload.character,
          state: defaultCharState(0.1 + slot * 0.08),
          offset: 8 + slot * 10,
          statusMessage: sanitizeStatusMessage(payload.statusMessage),
        };
        room.members.set(memberId, member);
      }
      room.socketToMember.set(socket.id, memberId);
      cancelEmptyRoomTimer(code);
      socketRoom.set(socket.id, code);
      void socket.join(code);
      await persistRoom(room);
      ack?.({ ok: true, memberId, room: snapshot(room) });
      if (isNew) {
        socket.to(code).emit(SocketEvents.RoomNotice, {
          type: "member-join",
          nickname: member.nickname,
          memberId,
          at: Date.now(),
        });
      }
      broadcastSync(room);
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : "join failed" });
    }
  });

  socket.on(SocketEvents.RoomLeave, () => {
    leaveSocket(socket.id, { intentional: true });
  });

  socket.on(SocketEvents.ChatSend, (payload: ChatSendPayload) => {
    const code = socketRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const memberId = room.socketToMember.get(socket.id);
    if (!memberId) return;
    const member = room.members.get(memberId);
    if (!member) return;

    const nicknames = [...room.members.values()].map((m) => m.nickname);
    const rawText = String(payload?.text ?? "");
    const attachments = sanitizeChatAttachments(payload?.attachments);
    if (games.handleChatCommand(socket, rawText)) return;

    const parsed = parseEffectChat(rawText, nicknames);

    const emitToRoomOrTarget = (message: ChatMessage, targetNick?: string) => {
      if (!targetNick) {
        io.to(code).emit(SocketEvents.ChatBroadcast, message);
        return;
      }
      // fuzzy + NFC: parseEffectChat이 준 닉을 방 멤버에 다시 고정
      const resolved =
        nicknames.find((n) => nicknamesEqual(n, targetNick)) ??
        [...room.members.values()].find((m) =>
          nicknamesEqual(m.nickname, targetNick),
        )?.nickname;
      if (!resolved) return;
      // 방 전체에 브로드캐스트 — 클라가 targetNickname으로 연출 필터
      // (소켓 id 단건 emit은 폴링/재연결 시 상대에게 안 뜨는 경우가 있음)
      io.to(code).emit(SocketEvents.ChatBroadcast, {
        ...message,
        targetNickname: resolved,
      });
    };

    if (parsed.kind === "egg") {
      if (!parsed.text) return;
      const message: ChatMessage = {
        id: nanoid(12),
        memberId: member.id,
        nickname: member.nickname,
        text: "계란",
        at: Date.now(),
        kind: "egg",
        ...(parsed.targetNickname
          ? { targetNickname: parsed.targetNickname }
          : {}),
      };
      emitToRoomOrTarget(message, parsed.targetNickname);
      return;
    }

    const text = parsed.text.slice(0, MAX_CHAT_LENGTH);
    if (!text && attachments.length === 0) return;

    const message: ChatMessage = {
      id: nanoid(12),
      memberId: member.id,
      nickname: member.nickname,
      text,
      at: Date.now(),
      ...(parsed.kind === "letter" ? { kind: "letter" as const } : {}),
      ...(parsed.kind === "letter" && parsed.targetNickname
        ? { targetNickname: parsed.targetNickname }
        : {}),
      ...(attachments.length ? { attachments } : {}),
    };
    emitToRoomOrTarget(
      message,
      parsed.kind === "letter" ? parsed.targetNickname : undefined,
    );

    setTimeout(() => {
      void BUBBLE_TTL_MS;
    }, BUBBLE_TTL_MS);
  });

  socket.on(SocketEvents.CharState, (payload: CharStatePayload) => {
    const code = socketRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const memberId = room.socketToMember.get(socket.id);
    if (!memberId) return;
    const member = room.members.get(memberId);
    if (!member || !payload?.state) return;
    member.state = payload.state;
    socket.to(code).emit(SocketEvents.CharState, { memberId, state: payload.state });
  });

  socket.on(SocketEvents.MemberProfile, (payload: MemberProfilePayload) => {
    const code = socketRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const memberId = room.socketToMember.get(socket.id);
    if (!memberId) return;
    const member = room.members.get(memberId);
    if (!member) return;
    member.statusMessage = sanitizeStatusMessage(payload?.statusMessage);
    void persistRoom(room);
    broadcastSync(room);
  });

  socket.on(
    SocketEvents.PresenceHello,
    async (payload: PresenceHelloPayload, ack?: (r: PresenceHelloAck) => void) => {
      try {
        if (!payload?.userId?.trim() || !payload.nickname?.trim() || !payload.character) {
          ack?.({ ok: false, error: "userId, nickname and character required" });
          return;
        }
        const user = await friends.upsertUser({
          userId: payload.userId.trim().slice(0, 40),
          friendCode: payload.friendCode,
          nickname: payload.nickname,
          character: payload.character,
        });
        friends.setOnline(socket.id, user);
        const [list, groups, guideSeen] = await Promise.all([
          friends.listFriends(user.userId),
          friends.listGroups(user.userId),
          friends.isGuideSeen(user.userId),
        ]);
        ack?.({
          ok: true,
          userId: user.userId,
          friendCode: user.friendCode,
          friends: list,
          groups,
          guideSeen,
        });
        const presence: FriendPresencePayload = {
          userId: user.userId,
          online: true,
          nickname: user.nickname,
          character: user.character,
        };
        for (const sid of await friends.friendSocketIdsFor(user.userId)) {
          io.to(sid).emit(SocketEvents.FriendPresence, presence);
        }
      } catch (err) {
        ack?.({
          ok: false,
          error: err instanceof Error ? err.message : "presence hello failed",
        });
      }
    },
  );

  socket.on(
    SocketEvents.GuideMarkSeen,
    async (_payload?: unknown, ack?: (r: GuideMarkSeenAck) => void) => {
      try {
        const myId = friends.getUserIdBySocket(socket.id);
        if (!myId) {
          ack?.({ ok: false, error: "not registered" });
          return;
        }
        await friends.markGuideSeen(myId);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({
          ok: false,
          error: err instanceof Error ? err.message : "guide mark failed",
        });
      }
    },
  );

  socket.on(
    SocketEvents.FriendAdd,
    async (payload: FriendAddPayload, ack?: (r: FriendAddAck) => void) => {
      try {
        const myId = friends.getUserIdBySocket(socket.id);
        if (!myId) {
          ack?.({ ok: false, error: "not registered" });
          return;
        }
        const code = String(payload?.friendCode ?? "");
        const result = await friends.addFriend(myId, code);
        ack?.(result);
        if (result.ok) {
          const other = await friends.getUserByFriendCode(code);
          if (other) {
            const otherSocket = friends.getPresence(other.userId)?.socketId;
            if (otherSocket) {
              const [friendsList, groups] = await Promise.all([
                friends.listFriends(other.userId),
                friends.listGroups(other.userId),
              ]);
              io.to(otherSocket).emit(SocketEvents.FriendSync, {
                friends: friendsList,
                groups,
              });
            }
          }
          socket.emit(SocketEvents.FriendSync, {
            friends: result.friends,
            groups: result.groups,
          });
        }
      } catch (err) {
        ack?.({
          ok: false,
          error: err instanceof Error ? err.message : "friend add failed",
        });
      }
    },
  );

  socket.on(
    SocketEvents.FriendRemove,
    async (payload: FriendRemovePayload, ack?: (r: FriendRemoveAck) => void) => {
      try {
        const myId = friends.getUserIdBySocket(socket.id);
        if (!myId) {
          ack?.({ ok: false, error: "not registered" });
          return;
        }
        const targetId = String(payload?.userId ?? "");
        const result = await friends.removeFriend(myId, targetId);
        ack?.(result);
        if (result.ok) {
          socket.emit(SocketEvents.FriendSync, {
            friends: result.friends,
            groups: result.groups,
          });
          const otherSocket = friends.getPresence(targetId)?.socketId;
          if (otherSocket) {
            const [friendsList, groups] = await Promise.all([
              friends.listFriends(targetId),
              friends.listGroups(targetId),
            ]);
            io.to(otherSocket).emit(SocketEvents.FriendSync, {
              friends: friendsList,
              groups,
            });
          }
        }
      } catch (err) {
        ack?.({
          ok: false,
          error: err instanceof Error ? err.message : "friend remove failed",
        });
      }
    },
  );

  const emitOwnFriendSync = (
    sid: string,
    payload: { friends: FriendInfo[]; groups: FriendGroup[] },
  ) => {
    io.to(sid).emit(SocketEvents.FriendSync, payload);
  };

  socket.on(
    SocketEvents.FriendGroupCreate,
    async (
      payload: FriendGroupCreatePayload,
      ack?: (r: FriendGroupAck) => void,
    ) => {
      try {
        const myId = friends.getUserIdBySocket(socket.id);
        if (!myId) {
          ack?.({ ok: false, error: "not registered" });
          return;
        }
        const result = await friends.createGroup(myId, String(payload?.name ?? ""));
        ack?.(result);
        if (result.ok) {
          emitOwnFriendSync(socket.id, {
            friends: result.friends,
            groups: result.groups,
          });
        }
      } catch (err) {
        ack?.({
          ok: false,
          error: err instanceof Error ? err.message : "group create failed",
        });
      }
    },
  );

  socket.on(
    SocketEvents.FriendGroupRename,
    async (
      payload: FriendGroupRenamePayload,
      ack?: (r: FriendGroupAck) => void,
    ) => {
      try {
        const myId = friends.getUserIdBySocket(socket.id);
        if (!myId) {
          ack?.({ ok: false, error: "not registered" });
          return;
        }
        const result = await friends.renameGroup(
          myId,
          String(payload?.groupId ?? ""),
          String(payload?.name ?? ""),
        );
        ack?.(result);
        if (result.ok) {
          emitOwnFriendSync(socket.id, {
            friends: result.friends,
            groups: result.groups,
          });
        }
      } catch (err) {
        ack?.({
          ok: false,
          error: err instanceof Error ? err.message : "group rename failed",
        });
      }
    },
  );

  socket.on(
    SocketEvents.FriendGroupDelete,
    async (
      payload: FriendGroupDeletePayload,
      ack?: (r: FriendGroupAck) => void,
    ) => {
      try {
        const myId = friends.getUserIdBySocket(socket.id);
        if (!myId) {
          ack?.({ ok: false, error: "not registered" });
          return;
        }
        const result = await friends.deleteGroup(
          myId,
          String(payload?.groupId ?? ""),
        );
        ack?.(result);
        if (result.ok) {
          emitOwnFriendSync(socket.id, {
            friends: result.friends,
            groups: result.groups,
          });
        }
      } catch (err) {
        ack?.({
          ok: false,
          error: err instanceof Error ? err.message : "group delete failed",
        });
      }
    },
  );

  socket.on(
    SocketEvents.FriendGroupAssign,
    async (
      payload: FriendGroupAssignPayload,
      ack?: (r: FriendGroupAck) => void,
    ) => {
      try {
        const myId = friends.getUserIdBySocket(socket.id);
        if (!myId) {
          ack?.({ ok: false, error: "not registered" });
          return;
        }
        const groupIds = Array.isArray(payload?.groupIds)
          ? payload.groupIds.map((id) => String(id))
          : [];
        const result = await friends.assignGroups(
          myId,
          String(payload?.friendUserId ?? ""),
          groupIds,
        );
        ack?.(result);
        if (result.ok) {
          emitOwnFriendSync(socket.id, {
            friends: result.friends,
            groups: result.groups,
          });
        }
      } catch (err) {
        ack?.({
          ok: false,
          error: err instanceof Error ? err.message : "group assign failed",
        });
      }
    },
  );

  socket.on(
    SocketEvents.FriendInvite,
    async (payload: FriendInvitePayload, ack?: (r: FriendInviteAck) => void) => {
      try {
        const myId = friends.getUserIdBySocket(socket.id);
        if (!myId) {
          ack?.({ ok: false, error: "not registered" });
          return;
        }
        const me = await friends.getUser(myId);
        const toUserId = String(payload?.toUserId ?? "");
        const roomCode = String(payload?.roomCode ?? "")
          .trim()
          .toUpperCase();
        if (!me || !toUserId || !roomCode) {
          ack?.({ ok: false, error: "toUserId and roomCode required" });
          return;
        }
        if (!me.friends.includes(toUserId)) {
          ack?.({ ok: false, error: "not friends" });
          return;
        }
        if (!rooms.has(roomCode)) {
          ack?.({ ok: false, error: "room not found — create or join a room first" });
          return;
        }
        const target = friends.getPresence(toUserId);
        if (!target) {
          ack?.({ ok: false, error: "friend is offline" });
          return;
        }
        const invite: FriendInviteRecvPayload = {
          fromUserId: myId,
          fromNickname: me.nickname,
          roomCode,
          at: Date.now(),
        };
        io.to(target.socketId).emit(SocketEvents.FriendInviteRecv, invite);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({
          ok: false,
          error: err instanceof Error ? err.message : "invite failed",
        });
      }
    },
  );

  socket.on("disconnect", () => {
    leaveSocket(socket.id);
    const offlineUserId = friends.setOfflineBySocket(socket.id);
    if (offlineUserId) {
      const presence: FriendPresencePayload = {
        userId: offlineUserId,
        online: false,
      };
      void friends.friendSocketIdsFor(offlineUserId).then((sids) => {
        for (const sid of sids) {
          io.to(sid).emit(SocketEvents.FriendPresence, presence);
        }
      });
    }
  });
});

async function hydrateRooms() {
  const saved = await roomStore.loadRooms();
  for (const row of saved) {
    if (!row.members.length || rooms.has(row.code)) {
      if (!row.members.length) void persistDelete(row.code);
      continue;
    }
    const room: Room = {
      code: row.code,
      members: new Map(row.members.map((member) => [member.id, member])),
      socketToMember: new Map(),
    };
    rooms.set(row.code, room);
    for (const member of row.members) {
      scheduleMemberRemoval(row.code, member.id, RESTORE_MEMBER_GRACE_MS);
    }
    console.log(`[rooms] restored ${row.code} members=${row.members.length}`);
  }
}

await hydrateRooms();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[MoniBuddy] server listening on 0.0.0.0:${PORT}`);
});
