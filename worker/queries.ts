import type { Assignment, CallEvidence, ConceptCall, ConceptResult, PostSummary } from "../shared/api.ts";
import { classify } from "../shared/classify.ts";
import { memoize, memoizeMap } from "./cache.ts";
import { loadFatigue } from "./fatigue.ts";
import {
  addTotals,
  DEFAULT_TARGETS,
  hitStatus,
  judgingWindowEnd,
  judgeTurnedOff,
  OFF_STATUSES,
  lateHitWindow,
  winnerCandidate,
  type HitStatus,
  type Targets,
  type Totals,
  ZERO_TOTALS,
} from "../shared/metrics.ts";

type Row = Record<string, unknown>;

export const TOTALS_SQL = `
  COALESCE(SUM(d.spend_cents), 0)   AS spend_cents,
  COALESCE(SUM(d.impressions), 0)   AS impressions,
  COALESCE(SUM(d.link_clicks), 0)   AS link_clicks,
  COALESCE(SUM(d.purchases), 0)     AS purchases,
  COALESCE(SUM(d.revenue_cents), 0) AS revenue_cents,
  COALESCE(SUM(d.reach), 0)         AS reach,
  COALESCE(SUM(CASE WHEN d.reach IS NOT NULL THEN d.impressions END), 0) AS reach_impressions`;

export function toTotals(r: Row | undefined): Totals {
  return {
    spendCents: Number(r?.spend_cents ?? 0),
    impressions: Number(r?.impressions ?? 0),
    linkClicks: Number(r?.link_clicks ?? 0),
    purchases: Number(r?.purchases ?? 0),
    revenueCents: Number(r?.revenue_cents ?? 0),
    reach: Number(r?.reach ?? 0),
    reachImpressions: Number(r?.reach_impressions ?? 0),
  };
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export async function getTargets(db: D1Database): Promise<Targets> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'targets'").first<{ value: string }>();
  return { ...DEFAULT_TARGETS, ...(row ? (JSON.parse(row.value) as Partial<Targets>) : {}) };
}

export async function getLatestDate(db: D1Database): Promise<string | null> {
  const row = await db.prepare("SELECT MAX(date) AS d FROM ad_daily").first<{ d: string | null }>();
  return row?.d ?? null;
}

/**
 * First day each post spent: per ad, the first spending row by the (ad_id, date) key, so it reads
 * about one row per ad instead of every ad's whole history (D1 bills rows read; see cache.ts).
 */
export function postFirstSpendSql(where = "") {
  return `SELECT a.post_id, MIN((SELECT d.date FROM ad_daily d WHERE d.ad_id = a.id AND d.spend_cents > 0 ORDER BY d.date LIMIT 1)) AS first_date
    FROM ads a ${where} GROUP BY a.post_id HAVING first_date IS NOT NULL`;
}

/**
 * Post-level facts that don't depend on the selected date range: the post, its assignment, and
 * facts from its ads (the first ad by created time names it). Two flat reads, combined here; a
 * sub-select per post costs D1 a dozen reads per post.
 */
