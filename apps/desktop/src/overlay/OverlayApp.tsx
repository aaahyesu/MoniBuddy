import { useEffect, useMemo, useRef, useState } from "react";
import {
  BUBBLE_TTL_MS,
  BUDDY_MIN_DISPLAY_SIZE,
  MAX_CHAT_LENGTH,
  type ChatMessage,
  type Character,
  type Member,
  defaultCharState,
} from "@monibuddy/shared";
import { resolveDefaultServerUrl } from "../lib/serverUrl";
import { CharacterView } from "../components/CharacterView";
import {
  advanceProgress,
  FIXED_INSET,
  nearestProgressOnBorder,
  PATH_MODE_OPTIONS,
  type PathMode,
  pointOnBorder,
} from "../lib/borderPath";
import { loadBuddyManifest, type BuddyDef } from "../lib/defaultBuddies";
import { readProfile, writeStatusMessage } from "../hooks/useLocalProfile";
import { invokeSafe, isTauri } from "../lib/tauri";

type Bubble = { memberId: string; text: string; until: number; id: string };

type MoveSettings = {
  speed: number;
  walking: boolean;
  pathMode: PathMode;
};

const ROOM_KEY = "monibuddy.activeRoom.v1";
const RUNTIME_KEY = "monibuddy.runtime.v1";
const PENDING_CHAT_KEY = "monibuddy.pendingChat.v1";
const PENDING_ROOM_KEY = "monibuddy.pendingRoom.v1";
const MOVE_KEY = "monibuddy.moveSettings.v1";
const HIT_PAD = 36;
const DEFAULT_MOVE: MoveSettings = {
  speed: 0.011,
  walking: true,
  pathMode: "all",
};

const PATH_MODES = new Set<PathMode>(["all", "top", "bottom", "left", "right"]);

type Runtime = {
  members: Member[];
  messages: ChatMessage[];
  memberId: string | null;
  roomCode: string | null;
  serverUrl: string;
  nickname: string;
  character: Character;
  statusMessage?: string;
};

