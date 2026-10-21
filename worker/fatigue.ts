// Loads each spending post's first week and last 3 days, and applies shared/fatigue.ts.
import { fatigue, type Fatigue, type FatigueWindow } from "../shared/fatigue.ts";
import type { Targets } from "../shared/metrics.ts";
import { memoizeMap } from "./cache.ts";
import { daysBetween, postFirstSpendSql, shiftDay } from "./queries.ts";

type Row = { post_id: string; first_date: string; w: string; spend: number; impr: number; reach: number | null; clicks: number; purchases: number };

/** Fatigue for every post that spent in the last 3 synced days and is old enough to judge. */
export function loadFatigue(db: D1Database, targets: Targets, latest: string | null): Promise<Map<string, Fatigue>> {
  return memoizeMap(db, `fatigue-${latest}`, () => computeFatigue(db, targets, latest), { durable: true, scope: "stats" });
}

async function computeFatigue(db: D1Database, targets: Targets, latest: string | null): Promise<Map<string, Fatigue>> {
  const out = new Map<string, Fatigue>();
  if (!latest) return out;
  const recentFrom = shiftDay(latest, -2);
  const { results } = await db
    .prepare(
      `WITH first AS (${postFirstSpendSql()}),
       live AS (
         SELECT a.post_id FROM ads a
         WHERE EXISTS (SELECT 1 FROM ad_daily d WHERE d.ad_id = a.id AND d.date >= ?1 AND d.spend_cents > 0)
         GROUP BY a.post_id),
       picked AS (
         SELECT f.post_id, f.first_date, a.id AS ad_id FROM first f
         CROSS JOIN live l ON l.post_id = f.post_id
         CROSS JOIN ads a ON a.post_id = f.post_id
         WHERE f.first_date <= ?2),
       -- Two key ranges per ad (first week, last 3 days) rather than one OR, which reads every day.
       days AS (
         SELECT p.post_id, p.first_date, 'first' AS w, d.* FROM picked p
         CROSS JOIN ad_daily d ON d.ad_id = p.ad_id AND d.date >= p.first_date AND d.date < date(p.first_date, '+7 days') AND d.date < ?1
         UNION ALL
         SELECT p.post_id, p.first_date, 'recent' AS w, d.* FROM picked p
         CROSS JOIN ad_daily d ON d.ad_id = p.ad_id AND d.date >= ?1)
       SELECT post_id, first_date, w,
         SUM(spend_cents) AS spend, SUM(impressions) AS impr,
         CASE WHEN COUNT(reach) = COUNT(*) THEN SUM(reach) END AS reach,
         SUM(link_clicks) AS clicks, SUM(purchases) AS purchases
       FROM days
       GROUP BY post_id, w`,
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
