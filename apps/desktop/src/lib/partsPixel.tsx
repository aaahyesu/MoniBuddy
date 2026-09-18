import { useEffect, useRef } from "react";
import type { PartsCharacter } from "@monibuddy/shared";

const COLORS: Record<string, string> = {
  head_round: "#fde68a",
  head_square: "#fcd34d",
  head_cat: "#fdba74",
  body_basic: "#93c5fd",
  body_tall: "#60a5fa",
  body_round: "#7dd3fc",
  outfit_tee: "#34d399",
  outfit_hoodie: "#2dd4bf",
  outfit_cape: "#f472b6",
  none: "transparent",
  acc_hat: "#ef4444",
  acc_scarf: "#fb7185",
  acc_glasses: "#111827",
};

export function drawPartsCharacter(
  ctx: CanvasRenderingContext2D,
  character: PartsCharacter,
  size: number,
) {
  ctx.clearRect(0, 0, size, size);
  const s = size / 16;
  const palette = character.palette || "#6ec6ff";

  const fill = (x: number, y: number, w: number, h: number, color: string) => {
    if (!color || color === "transparent") return;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x * s), Math.round(y * s), Math.round(w * s), Math.round(h * s));
  };

  const body = character.layers.body;
  if (body === "body_tall") fill(5, 7, 6, 8, COLORS.body_tall);
  else if (body === "body_round") fill(4, 8, 8, 6, COLORS.body_round);
  else fill(5, 8, 6, 6, COLORS.body_basic);

  fill(5, 9, 6, 4, COLORS[character.layers.outfit] ?? "transparent");

  const head = character.layers.head;
  if (head === "head_square") fill(4, 3, 8, 6, COLORS.head_square);
  else if (head === "head_cat") {
    fill(4, 4, 8, 5, COLORS.head_cat);
    fill(4, 2, 2, 2, COLORS.head_cat);
    fill(10, 2, 2, 2, COLORS.head_cat);
  } else fill(5, 3, 6, 6, COLORS.head_round);

  fill(6, 5, 1, 1, "#111");
  fill(9, 5, 1, 1, "#111");
  fill(5, 7, 1, 1, palette);
  fill(10, 7, 1, 1, palette);

  const acc = character.layers.accessory ?? "none";
  if (acc === "acc_hat") fill(5, 1, 6, 2, COLORS.acc_hat);
  if (acc === "acc_scarf") fill(5, 8, 6, 2, COLORS.acc_scarf);
  if (acc === "acc_glasses") {
    fill(5, 5, 3, 1, COLORS.acc_glasses);
    fill(8, 5, 3, 1, COLORS.acc_glasses);
  }
}

export function PartsPixel({
  character,
  size = 64,
  facing = 1,
}: {
  character: PartsCharacter;
  size?: number;
  facing?: 1 | -1;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = size;
    canvas.height = size;
    ctx.imageSmoothingEnabled = false;
    drawPartsCharacter(ctx, character, size);
  }, [character, size]);

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        imageRendering: "pixelated",
        transform: facing === -1 ? "scaleX(-1)" : undefined,
        display: "block",
      }}
    />
  );
}
