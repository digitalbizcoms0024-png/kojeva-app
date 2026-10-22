// Dashboard alerts and pod suggestions, computed from stored data (read-only: no D1 writes).
import type { Alert, ConceptResult, Editor, PodSuggestion } from "../shared/api.ts";
import type { Fatigue } from "../shared/fatigue.ts";
import { cpa, roas } from "../shared/metrics.ts";
import { AWARENESS, podById } from "../shared/taxonomy.ts";
import { loadCoverage } from "./coverage.ts";
import { confirmed, loadPersonas } from "./personas.ts";
import { loadFatigue } from "./fatigue.ts";
import { loadHitCreatives } from "./hitsoff.ts";
import { memoize } from "./cache.ts";
import { getLatestDate, getTargets, loadConcepts, shiftDay, untaggedSpend } from "./queries.ts";

/** Share of a week's spend in a single persona × awareness cell that raises an alert. */
export const CONCENTRATION = 0.6;

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const usd2 = (v: number) => `$${v.toFixed(2)}`;

/**
 * Up to ~7 alerts, worst first:
 * - fatigue (shared/fatigue.ts): two or more signals vs the ad's first week, or a CPA rise on its own;
 * - concepts whose test window closed in the last 7 days as a hit;
 * - hits (and late hits) that just stopped running everywhere (`hitsTurnedOff`);
 * - misses close to target on major spend, waiting for the media buyer's hit call (still running);
 * - spend in the last 7 days that no pod or the agency is credited with;
 * - over 60% of the week's spend in one persona × awareness cell (worker/coverage.ts).
 */
export async function loadAlerts(db: D1Database): Promise<{ asOf: string | null; alerts: Alert[] }> {
  const [latest, targets] = await Promise.all([getLatestDate(db), getTargets(db)]);
  if (!latest) return { asOf: null, alerts: [] };
  const weekFrom = shiftDay(latest, -6);

  const [tired, untagged, concepts] = await Promise.all([
    loadFatigue(db, targets, latest),
    untaggedSpend(db, weekFrom, latest),
    loadConcepts(db),
  ]);

  const alerts: Alert[] = [];
  alerts.push(...(await fatigueAlerts(db, tired)));

  for (const k of concepts
    .filter((k) => k.status === "hit" && k.windowEnd >= weekFrom && k.windowEnd <= latest)
    .sort((a, b) => b.window.spendCents - a.window.spendCents)
    .slice(0, 3)) {
    alerts.push({
      id: `hit:${k.conceptId}`,
      tone: "good",
      title: `${k.label} hit target`,
      detail: `${podById(k.podId)?.name ?? "Unassigned"} · ${usd2(cpa(k.window) ?? 0)} CPA and ${(roas(k.window) ?? 0).toFixed(2)} ROAS in its test · ${usd(k.window.spendCents)} spend`,
      href: `#/dashboard?concept=${encodeURIComponent(k.conceptId)}`,
      action: "View concept",
    });
  }

  alerts.push(...(await hitsTurnedOff(db, concepts, latest)));

  for (const k of concepts
    .filter((k) => k.candidate && k.stillRunning)
    .sort((a, b) => b.allTime.spendCents - a.allTime.spendCents)
    .slice(0, 2)) {
    alerts.push({
      id: `candidate:${k.conceptId}`,
      tone: "good",
      title: `${k.label} could be a ${k.candidate === "super_winner" ? "super hit" : "hit"} (call)`,
      detail: `${podById(k.podId)?.name ?? "Unassigned"} · ${(roas(k.allTime) ?? 0).toFixed(2)} ROAS and ${usd2(cpa(k.allTime) ?? 0)} CPA since launch on ${usd(k.allTime.spendCents)} · below target, so it's the media buyer's call`,
      href: `#/dashboard?concept=${encodeURIComponent(k.conceptId)}`,
      action: "Review",
    });
  }

  if (untagged && Number(untagged.posts) > 0) {
    const n = Number(untagged.posts);
    alerts.push({
      id: "untagged",
      tone: "warn",
      title: `${n} ${n === 1 ? "ad" : "ads"} with ${usd(untagged.spendCents)} spend ${n === 1 ? "needs" : "need"} a pod`,
      detail: "Spend in the last 7 days that no pod or the agency gets credit for yet",
      href: "#/tagging",
      action: "Tag ads",
    });
  }

  // Most of the week's spend in one persona × awareness cell (once personas are confirmed).
  const map = confirmed(await loadPersonas(db)) ? await loadCoverage(db, weekFrom, latest, undefined, concepts) : null;
  if (map?.top && map.top.share > CONCENTRATION) {
    const who = map.personas.find((p) => p.id === map.top!.personaId)?.name ?? "one persona";
    const offer = map.top.offerShare != null && map.top.offerShare >= 0.5 ? `, ${Math.round(map.top.offerShare * 100)}% of it with a discount or offer` : "";
    alerts.push({
      id: "concentration",
      tone: "warn",
      title: `${Math.round(map.top.share * 100)}% of spend sits in one cell: ${who} × ${AWARENESS[map.top.awareness] ?? map.top.awareness}`,
      detail: `Last 7 days${offer}. ${map.filled} of ${map.defined} persona × awareness cells have ads running`,
      href: "#/coverage",
      action: "Open coverage map",
    });
  }

  // Days stored with purchases but no spend or impressions: an incomplete report from Meta (Oct 2026).
  // A backfill re-pulls them; until then those ads' CPA and ROAS look far better than they are.
  const gaps = await incompleteDays(db, shiftDay(latest, -29), latest);
  if (gaps.days > 0) {
    alerts.push({
      id: `incomplete:${latest}:${gaps.days}`,
      tone: "bad",
      title: `${gaps.days} ad-${gaps.days === 1 ? "day has" : "days have"} purchases but no spend`,
      detail: `${gaps.ads} ${gaps.ads === 1 ? "ad" : "ads"} in the last 30 days, so their CPA and ROAS look better than they are. Settings → Data sources → Backfill (90 days) re-pulls them from Meta`,
      href: "#/settings?tab=data",
      action: "Open data sources",
    });
  }

  const order = { bad: 0, warn: 1, good: 2 } as const;
  return { asOf: latest, alerts: alerts.sort((a, b) => order[a.tone] - order[b.tone]) };
}

