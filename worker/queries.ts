import type { Assignment, ConceptResult, PostSummary, TwCoverage } from "../shared/api.ts";
import { classify } from "../shared/classify.ts";
import { DEFAULT_TARGETS, hitStatus, judgingWindowEnd, type HitStatus, type Targets, type Totals, type TwTotals } from "../shared/metrics.ts";

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

/** Days in [from, to] that have Meta data, and how many of them Triple Whale has been synced for. */
export async function twCoverage(db: D1Database, from: string, to: string): Promise<TwCoverage> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS days, COUNT(t.date) AS covered, MAX(t.model) AS model
       FROM (SELECT DISTINCT date FROM ad_daily WHERE date BETWEEN ?1 AND ?2) m
       LEFT JOIN tw_days t ON t.date = m.date`,
    )
    .bind(from, to)
    .first<{ days: number; covered: number; model: string | null }>();
  return { days: Number(row?.days ?? 0), covered: Number(row?.covered ?? 0), model: row?.model ?? null };
}

export function toTw(r: Row | undefined): TwTotals {
  return { purchases: Number(r?.orders_milli ?? 0) / 1000, revenueCents: Number(r?.revenue_cents ?? 0) };
}

/** Post-level facts that don't depend on the selected date range. */
const POST_BASE_SQL = `
  SELECT p.id AS post_id, p.media_type, p.thumbnail_url,
    (SELECT x.name FROM ads x WHERE x.post_id = p.id ORDER BY x.created_time, x.id LIMIT 1) AS name,
    (SELECT COUNT(*) FROM ads x WHERE x.post_id = p.id) AS copies,
    (SELECT MAX(x.status = 'ACTIVE') FROM ads x WHERE x.post_id = p.id) AS active,
    (SELECT MIN(x.created_time) FROM ads x WHERE x.post_id = p.id) AS launched,
    (SELECT x.concept_id FROM ads x WHERE x.post_id = p.id ORDER BY x.created_time, x.id LIMIT 1) AS concept_id,
    (SELECT x.adset_name FROM ads x WHERE x.post_id = p.id ORDER BY x.created_time, x.id LIMIT 1) AS adset_name,
    (SELECT t.tags FROM ads x JOIN atria_assets t ON t.asset_id = x.asset_id
       WHERE x.post_id = p.id AND t.status = 'tagged' ORDER BY x.created_time, x.id LIMIT 1) AS atria_tags,
    s.pod_id, s.pod_source, s.editor_id, e.name AS editor_name,
    s.angle, s.format, s.hook, s.landing_page, s.tags_source
  FROM posts p
  LEFT JOIN assignments s ON s.post_id = p.id
  LEFT JOIN editors e ON e.id = s.editor_id`;

/** Themes and core desires across a concept's Atria-tagged assets (GROUP_CONCAT of JSON, \x1e-separated). */
function atriaUnion(raw: unknown): { atriaThemes: string[]; atriaDesires: string[] } {
  const themes = new Set<string>();
  const desires = new Set<string>();
  if (raw != null)
    for (const json of String(raw).split("\x1e")) {
      const t = JSON.parse(json) as Record<string, string[]>;
      for (const v of t.theme ?? []) themes.add(v);
      for (const v of t.core_desire ?? []) desires.add(v);
    }
  return { atriaThemes: [...themes], atriaDesires: [...desires] };
}

/** Every concept with its test-window totals and hit status. */
export async function loadConcepts(db: D1Database): Promise<ConceptResult[]> {
  const [targets, latest] = await Promise.all([getTargets(db), getLatestDate(db)]);
  const [bounds, all] = await Promise.all([
    // First spend, and the first day any single ad's running spend reached the minimum.
    db
      .prepare(
        `WITH daily AS (
           SELECT a.concept_id, d.date, d.spend_cents,
             SUM(d.spend_cents) OVER (PARTITION BY d.ad_id ORDER BY d.date) AS running
           FROM ad_daily d JOIN ads a ON a.id = d.ad_id
           WHERE a.concept_id IS NOT NULL)
         SELECT c.id, c.pod_id, c.label, c.adset_name,
           (SELECT COUNT(*) FROM ads x WHERE x.concept_id = c.id) AS ads,
           (SELECT GROUP_CONCAT(x.name, char(10)) FROM ads x WHERE x.concept_id = c.id) AS ad_names,
           (SELECT GROUP_CONCAT(t.tags, char(30)) FROM ads x JOIN atria_assets t ON t.asset_id = x.asset_id
              WHERE x.concept_id = c.id AND t.status = 'tagged') AS atria_tags,
           (SELECT s.angle FROM ads x JOIN assignments s ON s.post_id = x.post_id
              WHERE x.concept_id = c.id AND s.tags_source = 'manual' AND s.angle IS NOT NULL LIMIT 1) AS manual_angle,
           (SELECT s.format FROM ads x JOIN assignments s ON s.post_id = x.post_id
              WHERE x.concept_id = c.id AND s.tags_source = 'manual' AND s.format IS NOT NULL LIMIT 1) AS manual_format,
           MIN(CASE WHEN daily.spend_cents > 0 THEN daily.date END) AS first_date,
           MIN(CASE WHEN daily.running >= ?1 THEN daily.date END) AS qualified_on
         FROM concepts c JOIN daily ON daily.concept_id = c.id
         GROUP BY c.id
         HAVING first_date IS NOT NULL`,
      )
      .bind(targets.minTestSpend * 100)
      .all<Row>(),
    db
      .prepare(
        `SELECT a.concept_id, ${TOTALS_SQL} FROM ad_daily d JOIN ads a ON a.id = d.ad_id
         WHERE a.concept_id IS NOT NULL GROUP BY a.concept_id`,
      )
      .all<Row>(),
  ]);
  const allTime = new Map(all.results.map((r) => [String(r.concept_id), toTotals(r)]));
  const ends = bounds.results.map((r) => {
    const firstSpend = String(r.first_date);
    const qualifiedOn = r.qualified_on == null ? null : String(r.qualified_on);
    return { r, firstSpend, qualifiedOn, windowEnd: judgingWindowEnd(firstSpend, qualifiedOn, targets) };
  });

  // Concept totals over each judging window. D1 allows at most 100 bound values per
  // statement, so 3 values per concept → 33 concepts per query.
  const windows = new Map<string, Totals>();
  for (let i = 0; i < ends.length; i += 33) {
    const chunk = ends.slice(i, i + 33);
    const values = chunk.map((_, j) => `(?${j * 3 + 1}, ?${j * 3 + 2}, ?${j * 3 + 3})`).join(", ");
    const { results } = await db
      .prepare(
        `WITH w(concept_id, first_date, end_date) AS (VALUES ${values})
         SELECT w.concept_id, ${TOTALS_SQL}
         FROM w JOIN ads a ON a.concept_id = w.concept_id
         JOIN ad_daily d ON d.ad_id = a.id AND d.date BETWEEN w.first_date AND w.end_date
         GROUP BY w.concept_id`,
      )
      .bind(...chunk.flatMap((e) => [String(e.r.id), e.firstSpend, e.windowEnd]))
      .all<Row>();
    for (const row of results) windows.set(String(row.concept_id), toTotals(row));
  }

  return ends.map(({ r, firstSpend, qualifiedOn, windowEnd }) => {
    const window = windows.get(String(r.id)) ?? toTotals(undefined);
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
      status: hitStatus(window, { qualified: qualifiedOn != null, complete: latest != null && latest >= windowEnd }, targets),
    };
  });
}

/** Totals over each post's first `windowDays` days of spend, plus how many days have been observed. */
async function testWindows(db: D1Database, windowDays: number, postId?: string) {
  const { results } = await db
    .prepare(
      `WITH first AS (
         SELECT a.post_id, MIN(d.date) AS first_date
         FROM ad_daily d JOIN ads a ON a.id = d.ad_id
         WHERE d.spend_cents > 0 ${postId ? "AND a.post_id = ?2" : ""}
         GROUP BY a.post_id)
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
  };
}

