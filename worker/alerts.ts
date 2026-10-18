// Dashboard alerts and pod suggestions, computed from stored data (read-only: no D1 writes).
import type { Alert, ConceptResult, Editor, PodSuggestion } from "../shared/api.ts";
import type { Fatigue } from "../shared/fatigue.ts";
import { cpa, roas } from "../shared/metrics.ts";
import { AWARENESS, podById } from "../shared/taxonomy.ts";
import { loadCoverage } from "./coverage.ts";
import { confirmed, loadPersonas } from "./personas.ts";
import { loadFatigue } from "./fatigue.ts";
import { getLatestDate, getTargets, loadConcepts, shiftDay } from "./queries.ts";

/** Share of a week's spend in a single persona × awareness cell that raises an alert. */
export const CONCENTRATION = 0.6;

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const usd2 = (v: number) => `$${v.toFixed(2)}`;

/**
 * Up to ~7 alerts, worst first:
 * - fatigue (shared/fatigue.ts): two or more signals vs the ad's first week, or a CPA rise on its own;
 * - concepts whose test window closed in the last 7 days as a hit;
 * - hits (and late hits) with a copy that was spending and is now off (`hitsTurnedOff`);
 * - spend in the last 7 days that no pod or the agency is credited with;
 * - over 60% of the week's spend in one persona × awareness cell (worker/coverage.ts).
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
         FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id
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

  alerts.push(...(await hitsTurnedOff(db, concepts, latest)));

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

/** Meta statuses (effective_status) that mean the ad isn't delivering because someone or something turned it off. */
const OFF_STATUSES: Record<string, string> = {
  PAUSED: "paused",
  ADSET_PAUSED: "ad set paused",
  CAMPAIGN_PAUSED: "campaign paused",
  ARCHIVED: "archived",
  DELETED: "deleted",
  DISAPPROVED: "disapproved",
  WITH_ISSUES: "has issues",
};

/**
 * Winning creatives that were just turned off. A copy of a hit (the same video or image, in any ad
 * set, by `asset_id`, else the same post) counts when it spent in the 7 days before the last 3
 * synced days and now either has an off status in Meta or spent nothing in the last 3 days. Old
 * copies retired long ago don't count, so each turn-off is flagged for about a week.
 * One alert per concept, biggest spend before the turn-off first, at most 3.
 */
export async function hitsTurnedOff(db: D1Database, concepts: ConceptResult[], latest: string): Promise<Alert[]> {
  const hits = new Map(concepts.filter((k) => k.status === "hit" || k.status === "late_hit").map((k) => [k.conceptId, k]));
  if (hits.size === 0) return [];
  const recentFrom = shiftDay(latest, -2);
  const beforeFrom = shiftDay(latest, -9);
  // Only ads that spent in the week before (each ad's days read by key; see CLAUDE.md on D1 reads).
  const { results } = await db
    .prepare(
      `SELECT a.id, a.post_id, a.asset_id, a.concept_id, a.name, a.campaign_name, a.adset_name, a.status,
         (SELECT SUM(d.spend_cents) FROM ad_daily d WHERE d.ad_id = a.id AND d.date BETWEEN ?1 AND ?2) AS before_cents,
         (SELECT SUM(d.spend_cents) FROM ad_daily d WHERE d.ad_id = a.id AND d.date >= ?3) AS recent_cents
       FROM ads a`,
    )
    .bind(beforeFrom, shiftDay(recentFrom, -1), recentFrom)
    .all<{
      id: string;
      post_id: string;
      asset_id: string | null;
      concept_id: string | null;
      name: string;
      campaign_name: string | null;
      adset_name: string | null;
      status: string;
      before_cents: number | null;
      recent_cents: number | null;
    }>();
  const creative = (r: { asset_id: string | null; post_id: string }) => r.asset_id ?? `post:${r.post_id}`;
  // Each hit concept's creatives (from its testing ads), and which concept each creative won in.
  const won = new Map<string, string>();
  for (const r of results) if (r.concept_id && hits.has(r.concept_id)) won.set(creative(r), r.concept_id);

  const off = new Map<string, { postId: string; name: string; where: string; why: string; beforeCents: number }[]>();
  for (const r of results) {
    const conceptId = won.get(creative(r));
    const before = Number(r.before_cents ?? 0);
    if (!conceptId || before <= 0) continue;
    const why = OFF_STATUSES[r.status] ?? (Number(r.recent_cents ?? 0) > 0 ? null : "no spend in 3 days");
    if (!why) continue;
    const list = off.get(conceptId) ?? [];
    list.push({ postId: r.post_id, name: r.name, where: r.campaign_name ?? r.adset_name ?? "", why, beforeCents: before });
    off.set(conceptId, list);
  }

  return [...off]
    .map(([conceptId, copies]) => {
      const k = hits.get(conceptId)!;
      copies.sort((a, b) => b.beforeCents - a.beforeCents);
      const spend = copies.reduce((n, c) => n + c.beforeCents, 0);
      const shown = copies
        .slice(0, 2)
        .map((c) => `${c.name}${c.where ? ` in ${c.where}` : ""} (${c.why})`)
        .join("; ");
      const alert: Alert = {
        id: `hit-off:${conceptId}`,
        tone: "warn",
        title: `${k.label} was a ${k.status === "late_hit" ? "late hit" : "hit"}; ${copies.length === 1 ? "a copy is" : `${copies.length} copies are`} now off`,
        detail: `${podById(k.podId)?.name ?? "Unassigned"} · ${shown}${copies.length > 2 ? ` and ${copies.length - 2} more` : ""} · ${usd(spend)} spend in the week before`,
        href: `#/rankings?post=${encodeURIComponent(copies[0]!.postId)}`,
        action: "View ad",
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
