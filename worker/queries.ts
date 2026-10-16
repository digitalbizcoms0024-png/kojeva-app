import type { Assignment, ConceptResult, PostSummary } from "../shared/api.ts";
import { DEFAULT_TARGETS, hitStatus, judgingWindowEnd, type HitStatus, type Targets, type Totals } from "../shared/metrics.ts";

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

/** Post-level facts that don't depend on the selected date range. */
const POST_BASE_SQL = `
  SELECT p.id AS post_id, p.media_type, p.thumbnail_url,
    (SELECT x.name FROM ads x WHERE x.post_id = p.id ORDER BY x.created_time, x.id LIMIT 1) AS name,
    (SELECT COUNT(*) FROM ads x WHERE x.post_id = p.id) AS copies,
    (SELECT MAX(x.status = 'ACTIVE') FROM ads x WHERE x.post_id = p.id) AS active,
    (SELECT MIN(x.created_time) FROM ads x WHERE x.post_id = p.id) AS launched,
    (SELECT x.concept_id FROM ads x WHERE x.post_id = p.id ORDER BY x.created_time, x.id LIMIT 1) AS concept_id,
    (SELECT x.adset_name FROM ads x WHERE x.post_id = p.id ORDER BY x.created_time, x.id LIMIT 1) AS adset_name,
    s.pod_id, s.pod_source, s.editor_id, e.name AS editor_name,
    s.angle, s.format, s.hook, s.landing_page, s.tags_source
  FROM posts p
  LEFT JOIN assignments s ON s.post_id = p.id
  LEFT JOIN editors e ON e.id = s.editor_id`;

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
    return {
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
  const [base, ranged, windows] = await Promise.all([
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
  ]);
  const totalsByPost = new Map(ranged.results.map((r) => [String(r.post_id), toTotals(r)]));

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
    };
  });
}
