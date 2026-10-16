// Dashboard alerts and pod suggestions, computed from stored data (read-only: no D1 writes).
import type { Alert, Editor, PodSuggestion } from "../shared/api.ts";
import type { Fatigue } from "../shared/fatigue.ts";
import { cpa, roas } from "../shared/metrics.ts";
import { podById } from "../shared/taxonomy.ts";
import { loadFatigue } from "./fatigue.ts";
import { getLatestDate, getTargets, loadConcepts, shiftDay } from "./queries.ts";

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const usd2 = (v: number) => `$${v.toFixed(2)}`;

/**
 * Up to ~7 alerts, worst first:
 * - fatigue (shared/fatigue.ts): two or more signals vs the ad's first week, or a CPA rise on its own;
 * - concepts whose test window closed in the last 7 days as a hit;
 * - spend in the last 7 days that no pod or the agency is credited with.
 */
export async function loadAlerts(db: D1Database): Promise<{ asOf: string | null; alerts: Alert[] }> {
  const [latest, targets] = await Promise.all([getLatestDate(db), getTargets(db)]);
  if (!latest) return { asOf: null, alerts: [] };
  const weekFrom = shiftDay(latest, -6);

  const [tired, untagged, concepts] = await Promise.all([
    loadFatigue(db, targets, latest),
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
