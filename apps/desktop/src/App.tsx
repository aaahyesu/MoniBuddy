import { useEffect, useMemo, useState } from "react";
import { APP_NAME } from "@monibuddy/shared";
import { BuddySheet } from "./components/BuddySheet";
import { InRoomView } from "./components/InRoomView";
import { OnboardingFlow } from "./components/OnboardingFlow";
import { RoomLobby } from "./components/RoomLobby";
import { SimpleBuddyPicker } from "./components/SimpleBuddyPicker";
import { useLocalProfile } from "./hooks/useLocalProfile";
import { useProgress } from "./hooks/useProgress";
import { useRoomSocket } from "./hooks/useRoomSocket";
import { loadBuddyManifest } from "./lib/defaultBuddies";
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
    completeOnboarding,
    resetOnboarding,
    ready,
  } = useLocalProfile();
  const [freeIds, setFreeIds] = useState<string[]>(["ank_dance"]);
  const progress = useProgress(freeIds);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [buddyTab, setBuddyTab] = useState<"character" | "quests">("character");

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
    nickname: profile.nickname,
    character: profile.character,
  });

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
    return <div className="wizard"><div className="wizard-card">불러오는 중…</div></div>;
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
      <div className="wizard">
        <div className="wizard-card">
          <div className="brand" style={{ fontSize: "1.25rem" }}>
            {APP_NAME}
          </div>
          <h2>프로필</h2>
          <label>
            닉네임
            <input
              value={profile.nickname}
              maxLength={16}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          <p className="muted" style={{ marginBottom: 0 }}>
            캐릭터
          </p>
          <SimpleBuddyPicker
            character={profile.character}
            serverUrl={profile.serverUrl}
            onChange={setCharacter}
            isUnlocked={progress.isUnlocked}
            getXp={progress.getXp}
          />
          <button
            type="button"
            className="primary big"
            style={{ width: "100%" }}
            onClick={() => setScreen(room.roomCode ? "room" : "lobby")}
          >
            확인
          </button>
        </div>
      </div>
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
        onLeave={() => room.leaveRoom()}
        onOpenBuddyMenu={() => setScreen("buddy")}
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
        onEditProfile={() => setScreen("profile")}
        onOpenRoomInfo={() => setScreen("room")}
        onShowOverlay={
          isTauri()
            ? () => void invokeSafe("toggle_overlay", { visible: true })
            : undefined
        }
      />
      <div className="quiet-bar">
        {!isTauri() && (
          <a className="muted" href="?mode=overlay" target="_blank" rel="noreferrer">
            오버레이
          </a>
        )}
        <button
          type="button"
          className="ghost"
          onClick={() => {
            resetOnboarding();
            setScreen("onboarding");
          }}
        >
          처음부터
        </button>
      </div>
    </>
  );
}
