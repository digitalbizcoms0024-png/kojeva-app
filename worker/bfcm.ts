// BFCM page data (owner, Nov 8): every post with an ad in the promo campaign, with its numbers there
// day by day. The page derives its views (promo so far, last 3 days, latest day) and the Scale /
// Watch / Cut calls (shared/bfcm.ts) from these, so one request serves them all.
import type { BfcmAd, BfcmDay, BfcmResponse } from "../shared/api.ts";
import { BFCM } from "../shared/bfcm.ts";
import { memoize } from "./cache.ts";
import { getLatestDate, loadPosts, toTotals, TOTALS_SQL } from "./queries.ts";

type Row = Record<string, unknown>;

export async function loadBfcm(db: D1Database): Promise<BfcmResponse> {
  const latest = await getLatestDate(db);
  const like = `%${BFCM.campaign}%`;
  // The promo's ads and their days change only with a sync: once per sync (stats version).
  const [ads, days] = await memoize(
    db,
    "bfcm",
    () =>
      Promise.all([
        db
          .prepare("SELECT id, post_id, adset_name, status FROM ads WHERE campaign_name LIKE ?1")
          .bind(like)
          .all<{ id: string; post_id: string; adset_name: string | null; status: string }>()
          .then((r) => r.results),
        db
          .prepare(
            `SELECT a.post_id, d.date, ${TOTALS_SQL},
               SUM(d.outbound_clicks) AS outbound, SUM(CASE WHEN d.spend_cents > 0 AND d.outbound_clicks IS NULL THEN 1 ELSE 0 END) AS outbound_gaps,
               SUM(d.add_to_cart) AS atc, SUM(CASE WHEN d.spend_cents > 0 AND d.add_to_cart IS NULL THEN 1 ELSE 0 END) AS atc_gaps
             FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id
             WHERE a.campaign_name LIKE ?1 AND d.date BETWEEN ?2 AND ?3
             GROUP BY a.post_id, d.date ORDER BY d.date`,
          )
          .bind(like, BFCM.from, BFCM.to)
          .all<Row>()
          .then((r) => r.results),
      ]),
    { durable: true, scope: "stats" },
  );
  if (ads.length === 0) return { from: BFCM.from, to: BFCM.to, latest, ads: [] };

  // Names, media and fatigue from the post list (cached); fatigue looks at every copy of the post.
  const posts = new Map((await loadPosts(db, BFCM.from, BFCM.to)).map((p) => [p.postId, p]));
  const byPost = new Map<string, BfcmAd>();
  for (const a of ads) {
    const p = posts.get(a.post_id);
    const ad = byPost.get(a.post_id) ?? {
      postId: a.post_id,
      name: p?.name ?? a.post_id,
      mediaType: p?.mediaType ?? "video",
      thumbnailUrl: p?.thumbnailUrl ?? null,
      podId: p?.assignment.podId ?? null,
      adsets: [],
      active: false,
      fatigue: p?.fatigue ?? null,
      daily: [],
    };
    if (a.adset_name && !ad.adsets.includes(a.adset_name)) ad.adsets.push(a.adset_name);
    if (a.status === "ACTIVE") ad.active = true;
    byPost.set(a.post_id, ad);
  }
  for (const r of days) {
    const ad = byPost.get(String(r.post_id));
    if (!ad) continue;
    const day: BfcmDay = {
      date: String(r.date),
      ...toTotals(r),
      outboundClicks: Number(r.outbound_gaps) > 0 ? null : Number(r.outbound ?? 0),
      addToCart: Number(r.atc_gaps) > 0 ? null : Number(r.atc ?? 0),
    };
    ad.daily.push(day);
  }
  return { from: BFCM.from, to: BFCM.to, latest, ads: [...byPost.values()] };
}
