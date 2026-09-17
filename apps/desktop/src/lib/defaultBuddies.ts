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

export type BuddyDef = {
  id: string;
  label?: string;
  displaySize?: 32 | 64 | 128;
  /** Unlocked from the start */
  free?: boolean;
  /** e.g. quest:first_room, quest:chat_10 */
  unlock?: string;
  /** false = placeholder until asset is added */
  fileReady?: boolean;
  grows?: boolean;
  /** default gif */
  ext?: BuddyExt;
  stages?: BuddyStageDef[];
};

export type BuddyManifest = {
  buddies: BuddyDef[];
};

export async function loadBuddyManifest(): Promise<BuddyManifest> {
  try {
    const res = await fetch("/buddies/manifest.json", { cache: "no-store" });
    if (!res.ok) return { buddies: [] };
    const data = (await res.json()) as BuddyManifest;
    return {
      buddies: Array.isArray(data.buddies) ? data.buddies : [],
    };
  } catch {
    return { buddies: [] };
  }
}

export function buddyFileUrl(fileStem: string, ext: BuddyExt = "gif"): string {
  return `/buddies/${encodeURIComponent(fileStem)}.${ext}`;
}

export function buddyAssetUrl(def: BuddyDef | undefined, fileStem: string): string {
  return buddyFileUrl(fileStem, def?.ext ?? "gif");
}

export function resolveBuddyStage(
  def: BuddyDef | undefined,
  stage: GrowthStage,
): BuddyStageDef {
  const fromManifest = def?.stages?.find((s) => s.stage === stage);
  if (fromManifest) return fromManifest;
  return {
    stage,
    scale: defaultScaleForStage(stage),
    file: def?.id ?? "unknown",
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
    displaySize: def.displaySize ?? 64,
    stage,
    scale: stageDef.scale,
  };
}

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
