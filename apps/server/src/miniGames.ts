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
  type SketchAck,
  type SketchOpenPayload,
  type SketchStartPayload,
  type SketchScore,
  type SketchState,
  type SketchStroke,
  type SketchStrokePayload,
  type SketchVote,
  type SketchVotePayload,
  SKETCH_CATEGORIES,
  SKETCH_DEFAULT_ROUNDS,
  SKETCH_MAX_ROUNDS,
  SKETCH_MIN_ROUNDS,
  SKETCH_MIN_YES,
  SKETCH_REVEAL_MS,
  SKETCH_ROUND_MS,
  SKETCH_VOTE_MS,
  SocketEvents,
  ROULETTE_MAX_SLOTS,
  ROULETTE_MIN_SLOTS,
  generateLadderRungs,
  nicknamesEqual,
  normalizeSketchGuess,
  resolveLadderPaths,
  shuffleInPlace,
  sketchCategoryById,
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
  sketch?: SketchState;
  sketchRoundTimer?: ReturnType<typeof setTimeout>;
  sketchRevealTimer?: ReturnType<typeof setTimeout>;
  sketchVoteTimer?: ReturnType<typeof setTimeout>;
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

  const clearSketchTimers = (room: GameRoom) => {
    if (room.sketchRoundTimer) {
      clearTimeout(room.sketchRoundTimer);
      room.sketchRoundTimer = undefined;
    }
    if (room.sketchRevealTimer) {
      clearTimeout(room.sketchRevealTimer);
      room.sketchRevealTimer = undefined;
    }
    if (room.sketchVoteTimer) {
      clearTimeout(room.sketchVoteTimer);
      room.sketchVoteTimer = undefined;
    }
  };

  /** 반대만 제외. 투표 안 한 방 멤버도 참가로 넣음(출제자 로테이션·정답 맞춤) */
  const finalizeSketchPlayers = (room: GameRoom, sketch: SketchState): string[] => {
    const noIds = new Set(
      sketch.votes.filter((v) => v.vote === "no").map((v) => v.memberId),
    );
    const fromRoom = [...room.members.keys()].filter((id) => !noIds.has(id));
    if (fromRoom.length > 0) return fromRoom;
    return sketch.playerIds.filter(Boolean);
  };

  const initSketchScores = (
    room: GameRoom,
    playerIds: string[],
    prev?: SketchScore[],
  ): SketchScore[] => {
    const prevMap = new Map((prev ?? []).map((s) => [s.memberId, s.score]));
    return playerIds.map((id) => ({
      memberId: id,
      nickname: room.members.get(id)?.nickname ?? "참가자",
      score: prevMap.get(id) ?? 0,
    }));
  };

  const bumpSketchScore = (
    scores: SketchScore[],
    memberId: string,
    nickname: string,
  ): SketchScore[] => {
    const next = scores.map((s) =>
      s.memberId === memberId
        ? { ...s, nickname, score: s.score + 1 }
        : s,
    );
    if (!next.some((s) => s.memberId === memberId)) {
      next.push({ memberId, nickname, score: 1 });
    }
    return next;
  };

  const autoStartSketch = (code: string) => {
    const room = rooms.get(code);
    if (!room?.sketch || room.sketch.phase !== "voting") return;
    if (room.sketchVoteTimer) {
      clearTimeout(room.sketchVoteTimer);
      room.sketchVoteTimer = undefined;
    }
    const playerIds = finalizeSketchPlayers(room, room.sketch);
    if (playerIds.length < SKETCH_MIN_YES) {
      room.sketch = undefined;
      io.to(code).emit(SocketEvents.SketchCancel, { at: Date.now() });
      return;
    }
    const categoryId = room.sketch.categoryId ?? "animal";
    const base: SketchState = {
      ...room.sketch,
      playerIds,
      scores: initSketchScores(room, playerIds, room.sketch.scores),
      categoryId,
      roundIndex: 1,
      drawnMemberIds: [],
      voteEndsAt: null,
    };
    beginSketchRound(code, base);
  };

  const emitSketch = (code: string, sketch: SketchState) => {
    io.to(code).emit(SocketEvents.SketchSync, sketch);
  };

  const pickDrawerAndTopic = (
    room: GameRoom,
    sketch: SketchState,
  ): Pick<
    SketchState,
    "drawerMemberId" | "drawerNickname" | "topic" | "drawnMemberIds"
  > | null => {
    const players = sketch.playerIds.filter((id) => room.members.has(id));
    if (players.length < SKETCH_MIN_YES) return null;
    let pool = players.filter((id) => !sketch.drawnMemberIds.includes(id));
    let drawnMemberIds = [...sketch.drawnMemberIds];
    if (pool.length === 0) {
      // 한 바퀴 돌면 직전 출제자는 빼고 다시 섞음(2명 이상일 때 연속 방지)
      drawnMemberIds = [];
      pool =
        players.length >= 2 && sketch.drawerMemberId
          ? players.filter((id) => id !== sketch.drawerMemberId)
          : [...players];
      if (pool.length === 0) pool = [...players];
    }
    const drawerMemberId = pool[Math.floor(Math.random() * pool.length)]!;
    drawnMemberIds = [...drawnMemberIds, drawerMemberId];
    const cat =
      sketchCategoryById(sketch.categoryId) ?? SKETCH_CATEGORIES[0]!;
    const topic = cat.topics[Math.floor(Math.random() * cat.topics.length)]!;
    const nick =
      room.members.get(drawerMemberId)?.nickname ??
      sketch.votes.find((v) => v.memberId === drawerMemberId)?.nickname ??
      "출제자";
    return {
      drawerMemberId,
      drawerNickname: nick,
      topic,
      drawnMemberIds,
    };
  };

  const scheduleSketchTimeout = (code: string) => {
    const room = rooms.get(code);
    if (!room?.sketch) return;
    if (room.sketchRoundTimer) clearTimeout(room.sketchRoundTimer);
    const endsAt = room.sketch.endsAt ?? Date.now() + SKETCH_ROUND_MS;
    const delay = Math.max(0, endsAt - Date.now());
    room.sketchRoundTimer = setTimeout(() => {
      const r = rooms.get(code);
      if (!r?.sketch || r.sketch.phase !== "drawing") return;
      finishSketchRound(code, "timeout");
    }, delay);
  };

  const beginSketchRound = (code: string, sketch: SketchState): SketchState | null => {
    const room = rooms.get(code);
    if (!room) return null;
    const picked = pickDrawerAndTopic(room, sketch);
    if (!picked) return null;
    const next: SketchState = {
      ...sketch,
      ...picked,
      phase: "drawing",
      strokes: [],
      endsAt: Date.now() + SKETCH_ROUND_MS,
      voteEndsAt: null,
      winnerMemberId: null,
      winnerNickname: null,
      endReason: null,
    };
    room.sketch = next;
    scheduleSketchTimeout(code);
    emitSketch(code, next);
    return next;
  };

  const advanceAfterReveal = (code: string) => {
    const room = rooms.get(code);
    if (!room?.sketch || room.sketch.phase !== "roundReveal") return;
    if (room.sketchRevealTimer) {
      clearTimeout(room.sketchRevealTimer);
      room.sketchRevealTimer = undefined;
    }
    const cur = room.sketch;
    if (cur.roundIndex >= cur.totalRounds) {
      const done: SketchState = { ...cur, phase: "done", endsAt: null };
      room.sketch = done;
      emitSketch(code, done);
      return;
    }
    const nextRound: SketchState = {
      ...cur,
      roundIndex: cur.roundIndex + 1,
    };
    beginSketchRound(code, nextRound);
  };

  const finishSketchRound = (
    code: string,
    reason: "guess" | "reveal" | "timeout",
    winner?: { memberId: string; nickname: string },
  ) => {
    const room = rooms.get(code);
    if (!room?.sketch || room.sketch.phase !== "drawing") return;
    if (room.sketchRoundTimer) {
      clearTimeout(room.sketchRoundTimer);
      room.sketchRoundTimer = undefined;
    }
    const scores =
      reason === "guess" && winner
        ? bumpSketchScore(
            room.sketch.scores ?? [],
            winner.memberId,
            winner.nickname,
          )
        : (room.sketch.scores ?? []);
    const revealed: SketchState = {
      ...room.sketch,
      scores,
      phase: "roundReveal",
      endsAt: null,
      endReason: reason,
      winnerMemberId: winner?.memberId ?? null,
      winnerNickname: winner?.nickname ?? null,
    };
    room.sketch = revealed;
    emitSketch(code, revealed);
    if (room.sketchRevealTimer) clearTimeout(room.sketchRevealTimer);
    room.sketchRevealTimer = setTimeout(() => {
      advanceAfterReveal(code);
    }, SKETCH_REVEAL_MS);
  };

  const openSketch = (
    socket: Socket,
    payload?: SketchOpenPayload,
    ack?: (r: SketchAck) => void,
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
    if (room.sketch && room.sketch.phase !== "done") {
      ack?.({ ok: false, error: "이미 스케치 게임이 진행 중이에요" });
      return;
    }
    clearSketchTimers(room);
    const rawRounds = Number(payload?.rounds ?? SKETCH_DEFAULT_ROUNDS);
    const totalRounds = Math.max(
      SKETCH_MIN_ROUNDS,
      Math.min(
        SKETCH_MAX_ROUNDS,
        Number.isFinite(rawRounds) ? Math.floor(rawRounds) : SKETCH_DEFAULT_ROUNDS,
      ),
    );
    const voteEndsAt = Date.now() + SKETCH_VOTE_MS;
    const sketch: SketchState = {
      hostMemberId: member.id,
      hostNickname: member.nickname,
      totalRounds,
      roundIndex: 0,
      phase: "voting",
      categoryId: "animal",
      votes: [
        { memberId: member.id, nickname: member.nickname, vote: "yes" },
      ],
      playerIds: [member.id],
      drawerMemberId: null,
      drawerNickname: null,
      topic: null,
      strokes: [],
      endsAt: null,
      voteEndsAt,
      winnerMemberId: null,
      winnerNickname: null,
      endReason: null,
      drawnMemberIds: [],
      scores: [{ memberId: member.id, nickname: member.nickname, score: 0 }],
    };
    room.sketch = sketch;
    emitSketch(code, sketch);
    if (room.sketchVoteTimer) clearTimeout(room.sketchVoteTimer);
    room.sketchVoteTimer = setTimeout(() => {
      autoStartSketch(code);
    }, SKETCH_VOTE_MS);
    ack?.({ ok: true, sketch });
  };

  const voteSketch = (
    socket: Socket,
    payload: SketchVotePayload,
    ack?: (r: SketchAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room?.sketch || room.sketch.phase !== "voting") {
      ack?.({ ok: false, error: "투표 중이 아니에요" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    const member = memberId ? room.members.get(memberId) : undefined;
    if (!member) {
      ack?.({ ok: false, error: "not a member" });
      return;
    }
    const vote: SketchVote = payload?.vote === "no" ? "no" : "yes";
    const others = room.sketch.votes.filter((v) => v.memberId !== member.id);
    const votes: SketchState["votes"] = [
      ...others,
      { memberId: member.id, nickname: member.nickname, vote },
    ];
    const playerIds = votes.filter((v) => v.vote === "yes").map((v) => v.memberId);
    const sketch: SketchState = { ...room.sketch, votes, playerIds };
    room.sketch = sketch;
    emitSketch(code, sketch);
    ack?.({ ok: true, sketch });
  };

  const joinSketch = (
    socket: Socket,
    _payload?: unknown,
    ack?: (r: SketchAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room?.sketch || room.sketch.phase === "done") {
      ack?.({ ok: false, error: "진행 중인 스케치가 없어요" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    const member = memberId ? room.members.get(memberId) : undefined;
    if (!member) {
      ack?.({ ok: false, error: "not a member" });
      return;
    }
    if (room.sketch.playerIds.includes(member.id)) {
      ack?.({ ok: true, sketch: room.sketch });
      return;
    }
    const others = room.sketch.votes.filter((v) => v.memberId !== member.id);
    const votes: SketchState["votes"] = [
      ...others,
      { memberId: member.id, nickname: member.nickname, vote: "yes" },
    ];
    const playerIds = [...room.sketch.playerIds, member.id];
    const scores = initSketchScores(room, playerIds, room.sketch.scores);
    const sketch: SketchState = { ...room.sketch, votes, playerIds, scores };
    room.sketch = sketch;
    emitSketch(code, sketch);
    ack?.({ ok: true, sketch });
  };

  const startSketch = (
    socket: Socket,
    payload: SketchStartPayload,
    ack?: (r: SketchAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room?.sketch || room.sketch.phase !== "voting") {
      ack?.({ ok: false, error: "투표 중이 아니에요" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    if (!memberId || memberId !== room.sketch.hostMemberId) {
      ack?.({ ok: false, error: "주최자만 시작할 수 있어요" });
      return;
    }
    const playerIds = finalizeSketchPlayers(room, room.sketch);
    if (playerIds.length < SKETCH_MIN_YES) {
      ack?.({ ok: false, error: `참가자가 ${SKETCH_MIN_YES}명 이상 필요해요` });
      return;
    }
    const categoryId =
      sketchCategoryById(payload?.categoryId)?.id ?? room.sketch.categoryId ?? "animal";
    if (room.sketchVoteTimer) {
      clearTimeout(room.sketchVoteTimer);
      room.sketchVoteTimer = undefined;
    }
    const base: SketchState = {
      ...room.sketch,
      playerIds,
      scores: initSketchScores(room, playerIds, room.sketch.scores),
      categoryId,
      roundIndex: 1,
      drawnMemberIds: [],
      voteEndsAt: null,
    };
    const started = beginSketchRound(code, base);
    if (!started) {
      ack?.({ ok: false, error: "라운드를 시작할 수 없어요" });
      return;
    }
    ack?.({ ok: true, sketch: started });
  };

  const strokeSketch = (
    socket: Socket,
    payload: SketchStrokePayload,
    ack?: (r: SketchAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room?.sketch || room.sketch.phase !== "drawing") {
      ack?.({ ok: false, error: "그리는 중이 아니에요" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    if (!memberId || memberId !== room.sketch.drawerMemberId) {
      ack?.({ ok: false, error: "출제자만 그릴 수 있어요" });
      return;
    }
    const raw = payload?.stroke;
    if (!raw?.id || !Array.isArray(raw.points) || raw.points.length < 1) {
      ack?.({ ok: false, error: "잘못된 선이에요" });
      return;
    }
    const points = raw.points
      .slice(0, 240)
      .map((p) => ({
        x: Math.max(0, Math.min(1, Number(p?.x) || 0)),
        y: Math.max(0, Math.min(1, Number(p?.y) || 0)),
      }));
    const stroke: SketchStroke = {
      id: String(raw.id).slice(0, 40),
      color: String(raw.color ?? "#111111").slice(0, 20),
      width: Math.max(1, Math.min(16, Number(raw.width) || 3)),
      points,
    };
    const strokes = [...room.sketch.strokes, stroke].slice(-200);
    const sketch: SketchState = { ...room.sketch, strokes };
    room.sketch = sketch;
    emitSketch(code, sketch);
    ack?.({ ok: true, sketch });
  };

  const clearSketch = (
    socket: Socket,
    _payload?: unknown,
    ack?: (r: SketchAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room?.sketch || room.sketch.phase !== "drawing") {
      ack?.({ ok: false, error: "그리는 중이 아니에요" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    if (!memberId || memberId !== room.sketch.drawerMemberId) {
      ack?.({ ok: false, error: "출제자만 지울 수 있어요" });
      return;
    }
    const sketch: SketchState = { ...room.sketch, strokes: [] };
    room.sketch = sketch;
    emitSketch(code, sketch);
    ack?.({ ok: true, sketch });
  };

  const revealSketch = (
    socket: Socket,
    _payload?: unknown,
    ack?: (r: SketchAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room?.sketch || room.sketch.phase !== "drawing") {
      ack?.({ ok: false, error: "그리는 중이 아니에요" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    if (
      !memberId ||
      (memberId !== room.sketch.drawerMemberId &&
        memberId !== room.sketch.hostMemberId)
    ) {
      ack?.({ ok: false, error: "출제자만 공개할 수 있어요" });
      return;
    }
    finishSketchRound(code, "reveal");
    ack?.({ ok: true, sketch: room.sketch! });
  };

  const cancelSketch = (
    socket: Socket,
    _payload?: unknown,
    ack?: (r: SketchAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room?.sketch) {
      ack?.({ ok: false, error: "스케치 게임이 없어요" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    if (!memberId || memberId !== room.sketch.hostMemberId) {
      ack?.({ ok: false, error: "주최자만 취소할 수 있어요" });
      return;
    }
    clearSketchTimers(room);
    room.sketch = undefined;
    io.to(code).emit(SocketEvents.SketchCancel, { at: Date.now() });
    ack?.({
      ok: true,
      sketch: {
        hostMemberId: memberId,
        hostNickname: "",
        totalRounds: 0,
        roundIndex: 0,
        phase: "done",
        categoryId: null,
        votes: [],
        playerIds: [],
        drawerMemberId: null,
        drawerNickname: null,
        topic: null,
        strokes: [],
        endsAt: null,
        voteEndsAt: null,
        winnerMemberId: null,
        winnerNickname: null,
        endReason: null,
        drawnMemberIds: [],
        scores: [],
      },
    });
  };

  /** 채팅 전송 후 호출. 정답이면 라운드 종료 (출제자 제외, 방 멤버면 가능) */
  const trySketchGuess = (socket: Socket, text: string): boolean => {
    const code = getRoomCode(socket.id);
    if (!code) return false;
    const room = rooms.get(code);
    if (!room?.sketch || room.sketch.phase !== "drawing" || !room.sketch.topic) {
      return false;
    }
    const memberId = room.socketToMember.get(socket.id);
    const member = memberId ? room.members.get(memberId) : undefined;
    if (!member) return false;
    if (member.id === room.sketch.drawerMemberId) return false;
    const guess = normalizeSketchGuess(text);
    const answer = normalizeSketchGuess(room.sketch.topic);
    if (!guess || guess !== answer) return false;
    // 맞힌 사람은 다음 라운드 출제 풀·점수판에도 넣음
    if (!room.sketch.playerIds.includes(member.id)) {
      const playerIds = [...room.sketch.playerIds, member.id];
      room.sketch = {
        ...room.sketch,
        playerIds,
        scores: initSketchScores(room, playerIds, room.sketch.scores),
      };
    }
    finishSketchRound(code, "guess", {
      memberId: member.id,
      nickname: member.nickname,
    });
    return true;
  };

  const setSketchCategory = (
    socket: Socket,
    payload: SketchStartPayload,
    ack?: (r: SketchAck) => void,
  ) => {
    const code = getRoomCode(socket.id);
    if (!code) {
      ack?.({ ok: false, error: "not in room" });
      return;
    }
    const room = rooms.get(code);
    if (!room?.sketch || room.sketch.phase !== "voting") {
      ack?.({ ok: false, error: "투표 중이 아니에요" });
      return;
    }
    const memberId = room.socketToMember.get(socket.id);
    if (!memberId || memberId !== room.sketch.hostMemberId) {
      ack?.({ ok: false, error: "주최자만 고를 수 있어요" });
      return;
    }
    const categoryId = sketchCategoryById(payload?.categoryId)?.id;
    if (!categoryId) {
      ack?.({ ok: false, error: "카테고리가 없어요" });
      return;
    }
    const sketch: SketchState = { ...room.sketch, categoryId };
    room.sketch = sketch;
    emitSketch(code, sketch);
    ack?.({ ok: true, sketch });
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
    openSketch,
    voteSketch,
    joinSketch,
    startSketch,
    setSketchCategory,
    strokeSketch,
    clearSketch,
    revealSketch,
    cancelSketch,
    trySketchGuess,
    clearBombOnRoomEmpty(code: string) {
      const room = rooms.get(code);
      if (room) {
        clearBomb(room);
        clearSketchTimers(room);
        room.sketch = undefined;
      }
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
      if (/^\/(?:스케치|sketch)\s+(?:참여|join)\s*$/i.test(t)) {
        joinSketch(socket);
        return true;
      }
      const sketchOpen = t.match(/^\/(?:스케치|sketch)(?:\s+(\d+))?\s*$/i);
      if (sketchOpen) {
        const n = sketchOpen[1] ? Number(sketchOpen[1]) : SKETCH_DEFAULT_ROUNDS;
        openSketch(socket, { rounds: n });
        return true;
      }
      return false;
    },
  };
}

export function freshRoomId() {
  return nanoid(8);
}
