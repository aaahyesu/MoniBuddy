import { useEffect, useMemo, useState } from "react";
import {
  type Character,
  GIF_MAX_BYTES,
  GROWTH_XP_THRESHOLDS,
  PART_CATALOG,
  PNG_MAX_BYTES,
  type PartsCharacter,
  UPLOAD_MAX_EDGE,
  type UploadCharacter,
  stageFromXp,
} from "@monibuddy/shared";
import { CharacterView } from "./CharacterView";
import { partLabel } from "../lib/parts";
import {
  applyGrowthToBuddy,
  buddyAssetUrl,
  loadBuddyManifest,
  toBuddyCharacter,
  type BuddyDef,
  type BuddyManifest,
} from "../lib/defaultBuddies";

type Props = {
  character: Character;
  serverUrl: string;
  onChange: (c: Character) => void;
  isUnlocked: (buddyId: string) => boolean;
  getXp: (buddyId: string) => number;
  /** Onboarding / sheet: buddy-first, fewer options */
  simple?: boolean;
};

type Mode = "parts" | "buddy" | "upload";

export function CharacterEditor({
  character,
  serverUrl,
  onChange,
  isUnlocked,
  getXp,
  simple = false,
}: Props) {
  const [mode, setMode] = useState<Mode>(
    character.kind === "upload"
      ? "upload"
      : character.kind === "buddy" || simple
        ? "buddy"
        : "parts",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<BuddyManifest>({ buddies: [] });

  useEffect(() => {
    void loadBuddyManifest().then(setManifest);
  }, []);

  const buddyMap = useMemo(() => {
    const m = new Map<string, BuddyDef>();
    for (const b of manifest.buddies) m.set(b.id, b);
    return m;
  }, [manifest]);

  const activeBuddyDef =
    character.kind === "buddy" ? buddyMap.get(character.id) : undefined;

  const parts = useMemo(
    () => (character.kind === "parts" ? character : null),
    [character],
  );

  function updateParts(patch: Partial<PartsCharacter["layers"]> & { palette?: string }) {
    const base: PartsCharacter =
      character.kind === "parts"
        ? character
        : {
            kind: "parts",
            layers: {
              head: "head_round",
              body: "body_basic",
              outfit: "outfit_tee",
              accessory: "none",
            },
            palette: "#6ec6ff",
          };
    onChange({
      ...base,
      kind: "parts",
      layers: { ...base.layers, ...patch },
      palette: patch.palette ?? base.palette,
    });
    setMode("parts");
  }

  function selectBuddy(def: BuddyDef) {
    if (def.fileReady === false) {
      setError("아직 준비 중이에요");
      return;
    }
    if (!isUnlocked(def.id)) {
      setError(def.unlock ? `해금 조건: ${def.unlock}` : "아직 해금되지 않았습니다.");
      return;
    }
    setError(null);
    const xp = getXp(def.id);
    onChange(toBuddyCharacter(def, xp));
    setMode("buddy");
  }

  // sync growth from progress store
  useEffect(() => {
    const sync = () => {
      if (character.kind !== "buddy") return;
      const def = buddyMap.get(character.id);
      const xp = getXp(character.id);
      const next = applyGrowthToBuddy(character, def, xp);
      if (next.stage !== character.stage || Math.abs(next.scale - character.scale) > 0.001) {
        onChange(next);
      }
    };
    window.addEventListener("monibuddy:progress", sync);
    return () => window.removeEventListener("monibuddy:progress", sync);
  }, [character, buddyMap, getXp, onChange]);

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    const isGif = file.type === "image/gif";
    const isPng = file.type === "image/png";
    if (!isGif && !isPng) {
      setError("PNG 또는 GIF만 지원합니다.");
      return;
    }
    const max = isGif ? GIF_MAX_BYTES : PNG_MAX_BYTES;
    if (file.size > max) {
      setError(`파일이 너무 큽니다 (최대 ${Math.floor(max / 1024)}KB).`);
      return;
    }

    const dims = await readImageSize(file);
    if (Math.max(dims.w, dims.h) > UPLOAD_MAX_EDGE) {
      setError(`긴 변은 ${UPLOAD_MAX_EDGE}px 이하여야 합니다. (현재 ${dims.w}×${dims.h})`);
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("displaySize", String(pickDisplaySize(Math.max(dims.w, dims.h))));
      const res = await fetch(`${serverUrl.replace(/\/$/, "")}/assets`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        imageId?: string;
        mime?: "image/png" | "image/gif";
        displaySize?: 32 | 64 | 80 | 128;
      };
      if (!json.ok || !json.imageId || !json.mime) {
        setError(json.error ?? "업로드 실패");
        return;
      }
      const next: UploadCharacter = {
        kind: "upload",
        imageId: json.imageId,
        mime: json.mime,
        displaySize: json.displaySize ?? 64,
      };
      onChange(next);
      setMode("upload");
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 오류");
    } finally {
      setBusy(false);
    }
  }

  const xp = character.kind === "buddy" ? getXp(character.id) : 0;
  const stage = character.kind === "buddy" ? character.stage : 0;
  const nextThreshold =
    stage >= 2 ? null : GROWTH_XP_THRESHOLDS[stageFromXp(xp) + 1] ?? GROWTH_XP_THRESHOLDS[2];

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div>
        <div className="preview">
          <CharacterView
            character={character}
            serverUrl={serverUrl}
            size={96}
            buddyDef={activeBuddyDef}
          />
        </div>
        {character.kind === "buddy" && activeBuddyDef?.grows !== false && (
          <div className="growth-box">
            <div className="muted">
              성장 {stage}/2 · XP {xp}
              {nextThreshold != null ? ` → ${nextThreshold}` : " (최대)"}
            </div>
            <div className="quest-bar">
              <div
                style={{
                  width: `${Math.min(100, Math.round((xp / GROWTH_XP_THRESHOLDS[2]) * 100))}%`,
                }}
              />
            </div>
            <div className="muted">채팅을 보내면 성장합니다.</div>
          </div>
        )}
        <div className="row" style={{ marginTop: "0.6rem" }}>
          {!simple && (
            <button
              type="button"
              className={mode === "parts" ? "primary" : "ghost"}
              onClick={() => setMode("parts")}
            >
              파츠
            </button>
          )}
          <button
            type="button"
            className={mode === "buddy" ? "primary" : "ghost"}
            onClick={() => setMode("buddy")}
          >
            GIF
          </button>
          {!simple && (
            <button
              type="button"
              className={mode === "upload" ? "primary" : "ghost"}
              onClick={() => setMode("upload")}
            >
              업로드
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: "grid", gap: "0.55rem" }}>
        {mode === "parts" && (
          <>
            {(["head", "body", "outfit", "accessory"] as const).map((layer) => (
              <label key={layer}>
                {layer}
                <select
                  value={parts?.layers[layer] ?? (layer === "accessory" ? "none" : "")}
                  onChange={(e) => updateParts({ [layer]: e.target.value })}
                >
                  {PART_CATALOG[layer].map((id) => (
                    <option key={id} value={id}>
                      {partLabel(id)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              팔레트
              <input
                type="color"
                value={parts?.palette ?? "#6ec6ff"}
                onChange={(e) => updateParts({ palette: e.target.value })}
              />
            </label>
          </>
        )}

        {mode === "buddy" && (
          <>
            <p className="muted" style={{ margin: 0 }}>
              잠긴 항목은 퀘스트로 해금됩니다. 파일이 없는 보상은 잠김으로 표시됩니다.
            </p>
            <div className="row">
              {manifest.buddies.map((b) => {
                const unlocked = isUnlocked(b.id);
                const ready = b.fileReady !== false;
                const available = unlocked && ready;
                const selected = character.kind === "buddy" && character.id === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={`buddy-pick${selected ? " primary" : " ghost"}${
                      available ? "" : " locked"
                    }`}
                    onClick={() => selectBuddy(b)}
                    title={available ? b.label ?? b.id : "잠김"}
                  >
                    {available ? (
                      <img
                        src={buddyAssetUrl(b, b.stages?.[0]?.file ?? b.id)}
                        alt={b.id}
                        width={48}
                        height={48}
                        style={{
                          imageRendering: "auto",
                          display: "block",
                        }}
                      />
                    ) : (
                      <span className="buddy-placeholder">🔒</span>
                    )}
                    <span className="buddy-cap">
                      {available ? b.label ?? b.id : "잠김"}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {mode === "upload" && (
          <>
            <p className="muted" style={{ margin: 0 }}>
              PNG ≤128KB · GIF ≤512KB · 긴 변 ≤{UPLOAD_MAX_EDGE}px
            </p>
            <input
              type="file"
              accept="image/png,image/gif"
              disabled={busy}
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            />
            {character.kind === "upload" && (
              <p className="muted" style={{ margin: 0 }}>
                imageId: {character.imageId} ({character.mime})
              </p>
            )}
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

function pickDisplaySize(edge: number): 32 | 64 | 80 | 128 {
  if (edge <= 32) return 32;
  if (edge <= 64) return 64;
  if (edge <= 96) return 80;
  return 128;
}

function readImageSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 읽을 수 없습니다"));
    };
    img.src = url;
  });
}
