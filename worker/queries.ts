import type { Assignment, PostSummary } from "../shared/api.ts";
import { DEFAULT_TARGETS, hitStatus, type HitStatus, type Targets, type Totals } from "../shared/metrics.ts";

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
  SELECT p.id AS post_id, p.media_type, p.thumbnail_key,
    (SELECT x.name FROM ads x WHERE x.post_id = p.id ORDER BY x.created_time, x.id LIMIT 1) AS name,
    (SELECT COUNT(*) FROM ads x WHERE x.post_id = p.id) AS copies,
    (SELECT MAX(x.status = 'ACTIVE') FROM ads x WHERE x.post_id = p.id) AS active,
    (SELECT MIN(x.created_time) FROM ads x WHERE x.post_id = p.id) AS launched,
    s.pod_id, s.pod_source, s.editor_id, e.name AS editor_name,
    s.angle, s.format, s.hook, s.landing_page
  FROM posts p
  LEFT JOIN assignments s ON s.post_id = p.id
  LEFT JOIN editors e ON e.id = s.editor_id`;

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
  };
}

/** Every post with its totals in [from, to] and its initial-test verdict. */
export async function loadPosts(
  db: D1Database,
  from: string,
  to: string,
  opts: { postId?: string } = {},
): Promise<PostSummary[]> {
  const [targets, latest] = await Promise.all([getTargets(db), getLatestDate(db)]);
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
    let hit: HitStatus | null = null;
    if (w && latest) hit = hitStatus(w.totals, daysBetween(w.firstDate, latest) + 1, targets);
    const launched = r.launched == null ? null : String(r.launched).slice(0, 10);
    return {
      postId,
      name: String(r.name ?? postId),
      mediaType: String(r.media_type),
      thumbnailUrl: r.thumbnail_key ? `/api/thumbnails/${encodeURIComponent(String(r.thumbnail_key))}` : null,
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