/** Every post with its totals in [from, to] and its initial-test verdict. */
export async function loadPosts(
  db: D1Database,
  from: string,
  to: string,
  opts: { postId?: string } = {},
): Promise<PostSummary[]> {
  const [targets, latest, concepts] = await Promise.all([getTargets(db), getLatestDate(db), loadConcepts(db)]);
  const conceptStatus = new Map(concepts.map((c) => [c.conceptId, c.status]));
  const where = opts.postId ? "WHERE p.id = ?1" : "";
  const [base, ranged, windows, twRows, coverage] = await Promise.all([
    db.prepare(`${POST_BASE_SQL} ${where}`).bind(...(opts.postId ? [opts.postId] : [])).all<Row>(),
    db
      .prepare(
        `SELECT a.post_id, ${TOTALS_SQL}
         FROM ad_daily d JOIN ads a ON a.id = d.ad_id
         WHERE d.date BETWEEN ?1 AND ?2 ${opts.postId ? "AND a.post_id = ?3" : ""}
         GROUP BY a.post_id`,
      )
      .bind(...(opts.postId ? [from, to, opts.postId] : [from, to]))
      .all<Row>(),
    testWindows(db, targets.testWindowDays, opts.postId),
    db
      .prepare(
        `SELECT a.post_id, SUM(t.orders_milli) AS orders_milli, SUM(t.revenue_cents) AS revenue_cents
         FROM tw_daily t JOIN ads a ON a.id = t.ad_id
         WHERE t.date BETWEEN ?1 AND ?2 ${opts.postId ? "AND a.post_id = ?3" : ""}
         GROUP BY a.post_id`,
      )
      .bind(...(opts.postId ? [from, to, opts.postId] : [from, to]))
      .all<Row>(),
    twCoverage(db, from, to),
  ]);
  const totalsByPost = new Map(ranged.results.map((r) => [String(r.post_id), toTotals(r)]));
  const twByPost = new Map(twRows.results.map((r) => [String(r.post_id), toTw(r)]));
  // No synced Triple Whale day in the period: unknown, not zero.
  const twKnown = coverage.covered > 0;

  return base.results.map((r) => {
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
      tw: twKnown ? (twByPost.get(postId) ?? toTw(undefined)) : null,
    };
  });
}
