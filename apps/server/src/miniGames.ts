import { nanoid } from "nanoid";
import type { Server, Socket } from "socket.io";
import {
  type BombAck,
  type BombExplodePayload,
  type BombPassPayload,
  type BombStartPayload,
  type BombState,
  type LadderAck,
  type LadderStartPayload,
  type LadderState,
  type Member,
  SocketEvents,
  generateLadderRungs,
  nicknamesEqual,
  resolveLadderPaths,
} from "@monibuddy/shared";

export type GameRoom = {
  code: string;
  members: Map<string, Member>;
  socketToMember: Map<string, string>;
  bomb?: BombState;
  bombTimer?: ReturnType<typeof setTimeout>;
  ladder?: LadderState;
};

function memberByNick(room: GameRoom, nick: string): Member | undefined {
  return [...room.members.values()].find((m) =>
    nicknamesEqual(m.nickname, nick),
  );
}

function clearBomb(room: GameRoom) {
  if (room.bombTimer) {
    clearTimeout(room.bombTimer);
    room.bombTimer = undefined;
  }
  room.bomb = undefined;
}

function scheduleBombExplode(
  io: Server,
  rooms: Map<string, GameRoom>,
  code: string,
) {
  const room = rooms.get(code);
  if (!room?.bomb) return;
  if (room.bombTimer) clearTimeout(room.bombTimer);
  const delay = Math.max(0, room.bomb.endsAt - Date.now());
  room.bombTimer = setTimeout(() => {
    const r = rooms.get(code);
    if (!r?.bomb) return;
    const payload: BombExplodePayload = {
      holderMemberId: r.bomb.holderMemberId,
      holderNickname: r.bomb.holderNickname,
      at: Date.now(),
    };
    clearBomb(r);
    io.to(code).emit(SocketEvents.BombExplode, payload);
  }, delay);
}

