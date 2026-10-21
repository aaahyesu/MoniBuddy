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
  type RouletteAck,
  type RouletteSpinPayload,
  type RouletteState,
  SocketEvents,
  ROULETTE_MAX_SLOTS,
  ROULETTE_MIN_SLOTS,
  generateLadderRungs,
  nicknamesEqual,
  resolveLadderPaths,
  shuffleInPlace,
} from "@monibuddy/shared";

export type GameRoom = {
  code: string;
  members: Map<string, Member>;
  socketToMember: Map<string, string>;
  bomb?: BombState;
  bombTimer?: ReturnType<typeof setTimeout>;
  ladder?: LadderState;
  roulette?: RouletteState;
  rouletteTimer?: ReturnType<typeof setTimeout>;
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
      at: r.bomb.endsAt,
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
    const seconds = payload?.random
      ? 5 + Math.floor(Math.random() * 116) // 5~120
      : Math.max(5, Math.min(120, Number(payload?.seconds) || 30));
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
    if (participants.length < 1) {
      ack?.({ ok: false, error: "참가자를 골라 주세요" });
      return;
    }
    const n = participants.length;
    let outcomes = Array.isArray(payload?.outcomes)
      ? payload.outcomes.map((o) => String(o ?? "").trim().slice(0, 16))
      : [];
    if (payload?.mode === "winlose" || outcomes.length !== n) {
      outcomes = participants.map((_, i) => (i === 0 ? "당첨" : "꽝"));
    }
    // 결과 칸은 항상 섞음 — 누가 무엇을 받을지는 사다리+셔플로만 결정
    shuffleInPlace(outcomes);
    // 행을 넉넉히 — 가로줄 최소 5개 확보에 유리
    const rowCount = Math.min(14, Math.max(8, n * 2 + 2));
    const rungs = generateLadderRungs(n, rowCount);
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
    // 클라이언트 경로 연출 시간과 맞춤 (행↑·가로 이동 포함)
    const animMs = n * (rowCount * 360 + 900) + 1600;
    setTimeout(() => {
      const r = rooms.get(code);
      if (!r?.ladder || r.ladder.phase !== "running") return;
      r.ladder = { ...r.ladder, phase: "done" };
      io.to(code).emit(SocketEvents.LadderSync, r.ladder);
    }, animMs);
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

  const openRoulette = (
    socket: Socket,
    _payload?: unknown,
    ack?: (r: RouletteAck) => void,
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
    if (room.roulette && room.roulette.phase !== "done") {
      ack?.({ ok: false, error: "이미 룰렛이 진행 중이에요" });
      return;
    }
    if (room.rouletteTimer) {
      clearTimeout(room.rouletteTimer);
      room.rouletteTimer = undefined;
    }
    const roulette: RouletteState = {
      hostMemberId: member.id,
      hostNickname: member.nickname,
      slots: [],
      winnerIndex: 0,
      stopAngle: 0,
      phase: "setup",
    };
    room.roulette = roulette;
    io.to(code).emit(SocketEvents.RouletteSync, roulette);
    ack?.({ ok: true, roulette });
  };

  const spinRoulette = (
    socket: Socket,
    payload: RouletteSpinPayload,
    ack?: (r: RouletteAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room?.roulette || room.roulette.phase !== "setup") {
      ack?.({ ok: false, error: "룰렛 설정 중이 아니에요" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    if (!memberId || memberId !== room.roulette.hostMemberId) {
      ack?.({ ok: false, error: "주최자만 돌릴 수 있어요" });
      return;
    }
    const raw = Array.isArray(payload?.slots) ? payload.slots : [];
    const slots = raw
      .map((s, i) => String(s ?? "").trim().slice(0, 16) || `칸 ${i + 1}`)
      .slice(0, ROULETTE_MAX_SLOTS);
    if (slots.length < ROULETTE_MIN_SLOTS) {
      ack?.({ ok: false, error: "칸은 2개 이상이어야 해요" });
      return;
    }
    const winnerIndex = Math.floor(Math.random() * slots.length);
    const slice = 360 / slots.length;
    const center = (winnerIndex + 0.5) * slice;
    const stopAngle = 360 * 5 + (360 - center);
    const roulette: RouletteState = {
      ...room.roulette,
      slots,
      winnerIndex,
      stopAngle,
      phase: "spinning",
    };
    room.roulette = roulette;
    io.to(code).emit(SocketEvents.RouletteSync, roulette);
    if (room.rouletteTimer) clearTimeout(room.rouletteTimer);
    room.rouletteTimer = setTimeout(() => {
      const r = rooms.get(code);
      if (!r?.roulette || r.roulette.phase !== "spinning") return;
      r.roulette = { ...r.roulette, phase: "done" };
      io.to(code).emit(SocketEvents.RouletteSync, r.roulette);
    }, 4400);
    ack?.({ ok: true, roulette });
  };

  const cancelRoulette = (
    socket: Socket,
    _payload?: unknown,
    ack?: (r: RouletteAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room?.roulette) {
      ack?.({ ok: false, error: "룰렛이 없어요" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    if (!memberId || memberId !== room.roulette.hostMemberId) {
      ack?.({ ok: false, error: "주최자만 취소할 수 있어요" });
      return;
    }
    if (room.rouletteTimer) {
      clearTimeout(room.rouletteTimer);
      room.rouletteTimer = undefined;
    }
    room.roulette = undefined;
    io.to(code).emit(SocketEvents.RouletteCancel, { at: Date.now() });
    ack?.({
      ok: true,
      roulette: {
        hostMemberId: memberId,
        hostNickname: "",
        slots: [],
        winnerIndex: 0,
        stopAngle: 0,
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
    openRoulette,
    spinRoulette,
    cancelRoulette,
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
      const startRandom = t.match(/^\/(?:폭탄|bomb)\s+(?:랜덤|random)\s*$/i);
      if (startRandom) {
        startBomb(socket, { random: true });
        return true;
      }
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
      if (/^\/(?:룰렛|roulette)\s*$/i.test(t)) {
        openRoulette(socket);
        return true;
      }
      return false;
    },
  };
}

export function freshRoomId() {
  return nanoid(8);
}