async function loadPostBase(db: D1Database, postId?: string): Promise<Row[]> {
  const where = postId ? "WHERE p.id = ?1" : "";
  const [posts, ads] = await Promise.all([
    db
      .prepare(
        `SELECT p.id AS post_id, p.media_type, p.thumbnail_url,
           s.pod_id, s.pod_source, s.co_pod_id, s.editor_id, e.name AS editor_name,
           s.angle, s.format, s.hook, s.landing_page, s.tags_source, s.awareness, s.belief_group, s.persona_id, s.offer, s.motivations
         FROM posts p
         LEFT JOIN assignments s ON s.post_id = p.id
         LEFT JOIN editors e ON e.id = s.editor_id ${where}`,
      )
      .bind(...(postId ? [postId] : []))
      .all<Row>(),
    db
      .prepare(
        `SELECT x.id, x.post_id, x.name, x.status, x.created_time, x.concept_id, x.adset_name,
           t.status AS t_status, t.tags, t.labeled_at, t.awareness AS t_awareness, t.offer AS t_offer, t.persona_id AS t_persona,
           t.motivations AS t_motivations, t.motivations_at, t.format_label AS t_format, t.format_at
         FROM ads x LEFT JOIN atria_assets t ON t.asset_id = x.asset_id ${postId ? "WHERE x.post_id = ?1" : ""}`,
      )
      .bind(...(postId ? [postId] : []))
      .all<Row>(),
  ]);
  const byPost = new Map<string, Row[]>();
  for (const ad of ads.results) {
    const list = byPost.get(String(ad.post_id));
    if (list) list.push(ad);
    else byPost.set(String(ad.post_id), [ad]);
  }
  const order = (x: Row, y: Row) => String(x.created_time ?? "").localeCompare(String(y.created_time ?? "")) || String(x.id).localeCompare(String(y.id));
  return posts.results.map((p) => {
    const list = (byPost.get(String(p.post_id)) ?? []).sort(order);
    const first = list[0];
    const find = (ok: (ad: Row) => boolean) => list.find(ok);
    return {
      ...p,
      name: first?.name ?? null,
      copies: list.length,
      active: list.some((ad) => ad.status === "ACTIVE") ? 1 : 0,
      // Running outside testing ad sets (scaling and other campaigns).
      scaling: list.some((ad) => ad.status === "ACTIVE" && ad.concept_id == null) ? 1 : 0,
      launched: list.find((ad) => ad.created_time != null)?.created_time ?? null,
      concept_id: first?.concept_id ?? null,
      adset_name: first?.adset_name ?? null,
      atria_tags: find((ad) => ad.t_status === "tagged")?.tags ?? null,
      l_awareness: find((ad) => ad.labeled_at != null)?.t_awareness ?? null,
      l_offer: find((ad) => ad.t_offer != null)?.t_offer ?? null,
      l_persona: find((ad) => ad.t_persona != null)?.t_persona ?? null,
      l_motivations: find((ad) => ad.motivations_at != null)?.t_motivations ?? null,
      // Claude's format suggestion from the first ad it decided on (null = none fits or not yet).
      l_format: find((ad) => ad.format_at != null)?.t_format ?? null,
    };
  });
}

/** Themes and core desires across a concept's Atria-tagged assets (GROUP_CONCAT of JSON, \x1e-separated). */
function atriaUnion(raw: unknown): { atriaThemes: string[]; atriaDesires: string[]; atriaHooks: string[]; atriaPersonas: string[] } {
  const sets = { theme: new Set<string>(), core_desire: new Set<string>(), visual_hook: new Set<string>(), persona: new Set<string>() };
  if (raw != null)
    for (const json of String(raw).split("\x1e")) {
      const t = JSON.parse(json) as Record<string, string[]>;
      for (const k of Object.keys(sets) as (keyof typeof sets)[]) for (const v of t[k] ?? []) sets[k].add(v);
    }
  return { atriaThemes: [...sets.theme], atriaDesires: [...sets.core_desire], atriaHooks: [...sets.visual_hook], atriaPersonas: [...sets.persona] };
}

const list = (raw: unknown) => (raw == null ? [] : String(raw).split("\x1e").filter(Boolean));

/** A stored motivations JSON array ([] when null or unreadable). */
export function motivationList(raw: unknown): string[] {
  if (raw == null) return [];
  try {
    const v = JSON.parse(String(raw)) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The most common value (ties: first seen), or null. */
function mode(values: string[]): string | null {
  const n = new Map<string, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, c] of n) if (best == null || c > n.get(best)!) best = v;
  return best;
}

/** Calls by concept id (small table; read with the concepts' labels, per edit). */
export async function loadCalls(db: D1Database): Promise<Map<string, ConceptCall>> {
  const { results } = await db
    .prepare("SELECT concept_id, kind, reason, evidence, called_by, called_at FROM concept_calls")
    .all<{ concept_id: string; kind: ConceptCall["kind"]; reason: string; evidence: string; called_by: string; called_at: string }>();
  return new Map(
    results.map((r) => [r.concept_id, { kind: r.kind, reason: r.reason, calledBy: r.called_by, calledAt: r.called_at, evidence: JSON.parse(r.evidence) as CallEvidence }]),
  );
}

/** Every concept with its test-window totals and hit status (computed once per data version). */
export function loadConcepts(db: D1Database): Promise<ConceptResult[]> {
  // Labels per edit, on top of the numbers per sync (loadConceptNumbers).
  return memoize(db, "concepts", () => computeConcepts(db), { durable: true });
}