const pctChange = (v: number | null) => (v == null ? null : `${v > 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`);

/** Fatigued ads, and ads whose CPA alone jumped; biggest recent spend first, at most 3. */
async function fatigueAlerts(db: D1Database, tired: Map<string, Fatigue>): Promise<Alert[]> {
  const flagged = [...tired].filter(([, f]) => f.status === "fatigued" || f.signals.includes("cpa"));
  if (flagged.length === 0) return [];
  const names = new Map<string, { name: string; spend: number }>();
  for (let i = 0; i < flagged.length; i += 90) {
    const ids = flagged.slice(i, i + 90).map(([id]) => id);
    const { results } = await db
      .prepare(
        `SELECT p.id, (SELECT x.name FROM ads x WHERE x.post_id = p.id ORDER BY x.created_time, x.id LIMIT 1) AS name,
           (SELECT SUM(d.spend_cents) FROM ads x JOIN ad_daily d ON d.ad_id = x.id WHERE x.post_id = p.id
              AND d.date >= date((SELECT MAX(date) FROM ad_daily), '-2 days')) AS spend
         FROM posts p WHERE p.id IN (${ids.map((_, j) => `?${j + 1}`).join(", ")})`,
      )
      .bind(...ids)
      .all<{ id: string; name: string | null; spend: number | null }>();
    for (const r of results) names.set(r.id, { name: r.name ?? r.id, spend: Number(r.spend ?? 0) });
  }
  return flagged
    .map(([postId, f]) => {
      const { name, spend } = names.get(postId) ?? { name: postId, spend: 0 };
      const parts = [
        f.signals.includes("frequency") && `frequency ${pctChange(f.frequencyChange)}`,
        f.signals.includes("ctr") && `CTR ${pctChange(f.ctrChange)}`,
        f.signals.includes("cpa") && (f.cpaChange == null ? "no purchases" : `CPA ${pctChange(f.cpaChange)}`),
      ].filter(Boolean);
      const alert: Alert = {
        id: `fatigue:${postId}`,
        tone: "bad",
        title:
          f.status === "fatigued"
            ? `${name} is fatiguing`
            : f.cpaChange == null
              ? `${name}: no purchases in 3 days`
              : `${name} CPA ${pctChange(f.cpaChange)} vs its first week`,
        detail: `Last 3 days vs first week: ${parts.join(" · ")} · ${usd(spend)} spend`,
        href: `#/rankings?post=${encodeURIComponent(postId)}`,
        action: "View ad",
      };
      return { alert, spend };
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 3)
    .map((x) => x.alert);
}

/**
 * Winners that just stopped running everywhere: every copy of a hit or late hit is off in Meta or
 * spent nothing in the last 3 synced days, and some copy was spending in the week before. Pausing
 * the test ad after scaling doesn't count while a copy still runs (owner, Oct 18). One alert per
 * concept, biggest spend before the turn-off first, at most 3; each shows for about a week.
 */
async function hitsTurnedOff(db: D1Database, concepts: ConceptResult[], latest: string): Promise<Alert[]> {
  const off = (await loadHitCreatives(db, concepts, latest)).filter((h) => h.turnedOffRecently);
  return off
    .map(({ concept: k, copies }) => {
      const spend = copies.reduce((n, c) => n + c.beforeCents, 0);
      const why = new Map<string, number>();
      for (const c of copies) why.set(c.off!, (why.get(c.off!) ?? 0) + 1);
      const reasons = [...why].map(([w, n]) => (copies.length === 1 ? w : `${n} ${w}`)).join(", ");
      const alert: Alert = {
        id: `hit-off:${k.conceptId}`,
        tone: "warn",
        title: `${k.label} was a ${k.status === "late_hit" ? "late hit" : "hit"} and is now off everywhere`,
        detail: `${podById(k.podId)?.name ?? "Unassigned"} · ${copies.length === 1 ? "its only copy" : `all ${copies.length} copies`}: ${reasons} · ${usd(spend)} spend in the week before`,
        href: "#/rankings?status=hits_off",
        action: "See hits turned off",
      };
      return { alert, spend };
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 3)
    .map((x) => x.alert);
}

/** Words in a name, upper-cased, split on anything that isn't a letter. */
const words = (s: string) =>
  new Set(
    s
      .toUpperCase()
      .split(/[^A-Z]+/)
      .filter((w) => w.length >= 3),
  );

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

/** Ad-days in [from, to] with purchases but no spend or impressions; once per sync (stats version). */
export function incompleteDays(db: D1Database, from: string, to: string): Promise<{ days: number; ads: number }> {
  return memoize(
    db,
    `incomplete-${from}-${to}`,
    async () => {
      const r = await db
        .prepare(
          `SELECT COUNT(*) AS days, COUNT(DISTINCT ad_id) AS ads FROM ad_daily
           WHERE date BETWEEN ?1 AND ?2 AND purchases > 0 AND spend_cents = 0 AND impressions = 0`,
        )
        .bind(from, to)
        .first<{ days: number; ads: number }>();
      return { days: Number(r?.days ?? 0), ads: Number(r?.ads ?? 0) };
    },
    { durable: true, scope: "stats" },
  );
}
