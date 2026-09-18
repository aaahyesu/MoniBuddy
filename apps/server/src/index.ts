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
  GIF_MAX_BYTES,
  MAX_CHAT_LENGTH,
  MAX_ROOM_MEMBERS,
  Member,
  PNG_MAX_BYTES,
  MemberProfilePayload,
  RoomCreateAck,
  RoomCreatePayload,
  RoomJoinAck,
  RoomJoinPayload,
  RoomSnapshot,
  SocketEvents,
  UPLOAD_MAX_EDGE,
  createInviteCode,
  defaultCharState,
} from "@monibuddy/shared";
import { mountDesktopUpdaterProxy } from "./desktopUpdater";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, "../uploads");
const PORT = Number(process.env.PORT ?? 3847);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function sanitizeStatusMessage(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .slice(0, 40);
}

type Room = {
  code: string;
  members: Map<string, Member>;
  socketToMember: Map<string, string>;
};

const rooms = new Map<string, Room>();
const socketRoom = new Map<string, string>();

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

function leaveSocket(socketId: string) {
  const code = socketRoom.get(socketId);
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  const memberId = room.socketToMember.get(socketId);
  if (memberId) {
    room.members.delete(memberId);
    room.socketToMember.delete(socketId);
  }
  socketRoom.delete(socketId);
  if (room.members.size === 0) {
    rooms.delete(code);
  } else {
    broadcastSync(room);
  }
}

io.on("connection", (socket) => {
  socket.on(SocketEvents.RoomCreate, (payload: RoomCreatePayload, ack?: (r: RoomCreateAck) => void) => {
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
      socketRoom.set(socket.id, code);
      void socket.join(code);
      ack?.({ ok: true, code, memberId, room: snapshot(room) });
      broadcastSync(room);
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : "create failed" });
    }
  });

  socket.on(SocketEvents.RoomJoin, (payload: RoomJoinPayload, ack?: (r: RoomJoinAck) => void) => {
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
      if (room.members.size >= MAX_ROOM_MEMBERS) {
        ack?.({ ok: false, error: "room is full" });
        return;
      }
      leaveSocket(socket.id);
      const memberId = nanoid(10);
      const slot = room.members.size;
      const member: Member = {
        id: memberId,
        nickname: payload.nickname.trim().slice(0, 16),
        character: payload.character,
        state: defaultCharState(0.1 + slot * 0.08),
        offset: 8 + slot * 10,
        statusMessage: sanitizeStatusMessage(payload.statusMessage),
      };
      room.members.set(memberId, member);
      room.socketToMember.set(socket.id, memberId);
      socketRoom.set(socket.id, code);
      void socket.join(code);
      ack?.({ ok: true, memberId, room: snapshot(room) });
      broadcastSync(room);
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : "join failed" });
    }
  });

  socket.on(SocketEvents.RoomLeave, () => {
    leaveSocket(socket.id);
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

    const text = String(payload?.text ?? "").trim().slice(0, MAX_CHAT_LENGTH);
    if (!text) return;

    const message: ChatMessage = {
      id: nanoid(12),
      memberId: member.id,
      nickname: member.nickname,
      text,
      at: Date.now(),
    };
    // Single broadcast including sender — clients dedupe by id if optimistic
    io.to(code).emit(SocketEvents.ChatBroadcast, message);

    setTimeout(() => {
      // bubble TTL hint only; clients also hide locally
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
    broadcastSync(room);
  });

  socket.on("disconnect", () => {
    leaveSocket(socket.id);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[MoniBuddy] server listening on 0.0.0.0:${PORT}`);
});