/** A concept's numbers: they depend only on ad_daily, its ads and the targets (see ConceptResult). */
interface ConceptNumbers {
  firstSpend: string;
  lastSpend: string;
  qualifiedOn: string | null;
  windowEnd: string;
  window: Totals;
  allTime: Totals;
  /** Before the late-hit look. */
  status: HitStatus;
  lateWindow: { from: string; to: string; totals: Totals } | null;
  /** Every ad was off and the test ended early because of it (judged on all its spend). */
  turnedOff: boolean;
}

/**
 * Every concept's numbers, keyed by concept id; concepts without spend are left out. Computed once
 * per sync (stats version), not per edit, and stored for every isolate.
 */
function loadConceptNumbers(db: D1Database): Promise<Record<string, ConceptNumbers>> {
  return memoize(db, "concept-numbers", () => computeConceptNumbers(db), { durable: true, scope: "stats" });
}

async function computeConceptNumbers(db: D1Database): Promise<Record<string, ConceptNumbers>> {
  const [targets, latest, adStatuses] = await Promise.all([
    getTargets(db),
    getLatestDate(db),
    db.prepare("SELECT concept_id, status FROM ads WHERE concept_id IS NOT NULL").raw<[string, string]>(),
  ]);
  const minSpend = targets.minTestSpend * 100;
  // Concepts whose ads are all off (paused at any level, archived or deleted).
  const anyOn = new Set<string>();
  const seen = new Set<string>();
  for (const [conceptId, status] of adStatuses) {
    seen.add(conceptId);
    if (!OFF_STATUSES.includes(status)) anyOn.add(conceptId);
  }
  const allOff = (id: string) => seen.has(id) && !anyOn.has(id);
  // Every day of every ad in a concept, read once (ads first, then each ad's days by key; a window
  // function or GROUP BY here costs D1 several reads per row). Everything below is computed from it.
  const rows = await db
    .prepare(
      `SELECT a.concept_id, a.id, d.date, d.spend_cents, d.impressions, d.link_clicks, d.purchases, d.revenue_cents
       FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id
       WHERE a.concept_id IS NOT NULL`,
    )
    .raw<[string, string, string, number, number, number, number, number]>();

  // Per concept: totals by day; per ad: running spend, for the day it reached the minimum.
  const days = new Map<string, Map<string, Totals>>();
  const adDays = new Map<string, { concept: string; days: [string, number][] }>();
  for (const [conceptId, adId, date, spendCents, impressions, linkClicks, purchases, revenueCents] of rows) {
    let byDay = days.get(conceptId);
    if (!byDay) days.set(conceptId, (byDay = new Map()));
    byDay.set(date, addTotals(byDay.get(date) ?? ZERO_TOTALS, { spendCents, impressions, linkClicks, purchases, revenueCents, reach: 0, reachImpressions: 0 }));
    let ad = adDays.get(adId);
    if (!ad) adDays.set(adId, (ad = { concept: conceptId, days: [] }));
    ad.days.push([date, spendCents]);
  }
  const qualified = new Map<string, string>();
  for (const { concept, days: list } of adDays.values()) {
    list.sort((x, y) => x[0].localeCompare(y[0]));
    let running = 0;
    for (const [date, spend] of list) {
      running += spend;
      if (running >= minSpend) {
        const prev = qualified.get(concept);
        if (!prev || date < prev) qualified.set(concept, date);
        break;
      }
    }
  }
  const sum = (list: ({ date: string } & Totals)[], from = "", to = "9999-12-31") =>
    list.reduce((acc, d) => (d.date >= from && d.date <= to ? addTotals(acc, d) : acc), ZERO_TOTALS);

  const out: Record<string, ConceptNumbers> = {};
  for (const [id, byDay] of days) {
    const series = [...byDay].map(([date, t]) => ({ date, ...t })).sort((x, y) => x.date.localeCompare(y.date));
    const spent = series.filter((d) => d.spendCents > 0);
    if (!spent.length) continue;
    const firstSpend = spent[0]!.date;
    const lastSpend = spent[spent.length - 1]!.date;
    const qualifiedOn = qualified.get(id) ?? null;
    let windowEnd = judgingWindowEnd(firstSpend, qualifiedOn, targets);
    let window = sum(series, firstSpend, windowEnd);
    let status = hitStatus(window, { qualified: qualifiedOn != null, complete: latest != null && latest >= windowEnd }, targets);
    // Every ad turned off: the test is over, judged now on everything it spent.
    const turnedOff = allOff(id) && (status === "testing" || status === "ineligible");
    if (turnedOff) {
      windowEnd = lastSpend;
      window = sum(series);
      status = judgeTurnedOff(status, window, targets);
    }
    // Second look for day-3 misses that kept spending after their judging window.
    const lateWindow = latest && status === "miss" && lastSpend > windowEnd ? lateHitWindow(series, firstSpend, windowEnd, latest, targets) : null;
    out[id] = { firstSpend, lastSpend, qualifiedOn, windowEnd, window, allTime: sum(series), status, lateWindow, turnedOff };
  }
  return out;
}

