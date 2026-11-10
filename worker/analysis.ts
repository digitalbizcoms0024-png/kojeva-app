// Gemini creative analysis (owner, Nov 9): one analysis per creative (asset), shared by its copies.
// Editors run it from an ad's card; the nightly job runs it for new ads that reached the spend
// threshold, up to a daily cap. Hand edits to tags always win. Read-only on Meta: it only downloads
// the ad's media and reads its copy. See docs/ATRIA.md → Gemini.
import { Hono } from "hono";
import { FREE_TAGS, TAG_OPTIONS, type CreativeAnalysis, type CreativeReadout, type CreativeTags, type FixedTag, type TagKey } from "../shared/analysis.ts";
import { requireAccess } from "./access.ts";
import { bumpVersion } from "./cache.ts";
import type { AppEnv, Env } from "./env.ts";
import { analyzeWithGemini, DEFAULT_GEMINI_MODEL, GeminiError } from "./gemini.ts";
import { adImages, clientFor, getToken } from "./meta/sync.ts";
import { pageOfPost, videoFromPreview, videoSource } from "./meta/media.ts";
import { getLatestDate, loadPostRangeTotals } from "./queries.ts";

type Row = {
  asset_id: string;
  status: string;
  media: string | null;
  model: string | null;
  tags: string | null;
  readout: string | null;
  manual: string | null;
  error: string | null;
  analyzed_at: string | null;
};

const parse = <T,>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

function toAnalysis(r: Row): CreativeAnalysis {
  const manual = parse<CreativeTags>(r.manual, {});
  return {
    assetId: r.asset_id,
    status: r.status as CreativeAnalysis["status"],
    media: (r.media as CreativeAnalysis["media"]) ?? null,
    model: r.model,
    tags: { ...parse<CreativeTags>(r.tags, {}), ...manual },
    manual: Object.keys(manual) as TagKey[],
    readout: parse<CreativeReadout | null>(r.readout, null),
    error: r.error,
    analyzedAt: r.analyzed_at,
  };
}

/** The creative a post's analysis belongs to: an ad with readable media first, an active one first. */
async function assetOf(db: D1Database, postId: string) {
  return db
    .prepare("SELECT asset_id, creative_id FROM ads WHERE post_id = ?1 AND asset_id IS NOT NULL ORDER BY asset_id LIKE 'p:%', status = 'ACTIVE' DESC, created_time LIMIT 1")
    .bind(postId)
    .first<{ asset_id: string; creative_id: string | null }>();
}

export async function loadAnalysis(db: D1Database, assetId: string): Promise<CreativeAnalysis | null> {
  const r = await db.prepare("SELECT * FROM creative_analyses WHERE asset_id = ?1").bind(assetId).first<Row>();
  return r ? toAnalysis(r) : null;
}

