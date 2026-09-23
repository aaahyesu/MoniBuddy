import { useEffect, useMemo, useState } from "react";
import { APP_NAME } from "@monibuddy/shared";
import { BuddySheet } from "./components/BuddySheet";
import { HotkeyField } from "./components/HotkeyField";
import { InRoomView } from "./components/InRoomView";
import { OnboardingFlow } from "./components/OnboardingFlow";
import { RoomLobby } from "./components/RoomLobby";
import { SimpleBuddyPicker } from "./components/SimpleBuddyPicker";
import { Brand, Btn, Field, ShellCard, inputClass } from "./components/ui";
import { UpdateBanner } from "./components/UpdateBanner";
import { useLocalProfile } from "./hooks/useLocalProfile";
import { useProgress } from "./hooks/useProgress";
import { useRoomSocket } from "./hooks/useRoomSocket";
import { loadBuddyManifest } from "./lib/defaultBuddies";
import {
  readDeviceIdentity,
  writeDeviceIdentity,
} from "./lib/deviceIdentity";
import { applyOverlayHotkey } from "./lib/overlayHotkey";
import { persistActiveRoom } from "./overlay/OverlayApp";
import { invokeSafe, isTauri } from "./lib/tauri";

type Screen = "onboarding" | "lobby" | "room" | "profile" | "buddy";

const PENDING_ROOM_KEY = "monibuddy.pendingRoom.v1";

type PendingRoom =
  | { action: "create"; at: number }
  | { action: "join"; code: string; at: number }
  | { action: "leave"; at: number };

