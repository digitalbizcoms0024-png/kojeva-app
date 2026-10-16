// Atria creative tags. Atria is only reachable through Claude's connector, so a scheduled
// Claude task pulls tags and pushes them here, signed in with an Access service token.
// See docs/ATRIA.md.
import { Hono } from "hono";
import { requireService } from "./access.ts";
import type { AppEnv } from "./env.ts";
import { getLatestDate, shiftDay } from "./queries.ts";

export const ATRIA_CATEGORIES = [
  "theme",
  "core_desire",
  "persona",
  "emotions",
  "visual_hook",
  "offer_type",
  "media_format",
  "production_quality",
  "key_message",
  "usp",
] as const;
const STATUSES = ["tagged", "not_tagged_yet", "incomplete_tags", "not_in_account"] as const;

export type AtriaTags = Partial<Record<(typeof ATRIA_CATEGORIES)[number], string[]>>;

export const atria = new Hono<AppEnv>();
atria.use("*", requireService("ATRIA_CLIENT_ID"));

/**
 * Assets that need tags, highest recent spend first: never fetched, untagged and last
 * tried over 3 days ago (Atria tags down the spend ranking over time), or tagged over 30 days ago.
 */
atria.get("/pending", async (c) => {
  const db = c.env.DB;
  const limit = Math.min(Number(c.req.query("limit") ?? 60) || 60, 200);
  const latest = (await getLatestDate(db)) ?? new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const { results } = await db
    .prepare(
      `SELECT a.asset_id, SUM(d.spend_cents) AS spend
       FROM ads a JOIN ad_daily d ON d.ad_id = a.id
       LEFT JOIN atria_assets t ON t.asset_id = a.asset_id
       WHERE a.asset_id IS NOT NULL AND d.date >= ?1
         AND (t.asset_id IS NULL
              OR (t.status <> 'tagged' AND t.fetched_at < ?2)
              OR t.fetched_at < ?3)
       GROUP BY a.asset_id
       ORDER BY spend DESC
       LIMIT ?4`,
    )
    .bind(
      shiftDay(latest, -29),
      new Date(now - 3 * 86_400_000).toISOString(),
      new Date(now - 30 * 86_400_000).toISOString(),
      limit,
    )
    .all<{ asset_id: string; spend: number }>();
  return c.json({
    assets: results.map((r) => ({
      assetId: r.asset_id,
      videoId: r.asset_id.startsWith("v:") ? r.asset_id.slice(2) : null,
      imageHash: r.asset_id.startsWith("i:") ? r.asset_id.slice(2) : null,
      spendCents: Number(r.spend),
    })),
  });
});

type Incoming = { assetId?: unknown; status?: unknown; tags?: unknown };

function clean(item: Incoming): { assetId: string; status: string; tags: string | null } | string {
  if (typeof item.assetId !== "string" || !/^[vi]:[A-Za-z0-9_-]{1,64}$/.test(item.assetId)) return "assetId must be v:<video id> or i:<image hash>.";
  const status = item.status ?? "tagged";
  if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) return `Unknown status for ${item.assetId}.`;
  if (status !== "tagged") return { assetId: item.assetId, status, tags: null };
  if (!item.tags || typeof item.tags !== "object") return `Tags missing for ${item.assetId}.`;
  const tags: AtriaTags = {};
  for (const cat of ATRIA_CATEGORIES) {
    const v = (item.tags as Record<string, unknown>)[cat];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.length > 120)) return `${cat} must be a list of short strings.`;
    tags[cat] = (v as string[]).slice(0, 12);
  }
  return { assetId: item.assetId, status, tags: JSON.stringify(tags) };
}

/** Body: { assets: [{ assetId, status, tags }] }, up to 100. Writes only rows that changed. */
atria.post("/", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ assets?: Incoming[] }>().catch(() => null);
  const items = body?.assets;
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) return c.json({ error: "Send 1–100 assets." }, 400);
  const rows = [];
  for (const item of items) {
    const r = clean(item);
    if (typeof r === "string") return c.json({ error: r }, 400);
    rows.push(r);
  }

  const stored = new Map<string, { status: string; tags: string | null }>();
  for (let i = 0; i < rows.length; i += 90) {
    const chunk = rows.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT asset_id, status, tags FROM atria_assets WHERE asset_id IN (${chunk.map((_, j) => `?${j + 1}`).join(", ")})`)
      .bind(...chunk.map((r) => r.assetId))
      .all<{ asset_id: string; status: string; tags: string | null }>();
    for (const s of results) stored.set(s.asset_id, s);
  }

  const now = new Date().toISOString();
  const stmts = rows.map((r) => {
    const old = stored.get(r.assetId);
    // Unchanged tags still record the check, so they aren't asked for again until due.
    return old && old.status === r.status && old.tags === r.tags
      ? db.prepare("UPDATE atria_assets SET fetched_at = ?2 WHERE asset_id = ?1").bind(r.assetId, now)
      : db
          .prepare(
            `INSERT INTO atria_assets (asset_id, status, tags, fetched_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(asset_id) DO UPDATE SET status = excluded.status, tags = excluded.tags, fetched_at = excluded.fetched_at`,
          )
          .bind(r.assetId, r.status, r.tags, now);
  });
  await db.batch(stmts);
  return c.json({ ok: true, received: rows.length, tagged: rows.filter((r) => r.status === "tagged").length });
});