/**
 * Each concept's labels from its ads: names, Atria tags and labels, hand-set tags. Two flat reads
 * combined here (a sub-select per concept costs D1 a dozen reads per concept). Lists are joined
 * with char(30), names with "\n", as the callers split them.
 */
async function conceptLabels(db: D1Database): Promise<Row[]> {
  const [concepts, ads] = await Promise.all([
    db.prepare("SELECT id, pod_id, co_pod_id, label, adset_name FROM concepts").all<Row>(),
    db
      .prepare(
        `SELECT x.concept_id, x.name, t.status AS t_status, t.tags, t.awareness, t.belief_group, t.belief, t.persona_id,
           t.motivations AS t_motivations, s.motivations AS s_motivations,
           s.tags_source, s.angle, s.format, s.awareness AS s_awareness, s.belief_group AS s_belief, s.persona_id AS s_persona
         FROM ads x
         LEFT JOIN atria_assets t ON t.asset_id = x.asset_id
         LEFT JOIN assignments s ON s.post_id = x.post_id
         WHERE x.concept_id IS NOT NULL`,
      )
      .all<Row>(),
  ]);
  const byConcept = new Map<string, Row[]>();
  for (const ad of ads.results) {
    const list = byConcept.get(String(ad.concept_id));
    if (list) list.push(ad);
    else byConcept.set(String(ad.concept_id), [ad]);
  }
  const joined = (values: unknown[], sep: string) => (values.length ? values.map(String).join(sep) : null);
  const pick = (list: Row[], key: string, ok: (ad: Row) => boolean = () => true) => list.find((ad) => ad[key] != null && ok(ad))?.[key] ?? null;
  return concepts.results.map((c) => {
    const list = byConcept.get(String(c.id)) ?? [];
    const values = (key: string) => list.filter((ad) => ad[key] != null).map((ad) => ad[key]);
    const manual = (ad: Row) => ad.tags_source === "manual";
    return {
      ...c,
      ads: list.length,
      ad_names: joined(list.map((ad) => ad.name), "\n"),
      atria_tags: joined(list.filter((ad) => ad.t_status === "tagged").map((ad) => ad.tags), "\u001e"),
      manual_angle: pick(list, "angle", manual),
      manual_format: pick(list, "format", manual),
      awareness_list: joined(values("awareness"), "\u001e"),
      belief_group_list: joined(values("belief_group"), "\u001e"),
      belief_list: joined(values("belief"), "\u001e"),
      manual_awareness: pick(list, "s_awareness"),
      manual_belief: pick(list, "s_belief"),
      persona_list: joined(values("persona_id"), "\u001e"),
      manual_persona: pick(list, "s_persona"),
      // Per ad, a hand-set list wins over Claude's; the concept carries the union.
      motivations_list: joined([...new Set(list.flatMap((ad) => motivationList(ad.s_motivations ?? ad.t_motivations)))], "\u001e"),
    };
  });
}

