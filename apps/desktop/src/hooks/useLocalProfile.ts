import { useCallback, useEffect, useState } from "react";
import { BUDDY_MIN_DISPLAY_SIZE, type Character } from "@monibuddy/shared";
import { resolveDefaultServerUrl } from "../lib/serverUrl";

const KEY = "monibuddy.profile.v1";
const DEFAULT_SERVER = resolveDefaultServerUrl();

export type LocalProfile = {
  nickname: string;
  character: Character;
  serverUrl: string;
  onboardingDone: boolean;
  statusMessage: string;
};

function normalizeServerUrl(saved: string | undefined): string {
  const url = (saved || "").trim();
  if (!url) return DEFAULT_SERVER;
  // 설치본에서 예전에 저장된 localhost는 공용 서버로 교체
  if (
    import.meta.env.PROD &&
    (url.includes("127.0.0.1") || url.includes("localhost"))
  ) {
    return DEFAULT_SERVER;
  }
  return url.replace(/\/$/, "");
}

function normalizeCharacter(c: Character): Character {
  if (c.kind !== "buddy") return c;
  const stage = (c.stage ?? 0) as 0 | 1 | 2;
  const scale =
    typeof c.scale === "number" ? c.scale : stage === 0 ? 0.55 : stage === 1 ? 0.78 : 1;
  const displaySize =
    !c.displaySize || c.displaySize < BUDDY_MIN_DISPLAY_SIZE
      ? BUDDY_MIN_DISPLAY_SIZE
      : c.displaySize;
  return { ...c, stage, scale, displaySize };
}

function load(): LocalProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalProfile>;
      return {
        // 빈 문자열도 유지 (|| "Guest" 쓰면 입력 중 지울 때 다시 Guest로 복구됨)
        nickname: typeof parsed.nickname === "string" ? parsed.nickname : "",
        character: normalizeCharacter(
          parsed.character ?? {
            kind: "buddy",
            id: "ank_dance",
            displaySize: BUDDY_MIN_DISPLAY_SIZE,
            stage: 0,
            scale: 0.55,
          },
        ),
        serverUrl: normalizeServerUrl(parsed.serverUrl),
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
      displaySize: BUDDY_MIN_DISPLAY_SIZE,
      stage: 0,
      scale: 0.55,
    },
    serverUrl: DEFAULT_SERVER,
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
    const sync = (e?: Event) => {
      // 같은 창에서 방금 쓴 profile detail이 있으면 그걸 우선 (load 재파싱 레이스 방지)
      if (e && "detail" in e && e.detail) {
        const detail = e.detail as LocalProfile;
        setProfile((prev) =>
          JSON.stringify(prev) === JSON.stringify(detail) ? prev : detail,
        );
        return;
      }
      const next = load();
      setProfile((prev) =>
        JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    };
    const onProfile = (e: Event) => sync(e);
    window.addEventListener("monibuddy:profile", onProfile);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("monibuddy:profile", onProfile);
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
