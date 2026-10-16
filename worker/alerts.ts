// Dashboard alerts and pod suggestions, computed from stored data (read-only: no D1 writes).
import type { Alert, Editor, PodSuggestion } from "../shared/api.ts";
import { cpa, cpaWarnLimit, roas, type Targets } from "../shared/metrics.ts";
import { podById } from "../shared/taxonomy.ts";
import { getLatestDate, getTargets, loadConcepts, shiftDay, toTotals, TOTALS_SQL } from "./queries.ts";

type Row = Record<string, unknown>;

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const usd2 = (v: number) => `$${v.toFixed(2)}`;

/** A fatiguing ad needs this much spend in the last 3 days before it's worth flagging. */
const FATIGUE_MIN_SPEND_CENTS = 150_00;
/** …and its recent CPA must be at least this much above the week before. */
const FATIGUE_RISE = 0.3;

/**
 * Up to ~7 alerts, worst first:
 * - fatigue: CPA over the last 3 days is above the amber limit and ≥ 30% above the 7 days before;
 * - concepts whose test window closed in the last 7 days as a hit;
 * - spend in the last 7 days that no pod or the agency is credited with.
 */
export async function loadAlerts(db: D1Database): Promise<{ asOf: string | null; alerts: Alert[] }> {
  const [latest, targets] = await Promise.all([getLatestDate(db), getTargets(db)]);
  if (!latest) return { asOf: null, alerts: [] };
  const recentFrom = shiftDay(latest, -2);
  const priorFrom = shiftDay(latest, -9);
  const priorTo = shiftDay(latest, -3);
  const weekFrom = shiftDay(latest, -6);

  const [periods, untagged, concepts] = await Promise.all([
    db
      .prepare(
        `SELECT a.post_id, d.date >= ?1 AS recent, ${TOTALS_SQL},
           (SELECT x.name FROM ads x WHERE x.post_id = a.post_id ORDER BY x.created_time, x.id LIMIT 1) AS name
         FROM ad_daily d JOIN ads a ON a.id = d.ad_id
         WHERE d.date BETWEEN ?2 AND ?3
         GROUP BY a.post_id, recent`,
      )
      .bind(recentFrom, priorFrom, latest)
      .all<Row>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT a.post_id) AS posts, COALESCE(SUM(d.spend_cents), 0) AS spend_cents
         FROM ad_daily d JOIN ads a ON a.id = d.ad_id
         LEFT JOIN assignments s ON s.post_id = a.post_id
         WHERE d.date BETWEEN ?1 AND ?2 AND d.spend_cents > 0 AND s.pod_id IS NULL`,
      )
      .bind(weekFrom, latest)
      .first<{ posts: number; spend_cents: number }>(),
    loadConcepts(db),
  ]);

  const alerts: Alert[] = [];
  alerts.push(...fatigueAlerts(periods.results, targets, priorTo));

  for (const k of concepts
    .filter((k) => k.status === "hit" && k.windowEnd >= weekFrom && k.windowEnd <= latest)
    .sort((a, b) => b.window.spendCents - a.window.spendCents)
    .slice(0, 3)) {
    alerts.push({
      id: `hit:${k.conceptId}`,
      tone: "good",
      title: `${k.label} hit target`,
      detail: `${podById(k.podId)?.name ?? "Unassigned"} · ${usd2(cpa(k.window) ?? 0)} CPA and ${(roas(k.window) ?? 0).toFixed(2)} ROAS in its test · ${usd(k.window.spendCents)} spend`,
      href: "#/pods",
      action: "View concept",
    });
  }

  if (untagged && Number(untagged.posts) > 0) {
    const n = Number(untagged.posts);
    alerts.push({
      id: "untagged",
      tone: "warn",
      title: `${n} ${n === 1 ? "ad" : "ads"} with ${usd(Number(untagged.spend_cents))} spend ${n === 1 ? "needs" : "need"} a pod`,
      detail: "Spend in the last 7 days that no pod or the agency gets credit for yet",
      href: "#/tagging",
      action: "Tag ads",
    });
  }

  const order = { bad: 0, warn: 1, good: 2 } as const;
  return { asOf: latest, alerts: alerts.sort((a, b) => order[a.tone] - order[b.tone]) };
}

function fatigueAlerts(rows: Row[], targets: Targets, priorTo: string): Alert[] {
  const byPost = new Map<string, { name: string; recent?: ReturnType<typeof toTotals>; prior?: ReturnType<typeof toTotals> }>();
  for (const r of rows) {
    const id = String(r.post_id);
    const e = byPost.get(id) ?? { name: String(r.name ?? id) };
    if (Number(r.recent) === 1) e.recent = toTotals(r);
    else e.prior = toTotals(r);
    byPost.set(id, e);
  }
  const limit = cpaWarnLimit(targets.targetCpa, targets.cpaWarnMax);
  const out: (Alert & { spend: number })[] = [];
  for (const [postId, { name, recent, prior }] of byPost) {
    if (!recent || !prior || recent.spendCents < FATIGUE_MIN_SPEND_CENTS) continue;
    const before = cpa(prior);
    if (before == null || prior.purchases < 3) continue;
    const now = cpa(recent);
    const href = `#/rankings?post=${encodeURIComponent(postId)}`;
    if (now == null) {
      // No purchases in 3 days despite real spend.
      if (recent.spendCents >= limit * 2 * 100)
        out.push({
          id: `fatigue:${postId}`,
          tone: "bad",
          title: `${name}: no purchases in 3 days`,
          detail: `${usd(recent.spendCents)} spent since ${shortDay(priorTo, 1)} · ${usd2(before)} CPA the week before`,
          href,
          action: "View ad",
          spend: recent.spendCents,
        });
      continue;
    }
    if (now > limit && now >= before * (1 + FATIGUE_RISE))
      out.push({
        id: `fatigue:${postId}`,
        tone: "bad",
        title: `${name} CPA up ${Math.round((now / before - 1) * 100)}% in 3 days, likely fatigue`,
        detail: `${usd2(now)} CPA vs ${usd2(before)} the week before · target ${usd2(targets.targetCpa)} · ${usd(recent.spendCents)} spend`,
        href,
        action: "View ad",
        spend: recent.spendCents,
      });
  }
  return out
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 3)
    .map(({ spend: _spend, ...a }) => a);
}