/** Concepts' labels and tags (per edit) joined to their numbers (per sync). */
async function computeConcepts(db: D1Database): Promise<ConceptResult[]> {
  const [latest, numbers, targets, calls] = await Promise.all([getLatestDate(db), loadConceptNumbers(db), getTargets(db), loadCalls(db)]);
  const meta = { results: await conceptLabels(db) };
  const base = meta.results.flatMap((r) => {
    const n = numbers[String(r.id)];
    if (!n) return [];
    r.last_date = n.lastSpend;
    return [{ r, ...n }];
  });

  return base.map(({ r, firstSpend, qualifiedOn, windowEnd, window, allTime, status: own, lateWindow, turnedOff }) => {
    // The media buyer's call (on a miss) wins over the measured result.
    const call = calls.get(String(r.id)) ?? null;
    const measured: HitStatus = lateWindow ? "late_hit" : own;
    const status: HitStatus = call && measured === "miss" ? call.kind : measured;
    const manualAwareness = r.manual_awareness == null ? null : String(r.manual_awareness);
    const manualBelief = r.manual_belief == null ? null : String(r.manual_belief);
    const awareness = manualAwareness ?? mode(list(r.awareness_list));
    const personaId = r.manual_persona == null ? mode(list(r.persona_list)) : String(r.manual_persona);
    const lastSpend = r.last_date == null ? null : String(r.last_date);
    const guess = classify({
      label: String(r.label),
      adset: String(r.adset_name),
      ads: r.ad_names == null ? [] : String(r.ad_names).split("\n"),
    });
    const manualAngle = r.manual_angle == null ? null : String(r.manual_angle);
    const manualFormat = r.manual_format == null ? null : String(r.manual_format);
    return {
      angle: manualAngle ?? guess.angle,
      format: manualFormat ?? guess.format,
      tagsSource: manualAngle || manualFormat ? ("manual" as const) : ("name" as const),
      ...atriaUnion(r.atria_tags),
      awareness,
      awarenessSource: manualAwareness ? ("manual" as const) : awareness ? ("claude" as const) : null,
      beliefGroups: manualBelief ? [manualBelief] : [...new Set(list(r.belief_group_list))],
      beliefs: [...new Set(list(r.belief_list))].slice(0, 3),
      personaId,
      motivations: list(r.motivations_list).sort(),
      conceptId: String(r.id),
      podId: String(r.pod_id),
      coPodId: r.co_pod_id == null ? null : String(r.co_pod_id),
      label: String(r.label),
      adsetName: String(r.adset_name),
      ads: Number(r.ads),
      firstSpend,
      qualifiedOn,
      windowEnd,
      window,
      allTime,
      status,
      call: status === measured ? null : call,
      candidate: status === "miss" ? winnerCandidate({ status, allTime, firstSpend, lastSpend }, targets) : null,
      lateWindow,
      turnedOff,
      lastSpend,
      // Spent in the last 3 synced days.
      stillRunning: lastSpend != null && latest != null && lastSpend >= shiftDay(latest, -2),
    };
  });
}

/** Totals over each post's first `windowDays` days of spend, plus how many days have been observed. */
async function testWindows(db: D1Database, windowDays: number, postId?: string) {
  const { results } = await db
    .prepare(
      `WITH first AS (${postFirstSpendSql(postId ? "WHERE a.post_id = ?2" : "")})
       SELECT f.post_id, f.first_date, ${TOTALS_SQL}
       FROM first f
       JOIN ads a ON a.post_id = f.post_id
       JOIN ad_daily d ON d.ad_id = a.id
         AND d.date >= f.first_date AND d.date < date(f.first_date, '+' || ?1 || ' days')
       GROUP BY f.post_id`,
    )
    .bind(...(postId ? [windowDays, postId] : [windowDays]))
    .all<Row>();
  return new Map(results.map((r) => [String(r.post_id), { firstDate: String(r.first_date), totals: toTotals(r) }]));
}

function toAssignment(r: Row): Assignment {
  const s = (k: string) => (r[k] == null ? null : String(r[k]));
  return {
    podId: s("pod_id"),
    podSource: s("pod_source"),
    coPodId: s("co_pod_id"),
    editorId: s("editor_id"),
    editorName: s("editor_name"),
    angle: s("angle"),
    format: s("format"),
    hook: s("hook"),
    landingPage: s("landing_page"),
    tagsSource: s("tags_source"),
    awareness: s("awareness"),
    beliefGroup: s("belief_group"),
    personaId: s("persona_id"),
    offer: r.offer == null ? null : Number(r.offer) === 1,
    motivations: r.motivations == null ? null : motivationList(r.motivations),
  };
}

/** Each post's totals in [from, to] (each ad's days by key). */
async function postRangeTotals(db: D1Database, from: string, to: string, postId?: string): Promise<Map<string, Totals>> {
  const { results } = await db
    .prepare(
      `SELECT a.post_id, ${TOTALS_SQL}
       FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id
       WHERE d.date BETWEEN ?1 AND ?2 ${postId ? "AND a.post_id = ?3" : ""}
       GROUP BY a.post_id`,
    )
    .bind(...(postId ? [from, to, postId] : [from, to]))
    .all<Row>();
  return new Map(results.map((r) => [String(r.post_id), toTotals(r)]));
}