export function App() {
  useEffect(() => {
    document.body.classList.add("settings-body");
    document.body.classList.remove("overlay-body");
  }, []);

  const {
    profile,
    setNickname,
    setCharacter,
    setServerUrl,
    setForcePolling,
    setOverlayHotkey,
    completeOnboarding,
    resetOnboarding,
    ready,
  } = useLocalProfile();
  const [freeIds, setFreeIds] = useState<string[]>(["ank_dance"]);
  const progress = useProgress(freeIds);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [buddyTab, setBuddyTab] = useState<"character" | "quests">("character");
  const [hotkeyError, setHotkeyError] = useState("");
  const [device, setDevice] = useState(() => readDeviceIdentity());

  useEffect(() => {
    if (!ready || !isTauri()) return;
    let cancelled = false;
    void (async () => {
      const result = await applyOverlayHotkey(profile.overlayHotkey);
      if (cancelled) return;
      setHotkeyError(result.ok ? "" : result.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, profile.overlayHotkey]);

  useEffect(() => {
    void loadBuddyManifest().then((m) => {
      setFreeIds(m.buddies.filter((b) => b.free).map((b) => b.id));
    });
  }, []);

  useEffect(() => {
    if (!ready || screen !== null) return;
    setScreen(profile.onboardingDone ? "lobby" : "onboarding");
  }, [ready, profile.onboardingDone, screen]);

  useEffect(() => {
    const onOpen = () => {
      try {
        const raw = localStorage.getItem("monibuddy.openBuddy.v1");
        if (raw) {
          const parsed = JSON.parse(raw) as { tab?: string };
          if (parsed.tab === "quests" || parsed.tab === "character") {
            setBuddyTab(parsed.tab);
          }
        }
      } catch {
        /* legacy timestamp-only values */
      }
      setScreen("buddy");
    };
    window.addEventListener("monibuddy:openBuddy", onOpen);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "monibuddy.openBuddy.v1") onOpen();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("monibuddy:openBuddy", onOpen);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const room = useRoomSocket({
    serverUrl: profile.serverUrl,
    nickname: profile.nickname || "Guest",
    character: profile.character,
    statusMessage: profile.statusMessage,
    forcePolling: profile.forcePolling,
    userId: device.userId,
    friendCode: device.friendCode,
  });

  // 서버가 배정한 friendCode를 기기에 저장
  useEffect(() => {
    if (!room.resolvedFriendCode) return;
    if (room.resolvedFriendCode === device.friendCode) return;
    const next = { ...device, friendCode: room.resolvedFriendCode };
    writeDeviceIdentity(next);
    setDevice(next);
  }, [room.resolvedFriendCode, device]);

  useEffect(() => {
    persistActiveRoom(room.roomCode);
    if (room.roomCode && (screen === "lobby" || screen === null)) {
      setScreen("room");
    }
    if (!room.roomCode && screen === "room") {
      setScreen("lobby");
    }
  }, [room.roomCode, screen]);

  // Overlay + menu → create / join / leave room
  useEffect(() => {
    const flush = () => {
      try {
        const raw = localStorage.getItem(PENDING_ROOM_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as PendingRoom;
        localStorage.removeItem(PENDING_ROOM_KEY);
        if (!parsed?.action || !parsed.at) return;
        if (Date.now() - parsed.at > 12000) return;

        if (parsed.action === "create") {
          void room.createRoom().then((ok) => {
            if (!ok) return;
            progress.trackQuest("quest:first_room");
            setScreen("room");
            void invokeSafe("show_settings");
          });
          return;
        }
        if (parsed.action === "join") {
          const code = (parsed.code || "").trim();
          if (code.length < 4) return;
          void room.joinRoom(code).then((ok) => {
            if (!ok) return;
            progress.trackQuest("quest:first_room");
            setScreen("room");
            void invokeSafe("show_settings");
          });
          return;
        }
        if (parsed.action === "leave") {
          room.leaveRoom();
          setScreen("lobby");
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("monibuddy:pendingRoom", flush);
    window.addEventListener("storage", flush);
    const id = window.setInterval(flush, 400);
    return () => {
      window.removeEventListener("monibuddy:pendingRoom", flush);
      window.removeEventListener("storage", flush);
      window.clearInterval(id);
    };
  }, [room.createRoom, room.joinRoom, room.leaveRoom, progress]);

  useEffect(() => {
    const payload = {
      members: room.members,
      messages: room.messages,
      memberId: room.memberId,
      roomCode: room.roomCode,
      serverUrl: profile.serverUrl,
      nickname: profile.nickname,
      character: profile.character,
      statusMessage: profile.statusMessage || "",
    };
    localStorage.setItem("monibuddy.runtime.v1", JSON.stringify(payload));
    if (room.roomCode) {
      localStorage.setItem(
        "monibuddy.activeRoom.v1",
        JSON.stringify({ code: room.roomCode }),
      );
    } else {
      localStorage.removeItem("monibuddy.activeRoom.v1");
    }
  }, [
    room.members,
    room.messages,
    room.memberId,
    room.roomCode,
    profile.serverUrl,
    profile.nickname,
    profile.character,
    profile.statusMessage,
  ]);

  // 상태메시지 변경 → 방 멤버에게 동기화
  useEffect(() => {
    if (!room.roomCode || !room.memberId || room.memberId === "local") return;
    room.publishStatusMessage(profile.statusMessage || "");
  }, [profile.statusMessage, room.roomCode, room.memberId, room.publishStatusMessage]);

  const activeBuddyId = useMemo(
    () => (profile.character.kind === "buddy" ? profile.character.id : null),
    [profile.character],
  );

  const sendChatWithProgress = (text: string) => {
    room.sendChat(text);
    progress.trackQuest("quest:chat_10");
    if (activeBuddyId) progress.addGrowthXp(activeBuddyId, 1);
  };

  // Overlay bottom chat → settings socket
  useEffect(() => {
    const flush = () => {
      try {
        const raw = localStorage.getItem("monibuddy.pendingChat.v1");
        if (!raw) return;
        const parsed = JSON.parse(raw) as { text?: string; at?: number };
        localStorage.removeItem("monibuddy.pendingChat.v1");
        if (!parsed.text || !room.roomCode) return;
        if (parsed.at && Date.now() - parsed.at > 8000) return;
        sendChatWithProgress(parsed.text);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("monibuddy:pendingChat", flush);
    window.addEventListener("storage", flush);
    const id = window.setInterval(flush, 400);
    return () => {
      window.removeEventListener("monibuddy:pendingChat", flush);
      window.removeEventListener("storage", flush);
      window.clearInterval(id);
    };
  }, [room.roomCode, room.sendChat, activeBuddyId, progress]);

  if (!ready || screen === null) {
    return (
      <ShellCard>
        <p className="m-0 text-mute">불러오는 중…</p>
      </ShellCard>
    );
  }

  if (screen === "onboarding") {
    return (
      <OnboardingFlow
        nickname={profile.nickname}
        character={profile.character}
        serverUrl={profile.serverUrl}
        onNickname={setNickname}
        onCharacter={setCharacter}
        isUnlocked={progress.isUnlocked}
        getXp={progress.getXp}
        onFinish={() => {
          completeOnboarding();
          setScreen("lobby");
          void invokeSafe("toggle_overlay", { visible: true });
        }}
      />
    );
  }

  if (screen === "profile") {
    return (
      <ShellCard>
        <Brand title={APP_NAME} subtitle="프로필 · 단축키" />
        <UpdateBanner />
        <Field label="닉네임">
          <input
            className={inputClass}
            value={profile.nickname}
            maxLength={16}
            onChange={(e) => setNickname(e.target.value)}
          />
        </Field>
        <Field label="서버 URL">
          <input
            className={inputClass}
            value={profile.serverUrl}
            onChange={(e) => setServerUrl(e.target.value.trim())}
            placeholder="https://monibuddy-server.onrender.com"
          />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 text-left text-[0.82rem] text-white/90">
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-white"
            checked={profile.forcePolling}
            onChange={(e) => setForcePolling(e.target.checked)}
          />
          <span>회사망 호환 (HTTPS 폴링만)</span>
        </label>
        <p className="m-0 pl-6 text-[0.72rem] leading-relaxed text-mute">
          WebSocket이 막힌 망에서 켜 두세요. Wi‑Fi에서 더 빠르게 쓰려면 끌 수 있어요.
        </p>
        {isTauri() ? (
          <div className="grid gap-2 text-left">
            <span className="text-[0.72rem] uppercase tracking-wider text-mute">
              오버레이 단축키
            </span>
            <HotkeyField
              value={profile.overlayHotkey}
              onChange={(hotkey) => {
                setHotkeyError("");
                setOverlayHotkey(hotkey);
              }}
            />
            {hotkeyError ? (
              <p className="m-0 text-[0.72rem] text-rose-300">
                등록 실패: {hotkeyError}. 다른 조합을 시도해 보세요.
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="m-0 text-[0.72rem] leading-relaxed text-mute">
          연결이 안 되면 위 주소가{" "}
          <span className="text-accent-cyan">https://monibuddy-server.onrender.com</span>{" "}
          인지 확인하세요. Render 무료 서버는 첫 접속에 30초 걸릴 수 있어요.
        </p>
        <p className="mb-0 text-[0.9rem] text-mute">캐릭터</p>
        <SimpleBuddyPicker
          character={profile.character}
          serverUrl={profile.serverUrl}
          onChange={setCharacter}
          isUnlocked={progress.isUnlocked}
          getXp={progress.getXp}
        />
        <Btn
          variant="primary"
          size="lg"
          onClick={() => setScreen(room.roomCode ? "room" : "lobby")}
        >
          확인
        </Btn>
      </ShellCard>
    );
  }

  if (screen === "buddy") {
    return (
      <BuddySheet
        key={buddyTab}
        initialTab={buddyTab}
        character={profile.character}
        serverUrl={profile.serverUrl}
        onChange={setCharacter}
        isUnlocked={progress.isUnlocked}
        getXp={progress.getXp}
        quests={progress.questView}
        unlockNotices={progress.state.lastUnlocks}
        onDismissNotices={progress.clearLastUnlocks}
        onClose={() => setScreen(room.roomCode ? "room" : "lobby")}
      />
    );
  }

  if (screen === "room" && room.roomCode) {
    return (
      <InRoomView
        roomCode={room.roomCode}
        nickname={profile.nickname}
        character={profile.character}
        serverUrl={profile.serverUrl}
        members={room.members}
        myFriendCode={room.resolvedFriendCode || device.friendCode}
        friends={room.friends}
        connected={room.connected}
        friendError={room.friendError}
        pendingInvite={room.pendingInvite}
        onLeave={() => room.leaveRoom()}
        onOpenBuddyMenu={() => setScreen("buddy")}
        onCopyFriendCode={() => {
          const code = room.resolvedFriendCode || device.friendCode;
          void navigator.clipboard?.writeText(code);
        }}
        onAddFriend={(code) => {
          void room.addFriend(code);
        }}
        onRemoveFriend={(userId) => {
          void room.removeFriend(userId);
        }}
        onInviteFriend={(userId) => {
          void room.inviteFriend(userId);
        }}
        onAcceptInvite={() => {
          const invite = room.pendingInvite;
          if (!invite) return;
          room.setPendingInvite(null);
          void room.joinRoom(invite.roomCode).then((ok) => {
            if (ok) setScreen("room");
          });
        }}
        onDismissInvite={() => room.setPendingInvite(null)}
      />
    );
  }

  return (
    <>
      <RoomLobby
        nickname={profile.nickname || "Guest"}
        character={profile.character}
        serverUrl={profile.serverUrl}
        inRoom={Boolean(room.roomCode)}
        roomCode={room.roomCode}
        connected={room.connected}
        error={room.error}
        forcePolling={profile.forcePolling}
        overlayHotkey={profile.overlayHotkey}
        myFriendCode={room.resolvedFriendCode || device.friendCode}
        friends={room.friends}
        friendError={room.friendError}
        pendingInvite={room.pendingInvite}
        onEditProfile={() => setScreen("profile")}
        onOpenRoomInfo={() => setScreen("room")}
        onShowOverlay={
          isTauri()
            ? () => void invokeSafe("toggle_overlay", { visible: true })
            : undefined
        }
        onCopyFriendCode={() => {
          const code = room.resolvedFriendCode || device.friendCode;
          void navigator.clipboard?.writeText(code);
        }}
        onAddFriend={(code) => {
          void room.addFriend(code);
        }}
        onRemoveFriend={(userId) => {
          void room.removeFriend(userId);
        }}
        onInviteFriend={(userId) => {
          void room.inviteFriend(userId);
        }}
        onAcceptInvite={() => {
          const invite = room.pendingInvite;
          if (!invite) return;
          room.setPendingInvite(null);
          void room.joinRoom(invite.roomCode).then((ok) => {
            if (ok) setScreen("room");
          });
        }}
        onDismissInvite={() => room.setPendingInvite(null)}
      />
      <div className="fixed bottom-3 right-3 flex gap-2 opacity-75">
        {!isTauri() && (
          <a
            className="rounded-full px-3 py-1.5 text-[0.78rem] text-mute hover:text-ink"
            href="?mode=overlay"
            target="_blank"
            rel="noreferrer"
          >
            오버레이
          </a>
        )}
        <Btn
          variant="ghost"
          className="px-3 py-1.5 text-[0.78rem]"
          onClick={() => {
            resetOnboarding();
            setScreen("onboarding");
          }}
        >
          처음부터
        </Btn>
      </div>
    </>
  );
}
