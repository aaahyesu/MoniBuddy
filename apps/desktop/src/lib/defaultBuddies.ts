import {
  defaultScaleForStage,
  stageFromXp,
  type BuddyCharacter,
  type GrowthStage,
} from "@monibuddy/shared";

export type BuddyExt = "gif" | "png" | "jpg" | "jpeg" | "webp";

export type BuddyStageDef = {
  stage: GrowthStage;
  scale: number;
  /** filename without extension — can differ per stage when files are ready */
  file: string;
  label?: string;
};

export type BuddyGroup = "ank" | "gnd";

export type BuddyDef = {
  id: string;
  label?: string;
  /** 안경만두(ank) / 가나디(gnd) */
  group?: BuddyGroup;
  displaySize?: 32 | 64 | 80 | 128;
  /** Unlocked from the start */
  free?: boolean;
  /** e.g. quest:first_room, quest:chat_10 */
  unlock?: string;
  /** false = placeholder until asset is added */
  fileReady?: boolean;
  grows?: boolean;
  /** default from BUDDY_FILE_EXT / png */
  ext?: BuddyExt;
  stages?: BuddyStageDef[];
};

export type BuddyManifest = {
  buddies: BuddyDef[];
};

/** public/buddies 실제 파일 확장자 (manifest 로드 전·오버레이에서도 동일하게 쓰기) */
export const BUDDY_FILE_EXT: Record<string, BuddyExt> = {
  ank_dance: "gif",
  ank_headset: "gif",
  ank_listening: "jpg",
  ank_sleep: "gif",
  ank_angel: "png",
  ank_sick: "png",
  ank_surprised: "png",
  ank_withFriend: "png",
  gnd_dance: "png",
  gnd_angry: "png",
  gnd_cheese: "png",
  gnd_embrarrassing: "png",
  gnd_glasses: "png",
  gnd_sad: "png",
  gnd_tired: "png",
  reward_aha: "png",
  reward_thumbup: "png",
  reward_annoyed: "png",
};

let manifestCache: BuddyManifest | null = null;
let manifestPromise: Promise<BuddyManifest> | null = null;

export async function loadBuddyManifest(): Promise<BuddyManifest> {
  if (manifestCache) return manifestCache;
  if (manifestPromise) return manifestPromise;
  manifestPromise = (async () => {
    try {
      const res = await fetch(`/buddies/manifest.json?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        manifestCache = { buddies: [] };
        return manifestCache;
      }
      const data = (await res.json()) as BuddyManifest;
      manifestCache = {
        buddies: Array.isArray(data.buddies) ? data.buddies : [],
      };
      return manifestCache;
    } catch {
      manifestCache = { buddies: [] };
      return manifestCache;
    } finally {
      manifestPromise = null;
    }
  })();
  return manifestPromise;
}

/** 개발 중 manifest 수정 반영용 */
export function clearBuddyManifestCache() {
  manifestCache = null;
  manifestPromise = null;
}

export function peekBuddyDef(id: string): BuddyDef | undefined {
  return manifestCache?.buddies.find((b) => b.id === id);
}

export function resolveBuddyExt(
  fileStem: string,
  def?: BuddyDef | undefined,
): BuddyExt {
  if (def?.ext) return def.ext;
  if (BUDDY_FILE_EXT[fileStem]) return BUDDY_FILE_EXT[fileStem];
  if (fileStem.startsWith("gnd_")) return "png";
  if (fileStem.startsWith("ank_")) return BUDDY_FILE_EXT[fileStem] ?? "png";
  return "png";
}

export function buddyFileUrl(fileStem: string, ext: BuddyExt = "png"): string {
  const path = `/buddies/${encodeURIComponent(fileStem)}.${ext}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    try {
      return new URL(path, window.location.origin).href;
    } catch {
      /* fall through */
    }
  }
  return path;
}

export function buddyAssetUrl(def: BuddyDef | undefined, fileStem: string): string {
  return buddyFileUrl(fileStem, resolveBuddyExt(fileStem, def));
}

export function buddySrcForCharacter(
  character: BuddyCharacter,
  def?: BuddyDef,
): string {
  const resolved = def ?? peekBuddyDef(character.id);
  const stageDef = resolveBuddyStage(resolved, character.stage, character.id);
  const fileStem = stageDef.file === "unknown" ? character.id : stageDef.file;
  return buddyAssetUrl(resolved, fileStem);
}

export function resolveBuddyStage(
  def: BuddyDef | undefined,
  stage: GrowthStage,
  fallbackId?: string,
): BuddyStageDef {
  const fromManifest = def?.stages?.find((s) => s.stage === stage);
  if (fromManifest) return fromManifest;
  return {
    stage,
    scale: defaultScaleForStage(stage),
    file: def?.id ?? fallbackId ?? "unknown",
    label: stage === 0 ? "애기" : stage === 1 ? "성장" : "성체",
  };
}

export function toBuddyCharacter(def: BuddyDef, xp = 0): BuddyCharacter {
  const grows = def.grows !== false;
  const stage = grows ? stageFromXp(xp) : 2;
  const stageDef = resolveBuddyStage(def, stage);
  return {
    kind: "buddy",
    id: def.id,
    displaySize: def.displaySize ?? 80,
    stage,
    scale: stageDef.scale,
  };
}

export function buddyGroupOf(def: BuddyDef | undefined): BuddyGroup {
  if (def?.group === "gnd" || def?.group === "ank") return def.group;
  if (def?.id?.startsWith("gnd_")) return "gnd";
  return "ank";
}

export const BUDDY_GROUPS: Array<{ id: BuddyGroup; label: string }> = [
  { id: "ank", label: "안경만두" },
  { id: "gnd", label: "가나디" },
];

export function applyGrowthToBuddy(
  character: BuddyCharacter,
  def: BuddyDef | undefined,
  xp: number,
): BuddyCharacter {
  if (def && def.grows === false) {
    const stageDef = resolveBuddyStage(def, 2);
    return { ...character, stage: 2, scale: stageDef.scale, id: def.id };
  }
  const stage = stageFromXp(xp);
  const stageDef = resolveBuddyStage(def, stage);
  return {
    ...character,
    id: def?.id ?? character.id,
    stage,
    scale: stageDef.scale,
    displaySize: def?.displaySize ?? character.displaySize,
  };
}
