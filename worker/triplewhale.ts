// Triple Whale pixel attribution per Meta ad and day. Triple Whale is read through Claude's
// connector, so a scheduled Claude task pulls it and pushes it here, signed in with the same
// Access service token as the Atria task. See docs/TRIPLE_WHALE.md.
import { Hono } from "hono";
import { requireService } from "./access.ts";
import type { AppEnv } from "./env.ts";
import { getLatestDate, shiftDay } from "./queries.ts";

/**
 * The model the team reads in Triple Whale: "Clicks & Deterministic Views" in the app, called
 * "Clicks & Views" in Triple Whale's data (lifetime window, the shop default).
 */
export const TW_MODEL = "Clicks & Views";
/** How far back the task backfills. */
export const TW_BACKFILL_DAYS = 90;
/** Days re-pulled every night, since late orders keep being attributed to recent days. */
export const TW_REFRESH_DAYS = 7;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const tripleWhale = new Hono<AppEnv>();
tripleWhale.use("*", requireService("ATRIA_CLIENT_ID"));

/**
 * Days the task should send, newest first: the last 7 days with Meta data (always), then days in
 * the last 90 that were never synced. `limit` caps the list (default 21).
 */
tripleWhale.get("/pending", async (c) => {
  const db = c.env.DB;
  const limit = Math.min(Number(c.req.query("limit") ?? 21) || 21, 90);
  const latest = await getLatestDate(db);
  if (!latest) return c.json({ model: TW_MODEL, dates: [] });
  const { results } = await db
    .prepare(
      `SELECT m.date FROM (SELECT DISTINCT date FROM ad_daily WHERE date >= ?1) m
       LEFT JOIN tw_days t ON t.date = m.date
       WHERE m.date >= ?2 OR t.date IS NULL OR t.model <> ?3
       ORDER BY m.date DESC LIMIT ?4`,
    )
    .bind(shiftDay(latest, -(TW_BACKFILL_DAYS - 1)), shiftDay(latest, -(TW_REFRESH_DAYS - 1)), TW_MODEL, limit)
    .all<{ date: string }>();
  return c.json({ model: TW_MODEL, dates: results.map((r) => r.date) });
});

type IncomingDay = { date?: unknown; ads?: unknown };
type Clean = { date: string; rows: Map<string, { orders: number; revenue: number }>; skipped: number };

function clean(day: IncomingDay): Clean | string {
  if (typeof day.date !== "string" || !DAY.test(day.date)) return "Each day needs a date as YYYY-MM-DD.";
  if (!Array.isArray(day.ads)) return `ads must be a list for ${day.date}.`;
  const rows = new Map<string, { orders: number; revenue: number }>();
  let skipped = 0;
  for (const a of day.ads as Record<string, unknown>[]) {
    const id = a?.adId;
    const orders = Number(a?.orders ?? 0);
    const revenue = Number(a?.revenue ?? 0);
    // Triple Whale has rows it couldn't tie to an ad ("(not set)", "{{ad.id}}"); they belong to no post.
    if (typeof id !== "string" || !/^\d{1,30}$/.test(id)) {
      skipped++;
      continue;
    }
    if (!Number.isFinite(orders) || orders < 0 || !Number.isFinite(revenue) || revenue < 0)
      return `orders and revenue must be 0 or more for ad ${id} on ${day.date}.`;
    // Rounded to what's stored: 1/1000 of an order and whole cents.
    const prev = rows.get(id) ?? { orders: 0, revenue: 0 };
    rows.set(id, { orders: prev.orders + Math.round(orders * 1000), revenue: prev.revenue + Math.round(revenue * 100) });
  }
  // A row with nothing attributed is the same as no row.
  for (const [id, r] of rows) if (r.orders === 0 && r.revenue === 0) rows.delete(id);
  return { date: day.date, rows, skipped };
}