/** Every post's totals in [from, to], once per sync for each range (edits don't change them). */
export function loadPostRangeTotals(db: D1Database, from: string, to: string): Promise<Map<string, Totals>> {
  return memoizeMap(db, `post-range-${from}-${to}`, () => postRangeTotals(db, from, to), { durable: true, scope: "stats" });
}

/** Posts with spend in [from, to] that no pod or the agency is credited with: count and spend. */
export async function untaggedSpend(db: D1Database, from: string, to: string): Promise<{ posts: number; spendCents: number }> {
  const [totals, tagged] = await Promise.all([
    loadPostRangeTotals(db, from, to),
    db.prepare("SELECT post_id FROM assignments WHERE pod_id IS NOT NULL").all<{ post_id: string }>(),
  ]);
  const credited = new Set(tagged.results.map((r) => r.post_id));
  let posts = 0;
  let spendCents = 0;
  for (const [postId, t] of totals) {
    if (t.spendCents <= 0 || credited.has(postId)) continue;
    posts++;
    spendCents += t.spendCents;
  }
  return { posts, spendCents };
}

/** Every post with its totals in [from, to] and its initial-test verdict. */
export async function loadPosts(db: D1Database, from: string, to: string, opts: { postId?: string; concepts?: ConceptResult[] } = {}): Promise<PostSummary[]> {
  const [targets, latest, concepts] = await Promise.all([getTargets(db), getLatestDate(db), opts.concepts ?? loadConcepts(db)]);
  const conceptStatus = new Map(concepts.map((c) => [c.conceptId, c.status]));
  const [base, ranged, windows, fatigueByPost] = await Promise.all([
    // Labels and tags: once per edit. The numbers: once per sync (stats version, see cache.ts).
    opts.postId ? loadPostBase(db, opts.postId) : memoize(db, "post-base", () => loadPostBase(db), { durable: true }),
    opts.postId ? postRangeTotals(db, from, to, opts.postId) : loadPostRangeTotals(db, from, to),
    opts.postId
      ? testWindows(db, targets.testWindowDays, opts.postId)
      : memoizeMap(db, `post-windows-${targets.testWindowDays}`, () => testWindows(db, targets.testWindowDays), { durable: true, scope: "stats" }),
    loadFatigue(db, targets, latest),
  ]);
  const totalsByPost = ranged;

  return base.map((r) => {
    const postId = String(r.post_id);
    const w = windows.get(postId);
    // A post's badge shows how the concept it was tested in did.
    const hit: HitStatus | null = r.concept_id == null ? null : (conceptStatus.get(String(r.concept_id)) ?? null);
    const launched = r.launched == null ? null : String(r.launched).slice(0, 10);
    return {
      postId,
      name: String(r.name ?? postId),
      adsetName: r.adset_name == null ? null : String(r.adset_name),
      mediaType: String(r.media_type),
      thumbnailUrl: r.thumbnail_url == null ? null : String(r.thumbnail_url),
      launched,
      firstSpend: w?.firstDate ?? null,
      // From launch (or first spend, if earlier): first spend alone stops at the start of the synced
      // history, so every older ad read "101 days live" (owner, Oct 28).
      daysLive: (() => {
        const from = [launched, w?.firstDate].filter((d): d is string => d != null).sort()[0];
        return from && latest ? daysBetween(from, latest) + 1 : null;
      })(),
      copies: Number(r.copies),
      active: Number(r.active) === 1,
      scaling: Number(r.scaling) === 1,
      assignment: toAssignment(r),
      totals: totalsByPost.get(postId) ?? toTotals(undefined),
      hit,
      conceptId: r.concept_id == null ? null : String(r.concept_id),
      atria: r.atria_tags == null ? null : (JSON.parse(String(r.atria_tags)) as Record<string, string[]>),
      fatigue: fatigueByPost.get(postId) ?? null,
      labels: {
        awareness: r.l_awareness == null ? null : String(r.l_awareness),
        personaId: r.l_persona == null ? null : String(r.l_persona),
        offer: r.l_offer == null ? null : Number(r.l_offer) === 1,
        motivations: r.l_motivations == null ? null : motivationList(r.l_motivations),
        format: r.l_format == null ? null : String(r.l_format),
      },
    };
  });
}