function readRuntime(): Runtime | null {
  try {
    const raw = localStorage.getItem(RUNTIME_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Runtime;
  } catch {
    return null;
  }
}

function readActiveRoomCode(rt: Runtime | null): string | null {
  // 설정 창 runtime이 권위. ROOM_KEY만 남은 stale 값으로 유령 멤버를 그리지 않음
  if (rt?.roomCode) return rt.roomCode;
  return null;
}

function readMoveSettings(): MoveSettings {
  try {
    const raw = localStorage.getItem(MOVE_KEY);
    if (!raw) return DEFAULT_MOVE;
    const parsed = JSON.parse(raw) as Partial<MoveSettings> & { inset?: number };
    const pathMode = PATH_MODES.has(parsed.pathMode as PathMode)
      ? (parsed.pathMode as PathMode)
      : DEFAULT_MOVE.pathMode;
    return {
      speed: Math.min(0.05, Math.max(0.003, parsed.speed ?? DEFAULT_MOVE.speed)),
      walking: parsed.walking ?? true,
      pathMode,
    };
  } catch {
    return DEFAULT_MOVE;
  }
}

function writeMoveSettings(next: MoveSettings) {
  localStorage.setItem(MOVE_KEY, JSON.stringify(next));
}

function isSelfMember(m: Member, selfId: string) {
  // 방에 들어간 뒤에는 실제 memberId만 본인으로 본다 (local 잔상과 중복 방지)
  if (selfId && selfId !== "local") return m.id === selfId;
  return m.id === "local";
}

function normalizeOverlayMembers(
  members: Member[],
  selfId: string,
  inRoom: boolean,
): Member[] {
  const filtered =
    inRoom && selfId !== "local"
      ? members.filter((m) => m.id !== "local")
      : members;
  const byId = new Map<string, Member>();
  for (const m of filtered) byId.set(m.id, m);
  return [...byId.values()];
}

export function OverlayApp() {
  useEffect(() => {
    document.body.classList.add("overlay-body");
    document.body.classList.remove("settings-body");
    void invokeSafe("set_click_through", { enabled: true });
  }, []);

  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [members, setMembers] = useState<Member[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [serverUrl, setServerUrl] = useState(resolveDefaultServerUrl);
  const [buddyDefs, setBuddyDefs] = useState<BuddyDef[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [chat, setChat] = useState("");
  const [inRoom, setInRoom] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [move, setMove] = useState<MoveSettings>(() => readMoveSettings());
  const [dragging, setDragging] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [composeMode, setComposeMode] = useState<"chat" | "status">("chat");
  const [repositionMode, setRepositionMode] = useState(false);

  const chatInputRef = useRef<HTMLInputElement>(null);
  const selfIdRef = useRef<string>("local");
  const seenChat = useRef(new Set<string>());
  const lastTs = useRef(performance.now());
  const actorsRef = useRef<Array<{ x: number; y: number; isSelf: boolean }>>([]);
  const panelOpenRef = useRef(false);
  const draggingRef = useRef(false);
  const repositionRef = useRef(false);
  const sizeRef = useRef(size);
  const moveRef = useRef(move);
  const membersRef = useRef(members);
  const dragStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  panelOpenRef.current = panelOpen;
  draggingRef.current = dragging;
  repositionRef.current = repositionMode;
  sizeRef.current = size;
  moveRef.current = move;
  membersRef.current = members;

  const setDraggingNow = (v: boolean) => {
    draggingRef.current = v;
    setDragging(v);
  };

  const patchMove = (partial: Partial<MoveSettings>) => {
    setMove((prev) => {
      const next = { ...prev, ...partial };
      writeMoveSettings(next);
      moveRef.current = next;
      return next;
    });
    // 피어에 바로 반영되도록 본인 CharState에도 심어 둠
    setMembers((prev) =>
      prev.map((m) => {
        if (!isSelfMember(m, selfIdRef.current) && m.id !== "local") return m;
        return {
          ...m,
          state: {
            ...m.state,
            ...(partial.speed != null ? { speed: partial.speed } : {}),
            ...(partial.pathMode != null ? { pathMode: partial.pathMode } : {}),
            ...(partial.walking != null
              ? { motion: partial.walking ? "walk" : "idle" }
              : {}),
          },
        };
      }),
    );
  };

  useEffect(() => {
    void loadBuddyManifest().then((m) => setBuddyDefs(m.buddies));
  }, []);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const apply = () => {
      if (draggingRef.current) return;
      const profile = readProfile();
      const rt = readRuntime();
      const roomCode = readActiveRoomCode(rt);
      setServerUrl(rt?.serverUrl || profile.serverUrl || resolveDefaultServerUrl());
      selfIdRef.current = rt?.memberId || "local";
      setInRoom(Boolean(roomCode));
      setRoomCode(roomCode);
      setStatusMessage((profile.statusMessage || rt?.statusMessage || "").trim());

      if (rt?.roomCode && rt.members?.length) {
        const list = normalizeOverlayMembers(
          rt.members,
          selfIdRef.current,
          true,
        );
        setMembers((prev) => {
          const byId = new Map(prev.map((m) => [m.id, m]));
          return list.map((m) => {
            const old = byId.get(m.id);
            const self = isSelfMember(m, selfIdRef.current);
            // 설정 창에서 고른 캐릭터를 오버레이 본인에게 즉시 반영
            const synced = self
              ? {
                  ...m,
                  nickname: profile.nickname || m.nickname,
                  character: profile.character,
                  statusMessage: (profile.statusMessage || "").trim(),
                }
              : m;
            if (!old) return synced;
            return {
              ...synced,
              state: {
                ...synced.state,
                progress: old.state.progress,
                edge: old.state.edge,
                facing: old.state.facing,
                motion: self
                  ? moveRef.current.walking
                    ? "walk"
                    : "idle"
                  : synced.state.motion,
                // 본인 이동 설정은 로컬이 권위, 피어는 수신 state 유지
                speed: self ? moveRef.current.speed : synced.state.speed,
                pathMode: self ? moveRef.current.pathMode : synced.state.pathMode,
              },
            };
          });
        });
      } else {
        // 방 밖: 항상 본인 하나만
        setMembers((prev) => {
          const prevLocal = prev.find((m) => m.id === "local");
          return [
            {
              id: "local",
              nickname: profile.nickname,
              character: profile.character,
              state: {
                ...(prevLocal?.state ?? defaultCharState(0.12)),
                motion: moveRef.current.walking ? "walk" : "idle",
                speed: moveRef.current.speed,
                pathMode: moveRef.current.pathMode,
              },
              offset: 12,
              statusMessage: (profile.statusMessage || "").trim(),
            },
          ];
        });
      }

      for (const msg of rt?.messages ?? []) {
        if (seenChat.current.has(msg.id)) continue;
        seenChat.current.add(msg.id);
        setBubbles((prev) => [
          ...prev.filter(
            (b) =>
              b.until > Date.now() &&
              !(
                b.id.startsWith("local-") &&
                b.memberId === msg.memberId &&
                b.text === msg.text
              ),
          ),
          {
            memberId: msg.memberId,
            text: msg.text,
            until: Date.now() + BUBBLE_TTL_MS,
            id: msg.id,
          },
        ]);
      }
    };

    apply();
    const id = window.setInterval(apply, 350);
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === ROOM_KEY ||
        e.key === RUNTIME_KEY ||
        e.key === "monibuddy.profile.v1"
      ) {
        apply();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("monibuddy:profile", apply);
    window.addEventListener("monibuddy:room", apply);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("monibuddy:profile", apply);
      window.removeEventListener("monibuddy:room", apply);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTs.current) / 1000);
      lastTs.current = now;
      if (!draggingRef.current) {
        const { speed, walking, pathMode } = moveRef.current;
        setMembers((prev) =>
          prev.map((m) => {
            const self = isSelfMember(m, selfIdRef.current);
            if (self && !walking) {
              if (m.state.motion === "idle" && m.state.speed === speed && m.state.pathMode === pathMode) {
                return m;
              }
              return {
                ...m,
                state: { ...m.state, motion: "idle", speed, pathMode },
              };
            }
            if (m.state.motion !== "walk") {
              // 피어 idle이어도 speed/pathMode는 최신 수신값 유지
              return m;
            }
            const walkSpeed = self
              ? speed
              : typeof m.state.speed === "number"
                ? m.state.speed
                : speed * 0.9;
            const peerMode = m.state.pathMode;
            const mode: PathMode = self
              ? pathMode
              : peerMode && PATH_MODES.has(peerMode)
                ? peerMode
                : "all";
            const inset = self ? FIXED_INSET : 28 + m.offset;
            const progress = advanceProgress(m.state.progress, dt, walkSpeed);
            const pt = pointOnBorder(size.w, size.h, inset, progress, mode);
            return {
              ...m,
              state: {
                ...m.state,
                progress,
                edge: pt.edge,
                facing: pt.facing,
                ...(self ? { speed, pathMode } : {}),
              },
            };
          }),
        );
      }
      setBubbles((prev) => prev.filter((b) => b.until > Date.now()));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size.w, size.h]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const me =
        members.find((m) => m.id === selfIdRef.current) ||
        members.find((m) => m.id === "local");
      if (!me) return;
      localStorage.setItem(
        "monibuddy.selfState.v1",
        JSON.stringify({ state: me.state, at: Date.now() }),
      );
    }, 200);
    return () => window.clearInterval(id);
  }, [members]);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    const loop = async () => {
      while (alive) {
        try {
          const pos = await invokeSafe<[number, number]>("get_cursor_pos");
          if (!pos) {
            await new Promise((r) => setTimeout(r, 80));
            continue;
          }
          const [cx, cy] = pos;
          const { w, h } = sizeRef.current;
          const overSelf = actorsRef.current.some(
            (a) =>
              a.isSelf &&
              Math.abs(cx - a.x) <= HIT_PAD &&
              Math.abs(cy - a.y) <= HIT_PAD,
          );
          const overChat =
            panelOpenRef.current &&
            !repositionRef.current &&
            cy >= h - 300 &&
            Math.abs(cx - w / 2) <= 360;
          const overRepositionBar =
            repositionRef.current &&
            cy >= h - 90 &&
            Math.abs(cx - w / 2) <= 220;
          const capture =
            overSelf ||
            overChat ||
            overRepositionBar ||
            draggingRef.current ||
            (panelOpenRef.current && !repositionRef.current);
          await invokeSafe("set_click_through", { enabled: !capture });
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, 80));
      }
    };
    void loop();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!panelOpen || repositionMode) return;
    const t = window.setTimeout(() => chatInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [panelOpen, repositionMode]);

  const applySelfProgress = (progress: number) => {
    const { pathMode } = moveRef.current;
    const pt = pointOnBorder(size.w, size.h, FIXED_INSET, progress, pathMode);
    setMembers((prev) =>
      prev.map((m) => {
        if (!isSelfMember(m, selfIdRef.current)) return m;
        return {
          ...m,
          state: {
            ...m.state,
            progress,
            edge: pt.edge,
            facing: pt.facing,
            motion: "idle",
          },
        };
      }),
    );
  };

  const moveSelfToPoint = (x: number, y: number) => {
    const progress = nearestProgressOnBorder(
      size.w,
      size.h,
      FIXED_INSET,
      x,
      y,
      moveRef.current.pathMode,
    );
    applySelfProgress(progress);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!start.moved && dx * dx + dy * dy > 36) {
        start.moved = true;
        setDraggingNow(true);
        patchMove({ walking: false });
      }
      if (start.moved) moveSelfToPoint(e.clientX, e.clientY);
    };

    const onUp = () => {
      dragStartRef.current = null;
      setDraggingNow(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [size.w, size.h]);

  const startRepositionMode = () => {
    patchMove({ walking: false });
    setPlusOpen(false);
    setMoveOpen(false);
    setJoinOpen(false);
    setRepositionMode(true);
  };

  const endRepositionMode = (reopenMove = true) => {
    setRepositionMode(false);
    if (reopenMove) setMoveOpen(true);
  };

  const openPanel = () => {
    setPlusOpen(false);
    setMoveOpen(false);
    setJoinOpen(false);
    setJoinCode("");
    setComposeMode("chat");
    setRepositionMode(false);
    setPanelOpen(true);
  };

  const closePanel = () => {
    setPanelOpen(false);
    setPlusOpen(false);
    setMoveOpen(false);
    setJoinOpen(false);
    setJoinCode("");
    setComposeMode("chat");
    setRepositionMode(false);
    setChat("");
    void invokeSafe("set_click_through", { enabled: true });
  };

  const togglePanel = () => {
    if (panelOpenRef.current) closePanel();
    else openPanel();
  };

  const queueRoomAction = (
    action:
      | { action: "create" }
      | { action: "join"; code: string }
      | { action: "leave" },
  ) => {
    localStorage.setItem(
      PENDING_ROOM_KEY,
      JSON.stringify({ ...action, at: Date.now() }),
    );
    window.dispatchEvent(new Event("monibuddy:pendingRoom"));
    void invokeSafe("show_settings");
    closePanel();
  };

  const openBuddyTab = (tab: "character" | "quests") => {
    localStorage.setItem(
      "monibuddy.openBuddy.v1",
      JSON.stringify({ at: Date.now(), tab }),
    );
    window.dispatchEvent(new Event("monibuddy:openBuddy"));
    void invokeSafe("show_settings");
    closePanel();
  };

  const sendChat = () => {
    const text = chat.trim().slice(0, MAX_CHAT_LENGTH);
    if (composeMode === "status") {
      const next = writeStatusMessage(text);
      setStatusMessage(next);
      setChat("");
      setComposeMode("chat");
      setPlusOpen(false);
      setMoveOpen(false);
      return;
    }
    if (!text) return;

    const selfId = selfIdRef.current || "local";
    const optimisticId = `local-${Date.now()}`;
    setBubbles((prev) => [
      ...prev.filter((b) => b.until > Date.now()),
      {
        memberId: selfId,
        text,
        until: Date.now() + BUBBLE_TTL_MS,
        id: optimisticId,
      },
    ]);
    seenChat.current.add(optimisticId);

    localStorage.setItem(
      PENDING_CHAT_KEY,
      JSON.stringify({ text, at: Date.now() }),
    );
    window.dispatchEvent(new Event("monibuddy:pendingChat"));
    setChat("");
    setPlusOpen(false);
    setMoveOpen(false);
  };

  const actors = useMemo(() => {
    return members.map((m) => {
      const self = isSelfMember(m, selfIdRef.current);
      const inset = self ? FIXED_INSET : 28 + m.offset;
      const peerMode = m.state.pathMode;
      const mode: PathMode = self
        ? move.pathMode
        : peerMode && PATH_MODES.has(peerMode)
          ? peerMode
          : "all";
      const pt = pointOnBorder(size.w, size.h, inset, m.state.progress, mode);
      const bubble = bubbles.find((b) => b.memberId === m.id);
      return {
        member: m,
        x: pt.x,
        y: pt.y,
        facing: m.state.facing,
        bubble,
        isSelf: self,
      };
    });
  }, [members, size, bubbles, move.pathMode]);

  actorsRef.current = actors.map((a) => ({
    x: a.x,
    y: a.y,
    isSelf: a.isSelf,
  }));

  return (
    <div className="overlay-root">
      {actors.map(({ member, x, y, facing, bubble, isSelf }) => (
        <div
          key={member.id}
          className={`actor${isSelf ? " self" : ""}${isSelf && dragging ? " dragging" : ""}${isSelf && repositionMode ? " reposition" : ""}`}
          style={{ left: x, top: y, cursor: isSelf ? "grab" : undefined }}
          onPointerDown={(e) => {
            if (!isSelf) return;
            e.stopPropagation();
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            dragStartRef.current = { x: e.clientX, y: e.clientY, moved: false };
          }}
          onClick={(e) => {
            if (!isSelf) return;
            e.stopPropagation();
            if (dragStartRef.current?.moved || dragging) return;
            if (repositionMode) return;
            togglePanel();
          }}
          title={
            isSelf
              ? repositionMode
                ? "드래그해서 위치 이동"
                : "클릭: 채팅 열기/닫기 · 드래그: 위치 이동"
              : undefined
          }
        >
          {bubble && <div className="bubble">{bubble.text}</div>}
          {(() => {
            const statusText = (
              isSelf ? statusMessage : member.statusMessage || ""
            ).trim();
            if (!statusText) return null;
            return (
              <div className={`status-bubble${bubble ? " with-chat" : ""}`}>
                {statusText}
              </div>
            );
          })()}
          {isSelf && !bubble && !statusMessage && !panelOpen && (
            <div className="tap-hint">나</div>
          )}
          <CharacterView
            character={member.character}
            serverUrl={serverUrl}
            size={
              member.character.kind === "upload"
                ? member.character.displaySize
                : member.character.kind === "buddy"
                  ? Math.max(member.character.displaySize, BUDDY_MIN_DISPLAY_SIZE)
                  : 56
            }
            facing={facing}
            buddyDef={
              member.character.kind === "buddy"
                ? buddyDefs.find((b) => {
                    const buddy = member.character;
                    return buddy.kind === "buddy" && b.id === buddy.id;
                  })
                : undefined
            }
          />
        </div>
      ))}

      {panelOpen && !repositionMode && (
        <div
          className="composer-backdrop"
          onPointerDown={(e) => {
            e.preventDefault();
            closePanel();
          }}
        />
      )}

      {panelOpen && repositionMode && (
        <div
          className="reposition-bar"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span>캐릭터를 드래그해서 옮기세요</span>
          <button type="button" onClick={() => endRepositionMode(true)}>
            완료
          </button>
        </div>
      )}

      {panelOpen && !repositionMode && (
        <div
          className="cursor-composer"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {plusOpen && (
            <div className="composer-plus-menu">
              {!inRoom && !joinOpen && (
                <>
                  <button
                    type="button"
                    onClick={() => queueRoomAction({ action: "create" })}
                  >
                    방 만들기
                  </button>
                  <button
                    type="button"
                    onClick={() => setJoinOpen(true)}
                  >
                    방 입장하기
                  </button>
                </>
              )}
              {!inRoom && joinOpen && (
                <div className="plus-join">
                  <input
                    autoFocus
                    value={joinCode}
                    maxLength={6}
                    placeholder="초대코드"
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && joinCode.trim().length >= 4) {
                        queueRoomAction({
                          action: "join",
                          code: joinCode.trim(),
                        });
                      }
                      if (e.key === "Escape") {
                        setJoinOpen(false);
                        setJoinCode("");
                      }
                    }}
                  />
                  <div className="plus-join-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setJoinOpen(false);
                        setJoinCode("");
                      }}
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      disabled={joinCode.trim().length < 4}
                      onClick={() =>
                        queueRoomAction({
                          action: "join",
                          code: joinCode.trim(),
                        })
                      }
                    >
                      입장
                    </button>
                  </div>
                </div>
              )}
              {inRoom && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (roomCode) {
                        void navigator.clipboard?.writeText(roomCode);
                      }
                      void invokeSafe("show_settings");
                      closePanel();
                    }}
                  >
                    초대코드 {roomCode || ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => queueRoomAction({ action: "leave" })}
                  >
                    방 나가기
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setPlusOpen(false);
                  setJoinOpen(false);
                  setMoveOpen(false);
                  setComposeMode("status");
                  setChat(statusMessage);
                  window.setTimeout(() => chatInputRef.current?.focus(), 30);
                }}
              >
                상태메시지
              </button>
              {statusMessage ? (
                <button
                  type="button"
                  onClick={() => {
                    writeStatusMessage("");
                    setStatusMessage("");
                    setPlusOpen(false);
                  }}
                >
                  상태메시지 지우기
                </button>
              ) : null}
              <button type="button" onClick={() => openBuddyTab("quests")}>
                퀘스트 확인
              </button>
              <button type="button" onClick={() => openBuddyTab("character")}>
                캐릭터 변경
              </button>
            </div>
          )}
          {moveOpen && (
            <div className="composer-move-menu">
              <label className="move-switch">
                <span>자동 이동</span>
                <input
                  type="checkbox"
                  checked={move.walking}
                  onChange={(e) => patchMove({ walking: e.target.checked })}
                />
                <span className="switch-ui" aria-hidden />
              </label>

              <div className="move-row">
                <span>이동 범위</span>
                <select
                  value={move.pathMode}
                  onChange={(e) =>
                    patchMove({ pathMode: e.target.value as PathMode })
                  }
                >
                  {PATH_MODE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="move-row">
                <span>속도</span>
                <input
                  type="range"
                  min={3}
                  max={40}
                  value={Math.round(move.speed * 1000)}
                  disabled={!move.walking}
                  onChange={(e) =>
                    patchMove({ speed: Number(e.target.value) / 1000 })
                  }
                />
              </div>

              <button
                type="button"
                className="move-grip"
                onClick={startRepositionMode}
              >
                ↕ 끌어서 위치 옮기기
              </button>
              <p className="move-hint">
                누르면 채팅창이 잠깐 숨겨지고, 캐릭터를 드래그할 수 있어요
              </p>
            </div>
          )}
          <form
            className="composer-bar"
            onSubmit={(e) => {
              e.preventDefault();
              sendChat();
            }}
          >
            <button
              type="button"
              className={`composer-plus${plusOpen ? " open" : ""}`}
              aria-label="더보기"
              onClick={() => {
                setMoveOpen(false);
                setJoinOpen(false);
                setPlusOpen((v) => !v);
              }}
            >
              +
            </button>
            <input
              ref={chatInputRef}
              value={chat}
              maxLength={composeMode === "status" ? 40 : MAX_CHAT_LENGTH}
              placeholder={
                composeMode === "status"
                  ? "상태메시지 (항상 표시)…"
                  : inRoom
                    ? "메시지 보내기…"
                    : "혼잣말 보내기…"
              }
              onChange={(e) => setChat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (composeMode === "status") {
                    setComposeMode("chat");
                    setChat("");
                    return;
                  }
                  closePanel();
                }
              }}
            />
            {composeMode === "status" && (
              <button
                type="button"
                className="composer-emoji open"
                aria-label="채팅으로"
                title="채팅으로 돌아가기"
                onClick={() => {
                  setComposeMode("chat");
                  setChat("");
                }}
              >
                💬
              </button>
            )}
            <button
              type="button"
              className={`composer-emoji${moveOpen ? " open" : ""}`}
              aria-label="이동 설정"
              onClick={() => {
                setPlusOpen(false);
                setComposeMode("chat");
                setMoveOpen((v) => !v);
              }}
            >
              ✨
            </button>
            <button
              type="submit"
              className="composer-send"
              disabled={composeMode === "chat" && !chat.trim()}
              aria-label={composeMode === "status" ? "상태 저장" : "전송"}
            >
              {composeMode === "status" ? "✓" : "↑"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function persistActiveRoom(code: string | null) {
  if (!code) localStorage.removeItem(ROOM_KEY);
  else localStorage.setItem(ROOM_KEY, JSON.stringify({ code }));
  window.dispatchEvent(new Event("monibuddy:room"));
}
