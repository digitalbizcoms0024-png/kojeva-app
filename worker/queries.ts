import type { Assignment, ConceptResult, PostSummary } from "../shared/api.ts";
import { classify } from "../shared/classify.ts";
import { memoize } from "./cache.ts";
import { loadFatigue } from "./fatigue.ts";
import {
  addTotals,
  DEFAULT_TARGETS,
  hitStatus,
  judgingWindowEnd,
  lateHitWindow,
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
  COALESCE(SUM(d.revenue_cents), 0) AS revenue_cents`;

export function toTotals(r: Row | undefined): Totals {
  return {
    spendCents: Number(r?.spend_cents ?? 0),
    impressions: Number(r?.impressions ?? 0),
    linkClicks: Number(r?.link_clicks ?? 0),
    purchases: Number(r?.purchases ?? 0),
    revenueCents: Number(r?.revenue_cents ?? 0),
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
           s.pod_id, s.pod_source, s.editor_id, e.name AS editor_name,
           s.angle, s.format, s.hook, s.landing_page, s.tags_source, s.awareness, s.belief_group, s.persona_id, s.offer
         FROM posts p
         LEFT JOIN assignments s ON s.post_id = p.id
         LEFT JOIN editors e ON e.id = s.editor_id ${where}`,
      )
      .bind(...(postId ? [postId] : []))
      .all<Row>(),
    db
      .prepare(
        `SELECT x.id, x.post_id, x.name, x.status, x.created_time, x.concept_id, x.adset_name,
           t.status AS t_status, t.tags, t.labeled_at, t.awareness AS t_awareness, t.offer AS t_offer, t.persona_id AS t_persona
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
      launched: list.find((ad) => ad.created_time != null)?.created_time ?? null,
      concept_id: first?.concept_id ?? null,
      adset_name: first?.adset_name ?? null,
      atria_tags: find((ad) => ad.t_status === "tagged")?.tags ?? null,
      l_awareness: find((ad) => ad.labeled_at != null)?.t_awareness ?? null,
      l_offer: find((ad) => ad.t_offer != null)?.t_offer ?? null,
      l_persona: find((ad) => ad.t_persona != null)?.t_persona ?? null,
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

/** The most common value (ties: first seen), or null. */
function mode(values: string[]): string | null {
  const n = new Map<string, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, c] of n) if (best == null || c > n.get(best)!) best = v;
  return best;
}

/** Every concept with its test-window totals and hit status (computed once per data version). */
export function loadConcepts(db: D1Database): Promise<ConceptResult[]> {
  return memoize(db, "concepts", () => computeConcepts(db), { durable: true });
}

async function computeConcepts(db: D1Database): Promise<ConceptResult[]> {
  const [targets, latest] = await Promise.all([getTargets(db), getLatestDate(db)]);
  const minSpend = targets.minTestSpend * 100;
  const [meta, rows] = await Promise.all([
    db
      .prepare(
        `SELECT c.id, c.pod_id, c.label, c.adset_name,
           (SELECT COUNT(*) FROM ads x WHERE x.concept_id = c.id) AS ads,
           (SELECT GROUP_CONCAT(x.name, char(10)) FROM ads x WHERE x.concept_id = c.id) AS ad_names,
           (SELECT GROUP_CONCAT(t.tags, char(30)) FROM ads x JOIN atria_assets t ON t.asset_id = x.asset_id
              WHERE x.concept_id = c.id AND t.status = 'tagged') AS atria_tags,
           (SELECT s.angle FROM ads x JOIN assignments s ON s.post_id = x.post_id
              WHERE x.concept_id = c.id AND s.tags_source = 'manual' AND s.angle IS NOT NULL LIMIT 1) AS manual_angle,
           (SELECT s.format FROM ads x JOIN assignments s ON s.post_id = x.post_id
              WHERE x.concept_id = c.id AND s.tags_source = 'manual' AND s.format IS NOT NULL LIMIT 1) AS manual_format,
           (SELECT GROUP_CONCAT(t.awareness, char(30)) FROM ads x JOIN atria_assets t ON t.asset_id = x.asset_id
              WHERE x.concept_id = c.id AND t.awareness IS NOT NULL) AS awareness_list,
           (SELECT GROUP_CONCAT(t.belief_group, char(30)) FROM ads x JOIN atria_assets t ON t.asset_id = x.asset_id
              WHERE x.concept_id = c.id AND t.belief_group IS NOT NULL) AS belief_group_list,
           (SELECT GROUP_CONCAT(t.belief, char(30)) FROM ads x JOIN atria_assets t ON t.asset_id = x.asset_id
              WHERE x.concept_id = c.id AND t.belief IS NOT NULL) AS belief_list,
           (SELECT s.awareness FROM ads x JOIN assignments s ON s.post_id = x.post_id
              WHERE x.concept_id = c.id AND s.awareness IS NOT NULL LIMIT 1) AS manual_awareness,
           (SELECT s.belief_group FROM ads x JOIN assignments s ON s.post_id = x.post_id
              WHERE x.concept_id = c.id AND s.belief_group IS NOT NULL LIMIT 1) AS manual_belief,
           (SELECT GROUP_CONCAT(t.persona_id, char(30)) FROM ads x JOIN atria_assets t ON t.asset_id = x.asset_id
              WHERE x.concept_id = c.id AND t.persona_id IS NOT NULL) AS persona_list,
           (SELECT s.persona_id FROM ads x JOIN assignments s ON s.post_id = x.post_id
              WHERE x.concept_id = c.id AND s.persona_id IS NOT NULL LIMIT 1) AS manual_persona
         FROM concepts c`,
      )
      .all<Row>(),
    // Every day of every ad in a concept, read once (ads first, then each ad's days by key; a window
    // function or GROUP BY here costs D1 several reads per row). Everything below is computed from it.
    db
      .prepare(
        `SELECT a.concept_id, a.id, d.date, d.spend_cents, d.impressions, d.link_clicks, d.purchases, d.revenue_cents
         FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id
         WHERE a.concept_id IS NOT NULL`,
      )
      .raw<[string, string, string, number, number, number, number, number]>(),
  ]);

  // Per concept: totals by day; per ad: running spend, for the day it reached the minimum.
  const days = new Map<string, Map<string, Totals>>();
  const adDays = new Map<string, { concept: string; days: [string, number][] }>();
  for (const [conceptId, adId, date, spendCents, impressions, linkClicks, purchases, revenueCents] of rows) {
    let byDay = days.get(conceptId);
    if (!byDay) days.set(conceptId, (byDay = new Map()));
    byDay.set(date, addTotals(byDay.get(date) ?? ZERO_TOTALS, { spendCents, impressions, linkClicks, purchases, revenueCents }));
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
  const series = new Map<string, ({ date: string } & Totals)[]>();
  for (const [id, byDay] of days) series.set(id, [...byDay].map(([date, t]) => ({ date, ...t })).sort((x, y) => x.date.localeCompare(y.date)));
  const sum = (list: ({ date: string } & Totals)[], from = "", to = "9999-12-31") =>
    list.reduce((acc, d) => (d.date >= from && d.date <= to ? addTotals(acc, d) : acc), ZERO_TOTALS);

  const allTime = new Map([...series].map(([id, list]) => [id, sum(list)]));
  const ends = meta.results.flatMap((r) => {
    const spent = (series.get(String(r.id)) ?? []).filter((d) => d.spendCents > 0);
    if (!spent.length) return [];
    const firstSpend = spent[0]!.date;
    r.last_date = spent[spent.length - 1]!.date;
    const qualifiedOn = qualified.get(String(r.id)) ?? null;
    return [{ r, firstSpend, qualifiedOn, windowEnd: judgingWindowEnd(firstSpend, qualifiedOn, targets) }];
  });

  const base = ends.map((e) => {
    const window = sum(series.get(String(e.r.id)) ?? [], e.firstSpend, e.windowEnd);
    const status = hitStatus(window, { qualified: e.qualifiedOn != null, complete: latest != null && latest >= e.windowEnd }, targets);
    return { ...e, window, status };
  });

  // Second look for day-3 misses that kept spending after their judging window.
  const late = new Map<string, { from: string; to: string; totals: Totals }>();
  for (const b of base) {
    if (!latest || b.status !== "miss" || String(b.r.last_date) <= b.windowEnd) continue;
    const w = lateHitWindow(series.get(String(b.r.id)) ?? [], b.firstSpend, b.windowEnd, latest, targets);
    if (w) late.set(String(b.r.id), w);
  }

  return base.map(({ r, firstSpend, qualifiedOn, windowEnd, window, status: own }) => {
    const lateWindow = late.get(String(r.id)) ?? null;
    const status: HitStatus = lateWindow ? "late_hit" : own;
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
      conceptId: String(r.id),
      podId: String(r.pod_id),
      label: String(r.label),
      adsetName: String(r.adset_name),
      ads: Number(r.ads),
      firstSpend,
      qualifiedOn,
      windowEnd,
      window,
      allTime: allTime.get(String(r.id)) ?? window,
      status,
      lateWindow,
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
  };
}

/** Every post with its totals in [from, to] and its initial-test verdict. */
export async function loadPosts(db: D1Database, from: string, to: string, opts: { postId?: string; concepts?: ConceptResult[] } = {}): Promise<PostSummary[]> {
  const [targets, latest, concepts] = await Promise.all([getTargets(db), getLatestDate(db), opts.concepts ?? loadConcepts(db)]);
  const conceptStatus = new Map(concepts.map((c) => [c.conceptId, c.status]));
  const [base, ranged, windows, fatigueByPost] = await Promise.all([
    // The range-independent parts are computed once per data version (see cache.ts).
    opts.postId ? loadPostBase(db, opts.postId) : memoize(db, "post-base", () => loadPostBase(db)),
    db
      .prepare(
        `SELECT a.post_id, ${TOTALS_SQL}
         FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id
         WHERE d.date BETWEEN ?1 AND ?2 ${opts.postId ? "AND a.post_id = ?3" : ""}
         GROUP BY a.post_id`,
      )
      .bind(...(opts.postId ? [from, to, opts.postId] : [from, to]))
      .all<Row>(),
    opts.postId
      ? testWindows(db, targets.testWindowDays, opts.postId)
      : memoize(db, `post-windows-${targets.testWindowDays}`, () => testWindows(db, targets.testWindowDays)),
    loadFatigue(db, targets, latest),
  ]);
  const totalsByPost = new Map(ranged.results.map((r) => [String(r.post_id), toTotals(r)]));

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
      daysLive: w && latest ? daysBetween(w.firstDate, latest) + 1 : null,
      copies: Number(r.copies),
      active: Number(r.active) === 1,
      assignment: toAssignment(r),
      totals: totalsByPost.get(postId) ?? toTotals(undefined),
      hit,
      atria: r.atria_tags == null ? null : (JSON.parse(String(r.atria_tags)) as Record<string, string[]>),
      fatigue: fatigueByPost.get(postId) ?? null,
      labels: {
        awareness: r.l_awareness == null ? null : String(r.l_awareness),
        personaId: r.l_persona == null ? null : String(r.l_persona),
        offer: r.l_offer == null ? null : Number(r.l_offer) === 1,
      },
    };
  });
}
