import { useCallback, useEffect, useState } from "react";
import { type Character, DEFAULT_SERVER_URL } from "@monibuddy/shared";

const KEY = "monibuddy.profile.v1";

export type LocalProfile = {
  nickname: string;
  character: Character;
  serverUrl: string;
  onboardingDone: boolean;
  statusMessage: string;
};

function normalizeCharacter(c: Character): Character {
  if (c.kind !== "buddy") return c;
  const stage = (c.stage ?? 0) as 0 | 1 | 2;
  const scale =
    typeof c.scale === "number" ? c.scale : stage === 0 ? 0.55 : stage === 1 ? 0.78 : 1;
  return { ...c, stage, scale };
}

function load(): LocalProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalProfile>;
      return {
        nickname: parsed.nickname || "Guest",
        character: normalizeCharacter(
          parsed.character ?? {
            kind: "buddy",
            id: "ank_dance",
            displaySize: 64,
            stage: 0,
            scale: 0.55,
          },
        ),
        serverUrl: parsed.serverUrl || DEFAULT_SERVER_URL,
        onboardingDone: Boolean(parsed.onboardingDone),
        statusMessage: (parsed.statusMessage || "").slice(0, 40),
      };
    }
  } catch {
    /* ignore */
  }
  return {
    nickname: "",
    character: {
      kind: "buddy",
      id: "ank_dance",
      displaySize: 64,
      stage: 0,
      scale: 0.55,
    },
    serverUrl: DEFAULT_SERVER_URL,
    onboardingDone: false,
    statusMessage: "",
  };
}

export function useLocalProfile() {
  const [profile, setProfile] = useState<LocalProfile>(load);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setProfile(load());
    setReady(true);
  }, []);

  useEffect(() => {
    const sync = () => {
      const next = load();
      setProfile((prev) =>
        JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    };
    window.addEventListener("monibuddy:profile", sync);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("monibuddy:profile", sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(KEY, JSON.stringify(profile));
    window.dispatchEvent(new CustomEvent("monibuddy:profile", { detail: profile }));
  }, [profile, ready]);

  const setNickname = useCallback((nickname: string) => {
    setProfile((p) => ({ ...p, nickname }));
  }, []);

  const setCharacter = useCallback((character: Character) => {
    setProfile((p) => ({ ...p, character }));
  }, []);

  const setStatusMessage = useCallback((statusMessage: string) => {
    setProfile((p) => ({ ...p, statusMessage: statusMessage.trim().slice(0, 40) }));
  }, []);

  const setServerUrl = useCallback((serverUrl: string) => {
    setProfile((p) => ({ ...p, serverUrl }));
  }, []);

  const completeOnboarding = useCallback(() => {
    setProfile((p) => ({
      ...p,
      onboardingDone: true,
      nickname: p.nickname.trim() || "Guest",
    }));
  }, []);

  const resetOnboarding = useCallback(() => {
    setProfile((p) => ({ ...p, onboardingDone: false }));
  }, []);

  return {
    profile,
    setNickname,
    setCharacter,
    setStatusMessage,
    setServerUrl,
    completeOnboarding,
    resetOnboarding,
    ready,
  };
}

export function readProfile(): LocalProfile {
  return load();
}

export function writeStatusMessage(text: string) {
  const profile = load();
  const next: LocalProfile = {
    ...profile,
    statusMessage: text.trim().slice(0, 40),
  };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("monibuddy:profile", { detail: next }));
  return next.statusMessage;
}
