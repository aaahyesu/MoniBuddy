import { Readable } from "node:stream";
import type { Express, Request, Response } from "express";

const GITHUB_REPO = process.env.GITHUB_REPO ?? "aaahyesu/MoniBuddy";
const GITHUB_LATEST_JSON =
  process.env.GITHUB_LATEST_JSON ??
  `https://github.com/${GITHUB_REPO}/releases/latest/download/latest.json`;

type PlatformEntry = { url?: string; signature?: string };
type LatestJson = {
  version?: string;
  notes?: string;
  pub_date?: string;
  platforms?: Record<string, PlatformEntry>;
};

let latestCache: { at: number; body: LatestJson } | null = null;
const LATEST_CACHE_MS = 60_000;

function publicBase(req: Request): string {
  const fromEnv = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https");
  const host = String(req.headers["x-forwarded-host"] || req.get("host") || "localhost");
  return `${proto}://${host}`.replace(/\/$/, "");
}

function isAllowedUpstream(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.hostname === "github.com") {
    return /\/releases\/download\//.test(u.pathname);
  }
  // GitHub release CDN after redirect
  if (
    u.hostname === "release-assets.githubusercontent.com" ||
    u.hostname.endsWith(".githubusercontent.com")
  ) {
    return true;
  }
  return false;
}

function rewriteLatestUrls(data: LatestJson, base: string): LatestJson {
  const platforms = data.platforms ?? {};
  const next: Record<string, PlatformEntry> = {};
  for (const [key, entry] of Object.entries(platforms)) {
    if (!entry?.url) {
      next[key] = entry;
      continue;
    }
    next[key] = {
      ...entry,
      url: `${base}/desktop/download?url=${encodeURIComponent(entry.url)}`,
    };
  }
  return { ...data, platforms: next };
}

async function fetchLatestJson(): Promise<LatestJson> {
  const now = Date.now();
  if (latestCache && now - latestCache.at < LATEST_CACHE_MS) {
    return latestCache.body;
  }
  const res = await fetch(GITHUB_LATEST_JSON, {
    headers: {
      "User-Agent": "MoniBuddy-Updater-Proxy",
      Accept: "application/json",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`upstream latest.json ${res.status}`);
  }
  const body = (await res.json()) as LatestJson;
  latestCache = { at: now, body };
  return body;
}

export function mountDesktopUpdaterProxy(app: Express) {
  app.get("/desktop/latest.json", async (req, res) => {
    try {
      const raw = await fetchLatestJson();
      const rewritten = rewriteLatestUrls(raw, publicBase(req));
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(rewritten);
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : "latest.json proxy failed",
      });
    }
  });

  app.get("/desktop/download", async (req, res) => {
    const raw = String(req.query.url ?? "");
    if (!raw || !isAllowedUpstream(raw)) {
      res.status(400).json({ ok: false, error: "url not allowed" });
      return;
    }

    try {
      const upstream = await fetch(raw, {
        headers: { "User-Agent": "MoniBuddy-Updater-Proxy" },
        redirect: "follow",
      });
      if (!upstream.ok || !upstream.body) {
        res.status(upstream.status || 502).json({
          ok: false,
          error: `upstream download ${upstream.status}`,
        });
        return;
      }

      res.status(upstream.status);
      const contentType = upstream.headers.get("content-type");
      if (contentType) res.setHeader("Content-Type", contentType);
      const contentDisposition = upstream.headers.get("content-disposition");
      if (contentDisposition) res.setHeader("Content-Disposition", contentDisposition);
      const contentLength = upstream.headers.get("content-length");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      res.setHeader("Cache-Control", "public, max-age=300");

      Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(
        res,
      );
    } catch (err) {
      if (!res.headersSent) {
        res.status(502).json({
          ok: false,
          error: err instanceof Error ? err.message : "download proxy failed",
        });
      } else {
        res.destroy(err instanceof Error ? err : undefined);
      }
    }
  });

  // health 확장용 힌트 (선택)
  app.get("/desktop/updater-info", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      latestJson: "/desktop/latest.json",
      download: "/desktop/download?url=",
      upstream: GITHUB_LATEST_JSON,
    });
  });
}