export function attachMiniGames(
  io: Server,
  rooms: Map<string, GameRoom>,
  getRoomCode: (socketId: string) => string | undefined,
) {
  const startBomb = (
    socket: Socket,
    payload: BombStartPayload,
    ack?: (r: BombAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room) {
      ack?.({ ok: false, error: "room not found" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    const member = memberId ? room.members.get(memberId) : undefined;
    if (!member) {
      ack?.({ ok: false, error: "not a member" });
      return;
    }
    if (room.bomb) {
      ack?.({ ok: false, error: "이미 폭탄이 있어요" });
      return;
    }
    const seconds = Math.max(5, Math.min(120, Number(payload?.seconds) || 30));
    const bomb: BombState = {
      endsAt: Date.now() + seconds * 1000,
      durationSec: seconds,
      holderMemberId: member.id,
      holderNickname: member.nickname,
      startedByMemberId: member.id,
    };
    room.bomb = bomb;
    scheduleBombExplode(io, rooms, code);
    io.to(code).emit(SocketEvents.BombSync, bomb);
    ack?.({ ok: true, bomb });
  };

  const passBomb = (
    socket: Socket,
    payload: BombPassPayload,
    ack?: (r: BombAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room?.bomb) {
      ack?.({ ok: false, error: "폭탄이 없어요" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    if (!memberId || memberId !== room.bomb.holderMemberId) {
      ack?.({ ok: false, error: "폭탄을 가진 사람만 넘길 수 있어요" });
      return;
    }
    const others = [...room.members.values()].filter(
      (m) => m.id !== room.bomb!.holderMemberId,
    );
    if (others.length === 0) {
      ack?.({ ok: false, error: "넘길 사람이 없어요" });
      return;
    }
    let next: Member | undefined;
    if (payload?.random || !payload?.targetNickname) {
      next = others[Math.floor(Math.random() * others.length)];
    } else {
      next = memberByNick(room, payload.targetNickname);
      if (!next || next.id === room.bomb.holderMemberId) {
        ack?.({ ok: false, error: "대상 닉네임을 확인하세요" });
        return;
      }
    }
    room.bomb = {
      ...room.bomb,
      holderMemberId: next.id,
      holderNickname: next.nickname,
    };
    io.to(code).emit(SocketEvents.BombSync, room.bomb);
    ack?.({ ok: true, bomb: room.bomb });
  };

  const openLadder = (
    socket: Socket,
    _payload?: unknown,
    ack?: (r: LadderAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room) {
      ack?.({ ok: false, error: "room not found" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    const member = memberId ? room.members.get(memberId) : undefined;
    if (!member) {
      ack?.({ ok: false, error: "not a member" });
      return;
    }
    if (room.ladder && room.ladder.phase !== "done") {
      ack?.({ ok: false, error: "이미 사다리가 진행 중이에요" });
      return;
    }
    const ladder: LadderState = {
      hostMemberId: member.id,
      hostNickname: member.nickname,
      names: [],
      memberIds: [],
      outcomes: [],
      rungs: [],
      phase: "setup",
    };
    room.ladder = ladder;
    io.to(code).emit(SocketEvents.LadderSync, ladder);
    ack?.({ ok: true, ladder });
  };

  const startLadder = (
    socket: Socket,
    payload: LadderStartPayload,
    ack?: (r: LadderAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room?.ladder || room.ladder.phase !== "setup") {
      ack?.({ ok: false, error: "사다리 설정 중이 아니에요" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    if (!memberId || memberId !== room.ladder.hostMemberId) {
      ack?.({ ok: false, error: "주최자만 시작할 수 있어요" });
      return;
    }
    const ids = Array.isArray(payload?.memberIds)
      ? payload.memberIds.map(String).filter(Boolean)
      : [];
    const participants: Member[] = [];
    for (const id of ids) {
      const m = room.members.get(id);
      if (m) participants.push(m);
    }
    if (participants.length < 2) {
      ack?.({ ok: false, error: "참가자는 2명 이상이어야 해요" });
      return;
    }
    const n = participants.length;
    let outcomes = Array.isArray(payload?.outcomes)
      ? payload.outcomes.map((o) => String(o ?? "").trim().slice(0, 16))
      : [];
    if (payload?.mode === "winlose" || outcomes.length !== n) {
      outcomes = participants.map((_, i) => (i === 0 ? "당첨" : "꽝"));
      // shuffle outcomes
      for (let i = outcomes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [outcomes[i], outcomes[j]] = [outcomes[j], outcomes[i]];
      }
    }
    const rungs = generateLadderRungs(n, Math.max(8, n * 2));
    const ends = resolveLadderPaths(n, rungs);
    const results = participants.map((p, startCol) => ({
      name: p.nickname,
      outcome: outcomes[ends[startCol]] ?? "?",
    }));
    const ladder: LadderState = {
      ...room.ladder,
      names: participants.map((p) => p.nickname),
      memberIds: participants.map((p) => p.id),
      outcomes,
      rungs,
      phase: "running",
      results,
    };
    room.ladder = ladder;
    io.to(code).emit(SocketEvents.LadderSync, ladder);
    // 연출 후 done
    setTimeout(() => {
      const r = rooms.get(code);
      if (!r?.ladder || r.ladder.phase !== "running") return;
      r.ladder = { ...r.ladder, phase: "done" };
      io.to(code).emit(SocketEvents.LadderSync, r.ladder);
    }, 5500 + n * 400);
    ack?.({ ok: true, ladder });
  };

  const cancelLadder = (
    socket: Socket,
    _payload?: unknown,
    ack?: (r: LadderAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room?.ladder) {
      ack?.({ ok: false, error: "사다리가 없어요" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    if (!memberId || memberId !== room.ladder.hostMemberId) {
      ack?.({ ok: false, error: "주최자만 취소할 수 있어요" });
      return;
    }
    room.ladder = undefined;
    io.to(code).emit(SocketEvents.LadderCancel, { at: Date.now() });
    ack?.({
      ok: true,
      ladder: {
        hostMemberId: memberId,
        hostNickname: "",
        names: [],
        memberIds: [],
        outcomes: [],
        rungs: [],
        phase: "done",
      },
    });
  };

  return {
    startBomb,
    passBomb,
    openLadder,
    startLadder,
    cancelLadder,
    clearBombOnRoomEmpty(code: string) {
      const room = rooms.get(code);
      if (room) clearBomb(room);
    },
    /** ChatSend에서 명령 가로채기. true면 채팅으로 보내지 않음 */
    handleChatCommand(
      socket: Socket,
      text: string,
    ): boolean {
      const t = text.trim();
      const start = t.match(/^\/(?:폭탄|bomb)\s+(\d+)\s*$/i);
      if (start) {
        startBomb(socket, { seconds: Number(start[1]) });
        return true;
      }
      const pass = t.match(
        /^\/(?:폭탄|bomb)\s+(?:넘겨|pass)(?:\s+(@?\S+))?\s*$/i,
      );
      if (pass) {
        passBomb(socket, {
          random: !pass[1],
          targetNickname: pass[1]
            ? pass[1].replace(/^@/, "").trim()
            : undefined,
        });
        return true;
      }
      if (/^\/(?:사다리|ladder)\s*$/i.test(t)) {
        openLadder(socket);
        return true;
      }
      return false;
    },
  };
}

export function freshRoomId() {
  return nanoid(8);
}
