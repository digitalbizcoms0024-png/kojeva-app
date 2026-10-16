// Loads each spending post's first week and last 3 days, and applies shared/fatigue.ts.
import { fatigue, type Fatigue, type FatigueWindow } from "../shared/fatigue.ts";
import type { Targets } from "../shared/metrics.ts";
import { daysBetween, shiftDay } from "./queries.ts";

type Row = { post_id: string; first_date: string; w: string; spend: number; impr: number; reach: number | null; clicks: number; purchases: number };

/** Fatigue for every post that spent in the last 3 synced days and is old enough to judge. */
export async function loadFatigue(db: D1Database, targets: Targets, latest: string | null): Promise<Map<string, Fatigue>> {
  const out = new Map<string, Fatigue>();
  if (!latest) return out;
  const recentFrom = shiftDay(latest, -2);
  const { results } = await db
    .prepare(
      `WITH first AS (
         SELECT a.post_id, MIN(d.date) AS first_date
         FROM ad_daily d JOIN ads a ON a.id = d.ad_id
         WHERE d.spend_cents > 0 GROUP BY a.post_id),
       live AS (
         SELECT DISTINCT a.post_id FROM ad_daily d JOIN ads a ON a.id = d.ad_id
         WHERE d.date >= ?1 AND d.spend_cents > 0)
       SELECT f.post_id, f.first_date, CASE WHEN d.date >= ?1 THEN 'recent' ELSE 'first' END AS w,
         SUM(d.spend_cents) AS spend, SUM(d.impressions) AS impr,
         CASE WHEN COUNT(d.reach) = COUNT(*) THEN SUM(d.reach) END AS reach,
         SUM(d.link_clicks) AS clicks, SUM(d.purchases) AS purchases
       FROM first f
       JOIN live l ON l.post_id = f.post_id
       JOIN ads a ON a.post_id = f.post_id
       JOIN ad_daily d ON d.ad_id = a.id
       WHERE f.first_date <= ?2
         AND (d.date >= ?1 OR (d.date >= f.first_date AND d.date < date(f.first_date, '+7 days')))
       GROUP BY f.post_id, w`,
    )
    .bind(recentFrom, shiftDay(latest, -9))
    .all<Row>();

  const byPost = new Map<string, { first?: FatigueWindow; recent?: FatigueWindow; firstDate: string }>();
  for (const r of results) {
    const e = byPost.get(r.post_id) ?? { firstDate: r.first_date };
    const win: FatigueWindow = {
      spendCents: Number(r.spend),
      impressions: Number(r.impr),
      reach: r.reach == null ? null : Number(r.reach),
      linkClicks: Number(r.clicks),
      purchases: Number(r.purchases),
    };
    if (r.w === "recent") e.recent = win;
    else e.first = win;
    byPost.set(r.post_id, e);
  }
  for (const [postId, e] of byPost) {
    if (!e.first || !e.recent) continue;
    const f = fatigue(e.first, e.recent, daysBetween(e.firstDate, latest) + 1, targets);
    if (f) out.set(postId, f);
  }
  return out;
}
