const GLYPH: Record<string, string> = {
  head_round: "🙂",
  head_square: "🤖",
  head_cat: "🐱",
  body_basic: "🧍",
  body_tall: "🕺",
  body_round: "🐣",
  outfit_tee: "👕",
  outfit_hoodie: "🧥",
  outfit_cape: "🦸",
  none: "",
  acc_hat: "🎩",
  acc_scarf: "🧣",
  acc_glasses: "👓",
};

export function partGlyph(id: string): string {
  return GLYPH[id] ?? "・";
}

export function partLabel(id: string): string {
  return id.replace(/_/g, " ");
}