/** Runs Gemini on one creative and stores the result (keeping hand edits). */
export async function analyzeAsset(env: Env, db: D1Database, assetId: string, creativeId: string | null, by: string, fetcher?: typeof fetch, wait?: (ms: number) => Promise<void>) {
  const now = new Date().toISOString();
  const save = (status: string, fields: { media?: string | null; model?: string | null; tags?: string | null; readout?: string | null; error?: string | null }) =>
    db
      .prepare(
        `INSERT INTO creative_analyses (asset_id, status, media, model, tags, readout, error, analyzed_at, requested_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(asset_id) DO UPDATE SET status = excluded.status, media = COALESCE(excluded.media, media), model = COALESCE(excluded.model, model),
           tags = COALESCE(excluded.tags, tags), readout = COALESCE(excluded.readout, readout), error = excluded.error,
           analyzed_at = excluded.analyzed_at, requested_by = excluded.requested_by`,
      )
      .bind(assetId, status, fields.media ?? null, fields.model ?? null, fields.tags ?? null, fields.readout ?? null, fields.error ?? null, now, by)
      .run();

  if (!env.GEMINI_API_KEY) throw new GeminiError("Gemini isn't set up: add the GEMINI_API_KEY secret in Cloudflare.");
  // "Post ID" ads Meta hides from the hub have no media to send.
  if (assetId.startsWith("p:")) {
    await save("no_media", { error: "Meta doesn't share this ad's media with the hub (a hidden \"Post ID\" ad)." });
    return;
  }
  const token = await getToken(env, db);
  if (!token) throw new GeminiError("Connect Meta in Settings first.");
  const gc = clientFor(env, token, fetcher);
  const kind = assetId.startsWith("v:") ? "video" : "image";
  let url: string | null = null;
  let reason: string | null = null;
  try {
    if (kind === "video") {
      const post = await db.prepare("SELECT post_id FROM ads WHERE asset_id = ?1 LIMIT 1").bind(assetId).first<{ post_id: string }>();
      const v = await videoSource(env, token, assetId.slice(2), pageOfPost(post?.post_id), fetcher);
      url = v.url;
      reason = v.error;
      // Last resort: the video link inside Meta's own ad preview (what the card plays).
      if (!url && post?.post_id) {
        const p = await videoFromPreview(env, db, post.post_id, fetcher);
        url = p.url;
        if (!url && reason) reason = `${reason} · Also tried ${p.error}.`;
      }
    } else url = (await adImages(gc, env.META_AD_ACCOUNT_ID, [assetId.slice(2)])).get(assetId.slice(2))?.url ?? null;
  } catch {
    url = null;
  }
  if (!url) {
    await save("no_media", { media: kind, error: kind === "video" && reason ? reason : `Meta didn't return the ${kind} for this ad.` });
    return;
  }
  let copy: string | null = null;
  if (creativeId)
    try {
      const c = await gc.get<{ body?: string; asset_feed_spec?: { bodies?: { text?: string }[] } }>(creativeId, { fields: "body,asset_feed_spec{bodies}" });
      copy = c.body ?? c.asset_feed_spec?.bodies?.[0]?.text ?? null;
    } catch {
      copy = null; // Analyzed without the copy.
    }
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  try {
    const r = await analyzeWithGemini({ key: env.GEMINI_API_KEY, model, media: { kind, url }, copy, fetcher, wait });
    await save("analyzed", { media: kind, model, tags: JSON.stringify(r.tags), readout: JSON.stringify(r.readout) });
  } catch (e) {
    await save("failed", { media: kind, model, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Nightly: new creatives (no analysis yet) with at least GEMINI_MIN_SPEND ($50) spent, biggest
 * first, up to GEMINI_DAILY_CAP (30) a night. Off without a key.
 */
export async function analyzeNew(env: Env, db: D1Database, fetcher?: typeof fetch, wait?: (ms: number) => Promise<void>): Promise<number> {
  if (!env.GEMINI_API_KEY) return 0;
  const latest = await getLatestDate(db);
  if (!latest) return 0;
  const cap = Number(env.GEMINI_DAILY_CAP ?? 30) || 30;
  const minCents = (Number(env.GEMINI_MIN_SPEND ?? 50) || 50) * 100;
  const today = new Date().toISOString().slice(0, 10);
  const done = await db
    .prepare("SELECT COUNT(*) AS n FROM creative_analyses WHERE requested_by = 'nightly' AND analyzed_at >= ?1")
    .bind(today)
    .first<{ n: number }>();
  const room = cap - (done?.n ?? 0);
  if (room <= 0) return 0;
  // Spend per post all time (cached per sync), then per creative.
  const [totals, ads, analyzed] = await Promise.all([
    loadPostRangeTotals(db, "2000-01-01", latest),
    db.prepare("SELECT post_id, asset_id, creative_id FROM ads WHERE asset_id IS NOT NULL AND asset_id NOT LIKE 'p:%'").all<{ post_id: string; asset_id: string; creative_id: string | null }>(),
    db.prepare("SELECT asset_id FROM creative_analyses").all<{ asset_id: string }>(),
  ]);
  const seen = new Set(analyzed.results.map((r) => r.asset_id));
  const byAsset = new Map<string, { spend: number; creativeId: string | null }>();
  const counted = new Set<string>();
  for (const a of ads.results) {
    if (seen.has(a.asset_id)) continue;
    const e = byAsset.get(a.asset_id) ?? { spend: 0, creativeId: a.creative_id };
    if (!counted.has(`${a.asset_id}|${a.post_id}`)) {
      e.spend += totals.get(a.post_id)?.spendCents ?? 0;
      counted.add(`${a.asset_id}|${a.post_id}`);
    }
    byAsset.set(a.asset_id, e);
  }
  const queue = [...byAsset.entries()].filter(([, e]) => e.spend >= minCents).sort(([, a], [, b]) => b.spend - a.spend).slice(0, room);
  for (const [assetId, e] of queue) {
    try {
      await analyzeAsset(env, db, assetId, e.creativeId, "nightly", fetcher, wait);
    } catch {
      break; // Not set up (no key or Meta connection): stop for tonight.
    }
  }
  if (queue.length) await bumpVersion(db);
  return queue.length;
}

export const analysis = new Hono<AppEnv>();

/** A post's analysis (anyone signed in), or null; `enabled` says whether Gemini is set up. */
analysis.get("/posts/:id/analysis", async (c) => {
  const asset = await assetOf(c.env.DB, c.req.param("id"));
  const result = asset ? await loadAnalysis(c.env.DB, asset.asset_id) : null;
  return c.json({ enabled: !!c.env.GEMINI_API_KEY, analysis: result });
});

/**
 * Of the posts given (?posts=a,b,c, in the order shown), those whose creative has no analysis yet, or
 * whose last try failed: what Ad Rankings → Analyze top 10 works through (owner, Nov 9). Hidden
 * "Post ID" ads are left out (nothing to analyze).
 */
analysis.get("/analysis/pending", async (c) => {
  const db = c.env.DB;
  const ids = (c.req.query("posts") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 100);
  const assetOfPost = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT post_id, asset_id FROM ads WHERE post_id IN (${chunk.map((_, k) => `?${k + 1}`).join(",")}) AND asset_id IS NOT NULL AND asset_id NOT LIKE 'p:%'`)
      .bind(...chunk)
      .all<{ post_id: string; asset_id: string }>();
    for (const r of results) if (!assetOfPost.has(r.post_id)) assetOfPost.set(r.post_id, r.asset_id);
  }
  const assets = [...new Set(assetOfPost.values())];
  const done = new Set<string>();
  for (let i = 0; i < assets.length; i += 90) {
    const chunk = assets.slice(i, i + 90);
    const { results } = await db
      // Only a finished analysis counts: failed tries and videos Meta wouldn't share (before Page access) are retried.
      .prepare(`SELECT asset_id FROM creative_analyses WHERE status = 'analyzed' AND asset_id IN (${chunk.map((_, k) => `?${k + 1}`).join(",")})`)
      .bind(...chunk)
      .all<{ asset_id: string }>();
    for (const r of results) done.add(r.asset_id);
  }
  // One post per creative, so copies aren't analyzed twice.
  const seen = new Set<string>();
  const pending = ids.filter((id) => {
    const a = assetOfPost.get(id);
    if (!a || done.has(a) || seen.has(a)) return false;
    seen.add(a);
    return true;
  });
  return c.json({ enabled: !!c.env.GEMINI_API_KEY, pending });
});

/** Run (or re-run) Gemini on a post's creative. Editors only. */
analysis.post("/posts/:id/analyze", requireAccess, async (c) => {
  const db = c.env.DB;
  const asset = await assetOf(db, c.req.param("id"));
  if (!asset) return c.json({ error: "No ad found for this post." }, 404);
  try {
    await analyzeAsset(c.env, db, asset.asset_id, asset.creative_id, c.get("userEmail") ?? "editor");
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 409);
  }
  return c.json({ enabled: true, analysis: await loadAnalysis(db, asset.asset_id) });
});

/** Hand edits to tags ({ tags: { funnelStage: "MOF", persona: null } }); null clears an edit. Editors only. */
analysis.patch("/posts/:id/analysis", requireAccess, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ tags?: Record<string, string | null> }>().catch(() => null);
  if (!body?.tags || typeof body.tags !== "object") return c.json({ error: "Send { tags: { … } }." }, 400);
  const asset = await assetOf(db, c.req.param("id"));
  if (!asset) return c.json({ error: "No ad found for this post." }, 404);
  const row = await db.prepare("SELECT manual FROM creative_analyses WHERE asset_id = ?1").bind(asset.asset_id).first<{ manual: string | null }>();
  const manual = parse<CreativeTags>(row?.manual ?? null, {});
  for (const [key, value] of Object.entries(body.tags)) {
    const fixed = (TAG_OPTIONS as Record<string, readonly string[]>)[key];
    if (!fixed && !(FREE_TAGS as readonly string[]).includes(key)) return c.json({ error: `Unknown tag "${key}".` }, 400);
    if (value == null || value === "") {
      delete manual[key as TagKey];
      continue;
    }
    if (typeof value !== "string") return c.json({ error: `"${key}" must be text.` }, 400);
    if (fixed && !fixed.includes(value)) return c.json({ error: `"${value}" isn't an option for ${key}: ${fixed.join(", ")}.` }, 400);
    manual[key as TagKey] = fixed ? (value as (typeof TAG_OPTIONS)[FixedTag][number]) : value.trim().slice(0, 120);
  }
  await db
    .prepare(
      `INSERT INTO creative_analyses (asset_id, status, manual) VALUES (?1, 'failed', ?2)
       ON CONFLICT(asset_id) DO UPDATE SET manual = excluded.manual`,
    )
    .bind(asset.asset_id, JSON.stringify(manual))
    .run();
  return c.json({ enabled: !!c.env.GEMINI_API_KEY, analysis: await loadAnalysis(db, asset.asset_id) });
});