function shortDay(day: string, delta: number): string {
  return new Date(`${shiftDay(day, delta)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Words in a name, upper-cased, split on anything that isn't a letter. */
const words = (s: string) => new Set(s.toUpperCase().split(/[^A-Z]+/).filter((w) => w.length >= 3));

/**
 * Suggested pods for posts no pod or the agency is credited with:
 * - high: the same video/image runs in a post that is credited (one pod only);
 * - medium: the ad name contains exactly one roster editor's name, and that editor has a pod.
 * Suggestions are never applied automatically; a person accepts them in Needs Tagging.
 */
export async function loadSuggestions(db: D1Database, editors: Editor[]): Promise<Record<string, PodSuggestion>> {
  const [shared, unassigned] = await Promise.all([
    db
      .prepare(
        `SELECT a.post_id, s2.pod_id,
           (SELECT x.name FROM ads x WHERE x.post_id = b.post_id ORDER BY x.created_time, x.id LIMIT 1) AS other_name
         FROM ads a
         JOIN ads b ON b.asset_id = a.asset_id AND b.post_id <> a.post_id
         JOIN assignments s2 ON s2.post_id = b.post_id AND s2.pod_id IS NOT NULL
         LEFT JOIN assignments s ON s.post_id = a.post_id
         WHERE a.asset_id IS NOT NULL AND s.pod_id IS NULL
         GROUP BY a.post_id, s2.pod_id`,
      )
      .all<{ post_id: string; pod_id: string; other_name: string | null }>(),
    db
      .prepare(
        `SELECT p.id AS post_id, GROUP_CONCAT(a.name, ' ') AS names
         FROM posts p JOIN ads a ON a.post_id = p.id
         LEFT JOIN assignments s ON s.post_id = p.id
         WHERE s.pod_id IS NULL
         GROUP BY p.id`,
      )
      .all<{ post_id: string; names: string }>(),
  ]);

  const out: Record<string, PodSuggestion> = {};
  const byPost = new Map<string, { podId: string; other: string | null }[]>();
  for (const r of shared.results) byPost.set(r.post_id, [...(byPost.get(r.post_id) ?? []), { podId: r.pod_id, other: r.other_name }]);
  for (const [postId, list] of byPost) {
    if (list.length !== 1) continue; // the creative runs under two different pods: leave it to a person
    const { podId, other } = list[0]!;
    out[postId] = { podId, confidence: "high", reason: `Same creative as "${other ?? "a credited ad"}"` };
  }

  const roster = editors.filter((e) => e.podId).map((e) => ({ ...e, key: e.name.toUpperCase() }));
  for (const r of unassigned.results) {
    if (out[r.post_id]) continue;
    const w = words(r.names);
    const hits = roster.filter((e) => e.key.length >= 3 && w.has(e.key));
    const pods = new Set(hits.map((e) => e.podId));
    if (pods.size !== 1) continue;
    const ed = hits[0]!;
    out[r.post_id] = { podId: ed.podId!, confidence: "medium", reason: `Editor ${ed.name} is in the ad name` };
  }
  return out;
}
