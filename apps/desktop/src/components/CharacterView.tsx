import type { Character } from "@monibuddy/shared";
import { PartsPixel } from "../lib/partsPixel";
import {
  buddyAssetUrl,
  buddyFileUrl,
  resolveBuddyStage,
  type BuddyDef,
} from "../lib/defaultBuddies";

type Props = {
  character: Character;
  serverUrl: string;
  size?: number;
  facing?: 1 | -1;
  buddyDef?: BuddyDef;
};

export function CharacterView({
  character,
  serverUrl,
  size = 64,
  facing = 1,
  buddyDef,
}: Props) {
  if (character.kind === "buddy") {
    const stageDef = resolveBuddyStage(buddyDef, character.stage);
    const px = Math.max(16, Math.round(size * (character.scale || 1)));
    return (
      <img
        src={buddyAssetUrl(buddyDef, stageDef.file)}
        alt={character.id}
        width={px}
        height={px}
        style={{
          width: px,
          height: px,
          imageRendering: "pixelated",
          transform: facing === -1 ? "scaleX(-1)" : undefined,
        }}
        draggable={false}
        onError={(e) => {
          const img = e.currentTarget;
          const tried = img.dataset.try ?? "0";
          if (tried === "0") {
            img.dataset.try = "1";
            img.src = buddyFileUrl(character.id, "gif");
          } else if (tried === "1") {
            img.dataset.try = "2";
            img.src = buddyFileUrl(character.id, "jpg");
          }
        }}
      />
    );
  }

  if (character.kind === "upload") {
    const ext = character.mime === "image/gif" ? "gif" : "png";
    const src = `${serverUrl.replace(/\/$/, "")}/assets/${character.imageId}.${ext}`;
    return (
      <img
        src={src}
        alt="character"
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          imageRendering: "pixelated",
          transform: facing === -1 ? "scaleX(-1)" : undefined,
        }}
        draggable={false}
      />
    );
  }

  return <PartsPixel character={character} size={size} facing={facing} />;
}