/**
 * Body: { model, days: [{ date, ads: [{ adId, orders, revenue }] }] }, revenue in dollars.
 * Each day is a complete snapshot: ads missing from it are set to nothing attributed.
 * Writes only rows that changed, plus a tw_days row the first time a day is synced.
 */
tripleWhale.post("/", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ model?: unknown; days?: IncomingDay[] }>().catch(() => null);
  if (!body || body.model !== TW_MODEL) return c.json({ error: `model must be "${TW_MODEL}".` }, 400);
  if (!Array.isArray(body.days) || body.days.length === 0 || body.days.length > 14) return c.json({ error: "Send 1–14 days." }, 400);
  const days: Clean[] = [];
  for (const d of body.days) {
    const r = clean(d);
    if (typeof r === "string") return c.json({ error: r }, 400);
    days.push(r);
  }
  if (days.reduce((n, d) => n + d.rows.size, 0) > 3000) return c.json({ error: "Send at most 3,000 ad rows per request." }, 400);
  if (new Set(days.map((d) => d.date)).size !== days.length) return c.json({ error: "Each date may appear once." }, 400);

  const now = new Date().toISOString();
  const known = new Map(
    (
      await db
        .prepare(`SELECT date, model FROM tw_days WHERE date IN (${days.map((_, i) => `?${i + 1}`).join(", ")})`)
        .bind(...days.map((d) => d.date))
        .all<{ date: string; model: string }>()
    ).results.map((r) => [r.date, r.model]),
  );
  const stmts: D1PreparedStatement[] = [];
  let written = 0;
  let removed = 0;
  for (const d of days) {
    const { results } = await db
      .prepare("SELECT ad_id, orders_milli, revenue_cents FROM tw_daily WHERE date = ?1")
      .bind(d.date)
      .all<{ ad_id: string; orders_milli: number; revenue_cents: number }>();
    const stored = new Map(results.map((r) => [r.ad_id, r]));
    for (const [adId, r] of d.rows) {
      const old = stored.get(adId);
      if (old && old.orders_milli === r.orders && old.revenue_cents === r.revenue) continue;
      written++;
      stmts.push(
        db
          .prepare(
            `INSERT INTO tw_daily (ad_id, date, orders_milli, revenue_cents) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(ad_id, date) DO UPDATE SET orders_milli = excluded.orders_milli, revenue_cents = excluded.revenue_cents`,
          )
          .bind(adId, d.date, r.orders, r.revenue),
      );
    }
    for (const adId of stored.keys())
      if (!d.rows.has(adId)) {
        removed++;
        stmts.push(db.prepare("DELETE FROM tw_daily WHERE ad_id = ?1 AND date = ?2").bind(adId, d.date));
      }
    // A day already synced with this model needs no write: an unchanged re-sync writes 0 rows.
    if (known.get(d.date) !== TW_MODEL)
      stmts.push(
        db
          .prepare(
            `INSERT INTO tw_days (date, model, synced_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(date) DO UPDATE SET model = excluded.model, synced_at = excluded.synced_at`,
          )
          .bind(d.date, TW_MODEL, now),
      );
  }
  for (let i = 0; i < stmts.length; i += 200) await db.batch(stmts.slice(i, i + 200));
  return c.json({
    ok: true,
    days: days.length,
    rows: days.reduce((n, d) => n + d.rows.size, 0),
    skipped: days.reduce((n, d) => n + d.skipped, 0),
    written,
    removed,
    writes: stmts.length,
  });
});

/** For Settings: when a new Triple Whale day last arrived and how much is covered. */
export async function twStatus(db: D1Database) {
  const r = await db
    .prepare("SELECT MAX(synced_at) AS last, MAX(date) AS latest, COUNT(*) AS days, MAX(model) AS model FROM tw_days")
    .first<{ last: string | null; latest: string | null; days: number; model: string | null }>();
  if (!r?.last || !r.latest || !r.model) return null;
  return { lastSync: r.last, latestDate: r.latest, days: Number(r.days), model: r.model };
}
