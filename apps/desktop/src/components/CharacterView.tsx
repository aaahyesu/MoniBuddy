import { useEffect, useState } from "react";
import { BUDDY_MIN_DISPLAY_SIZE, type Character } from "@monibuddy/shared";
import { PartsPixel } from "../lib/partsPixel";
import {
  buddyFileUrl,
  buddySrcForCharacter,
  loadBuddyManifest,
  peekBuddyDef,
  resolveBuddyExt,
  resolveBuddyStage,
  type BuddyDef,
  type BuddyExt,
} from "../lib/defaultBuddies";

type Props = {
  character: Character;
  serverUrl: string;
  size?: number;
  facing?: 1 | -1;
  buddyDef?: BuddyDef;
  /**
   * 목록/프로필용: size 그대로 고정 박스에 담고 scale·최소표시크기 무시.
   * object-fit: contain 으로 비율 유지.
   */
  fixedSize?: boolean;
};

const EXT_FALLBACKS: BuddyExt[] = ["gif", "png", "jpg", "jpeg", "webp"];

export function CharacterView({
  character,
  serverUrl,
  size = BUDDY_MIN_DISPLAY_SIZE,
  facing = 1,
  buddyDef,
  fixedSize = false,
}: Props) {
  const [manifestTick, setManifestTick] = useState(0);

  useEffect(() => {
    if (character.kind !== "buddy") return;
    if (buddyDef || peekBuddyDef(character.id)) return;
    let cancelled = false;
    void loadBuddyManifest().then(() => {
      if (!cancelled) setManifestTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [character, buddyDef]);

  const flip = facing === -1 ? "scaleX(-1)" : undefined;

  if (character.kind === "buddy") {
    const def = buddyDef ?? peekBuddyDef(character.id);
    const stageDef = resolveBuddyStage(def, character.stage, character.id);
    const fileStem = stageDef.file === "unknown" ? character.id : stageDef.file;
    const src = buddySrcForCharacter(character, def);
    const px = fixedSize
      ? size
      : Math.max(
          52,
          Math.round(Math.max(size, BUDDY_MIN_DISPLAY_SIZE) * (character.scale || 1)),
        );
    return (
      <img
        key={src}
        src={src}
        alt={character.id}
        width={px}
        height={px}
        data-manifest={manifestTick}
        className={fixedSize ? "block size-full object-contain" : undefined}
        style={
          fixedSize
            ? {
                imageRendering: "auto",
                transform: flip,
              }
            : {
                width: px,
                height: px,
                objectFit: "contain",
                imageRendering: "auto",
                transform: flip,
              }
        }
        draggable={false}
        onError={(e) => {
          const img = e.currentTarget;
          const known = resolveBuddyExt(fileStem, def);
          const order = [known, ...EXT_FALLBACKS.filter((x) => x !== known)];
          const idx = Number(img.dataset.extIdx ?? "0");
          const next = order[idx + 1];
          if (!next) return;
          img.dataset.extIdx = String(idx + 1);
          img.src = buddyFileUrl(fileStem, next);
        }}
      />
    );
  }

  if (character.kind === "upload") {
    const ext = character.mime === "image/gif" ? "gif" : "png";
    const uploadSrc = `${serverUrl.replace(/\/$/, "")}/assets/${character.imageId}.${ext}`;
    return (
      <img
        src={uploadSrc}
        alt="character"
        width={size}
        height={size}
        className={fixedSize ? "block size-full object-contain" : undefined}
        style={
          fixedSize
            ? {
                imageRendering: "auto",
                transform: flip,
              }
            : {
                width: size,
                height: size,
                objectFit: "contain",
                imageRendering: "auto",
                transform: flip,
              }
        }
        draggable={false}
      />
    );
  }

  return <PartsPixel character={character} size={size} facing={facing} />;
}
