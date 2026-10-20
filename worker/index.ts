import { Hono } from "hono";
import type {
  AlertsResponse,
  AttributionLevel,
  AttributionResponse,
  AttributionRow,
  ConceptDetail,
  ConceptsResponse,
  Editor,
  InsightsResponse,
  LaunchesResponse,
  CopyRow,
  MetaResponse,
  PodRow,
  PodsResponse,
  PostDetail,
  RankingsResponse,
  SortKey,
  SuggestionsResponse,
  TrendGrain,
  TrendsResponse,
} from "../shared/api.ts";
import { ZERO_TOTALS, addTotals, cpa, ctr, hitRate, isHit, roas, type Totals } from "../shared/metrics.ts";
import { DEFAULT_ATTRIBUTION, type AttributionSettings } from "../shared/attribution.ts";
import { GROUPS } from "../shared/taxonomy.ts";
import { accessConfigured, accessMiddleware } from "./access.ts";
import { bumpVersion, cachedResponse, cacheResponse, dataVersion, memoize, readSnapshot, writeSnapshot } from "./cache.ts";
import type { AppEnv, Env } from "./env.ts";
import { loadAlerts, loadSuggestions } from "./alerts.ts";
import { atria } from "./atria.ts";
import { report, reports } from "./report.ts";
import { calls, isMediaBuyer } from "./calls.ts";
import { editing } from "./editing.ts";
import { connection, sync } from "./meta/routes.ts";
import { adPreview, PREVIEW_FORMATS, type PreviewFormat } from "./meta/preview.ts";
import { runSync, utcDay } from "./meta/sync.ts";
import { loadHitCreatives } from "./hitsoff.ts";
import { baseline, INSIGHT_DIMENSIONS, insightRows, MATRIX_DIMENSIONS, matrix, overview, valuesOf } from "./insights.ts";
import { getLatestDate, getTargets, loadConcepts, loadPosts, untaggedSpend, shiftDay, toTotals, TOTALS_SQL } from "./queries.ts";
import { loadCoverage } from "./coverage.ts";
import { loadAddedPods } from "./pods.ts";
import { ensureAttributed } from "./rules.ts";
import { loadPersonas } from "./personas.ts";
import { canEditWith, loadEditAccess } from "./roles.ts";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", accessMiddleware);

// Read routes are served from memory until the data changes; any successful write marks the
// data as changed. Connection, sync and ingest routes are never cached. See worker/cache.ts.
// Ad previews are fetched from Meta each time: their links expire.
const UNCACHED = /^\/api\/((connection|sync|ingest)(\/|$)|posts\/[^/]+\/preview$)/;
// Syncs and ingest pushes mark changes themselves, only when they wrote rows.
const SELF_BUMPING = /^\/api\/(sync|ingest)(\/|$)/;
app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  // Pods added in Settings, for name matching and validation in this request.
  await loadAddedPods(c.env.DB);
  // After a deploy that changed how ads are credited, re-credit once before answering.
  if (c.req.method === "GET" && !UNCACHED.test(path)) await ensureAttributed(c.env.DB);
  if (c.req.method !== "GET") {
    await next();
    if (c.res.status < 400 && !SELF_BUMPING.test(path)) await bumpVersion(c.env.DB).catch(() => undefined);
    return;
  }
  if (UNCACHED.test(path)) return next();
  // /meta includes who is signed in and the latest sync's status, so both go into its key.
  const extra =
    path === "/api/meta"
      ? `${c.get("userEmail") ?? ""}|${
          (await c.env.DB.prepare("SELECT id || ':' || status AS s FROM sync_runs ORDER BY id DESC LIMIT 1").first<{ s: string }>())?.s ?? ""
        }`
      : "";
  const version = await dataVersion(c.env.DB);
  const url = new URL(c.req.url);
  // Keyed by the deployed version too: a deploy that changes a response's shape must not serve the old one.
  const stored = `resp:${c.env.CF_VERSION_METADATA?.id ?? ""}|${url.pathname}${url.search}|${extra}`;
  const key = `${version}|${stored}`;
  const json = { "Content-Type": "application/json; charset=UTF-8" };
  const hit = cachedResponse(key);
  if (hit !== undefined) return c.body(hit, 200, { ...json, "X-Cache": "hit" });
  // Another isolate may already have computed it for this data version (1 row read).
  const shared = await readSnapshot(c.env.DB, stored, version);
  if (shared !== undefined) {
    cacheResponse(key, shared);
    return c.body(shared, 200, { ...json, "X-Cache": "stored" });
  }
  await next();
  if (c.res.status === 200) {
    const body = await c.res.clone().text();
    cacheResponse(key, body);
    await writeSnapshot(c.env.DB, stored, version, body);
  }
});
app.route("/connection", connection);
app.route("/sync", sync);
app.route("/ingest/atria", atria);
app.route("/ingest/report", report);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const groupOrder = (id: string) => {
  const i = GROUPS.findIndex((g) => g.id === id);
  return i < 0 ? GROUPS.length : i;
};

/** Resolves ?range=week|month|all|custom&from=&to= against the latest synced day. */
async function resolveRange(db: D1Database, q: (k: string) => string | undefined) {
  const latest = (await getLatestDate(db)) ?? new Date().toISOString().slice(0, 10);
  const range = q("range") ?? "month";
  if (range === "custom") {
    const from = q("from");
    const to = q("to");
    if (!from || !to || !DAY.test(from) || !DAY.test(to) || from > to) return null;
    return { from, to };
  }
  if (range === "week") return { from: shiftDay(latest, -6), to: latest };
  if (range === "14d") return { from: shiftDay(latest, -13), to: latest };
  if (range === "mtd") return { from: `${latest.slice(0, 7)}-01`, to: latest };
  if (range === "all") return { from: "2000-01-01", to: latest };
  return { from: shiftDay(latest, -29), to: latest };
}

const SORTERS: Record<SortKey, (t: Totals) => number | null> = {
  spend: (t) => t.spendCents,
  purchases: (t) => t.purchases,
  roas,
  ctr,
  // Lower CPA is better, so negate it to keep "descending = best first".
  cpa: (t) => {
    const v = cpa(t);
    return v == null ? null : -v;
  },
};

app.get("/meta", async (c) => {
  const db = c.env.DB;
  const [targets, latestDate, lastRun, pods, live, conn, attr, detected, editors, untagged, personas, editAccess] = await Promise.all([
    getTargets(db),
    getLatestDate(db),
    db
      .prepare("SELECT source, finished_at, status, message FROM sync_runs ORDER BY id DESC LIMIT 1")
      .first<{ source: string; finished_at: string | null; status: string; message: string | null }>(),
    db.prepare("SELECT id, code, name, color, kind, prefix, slot FROM pods ORDER BY kind DESC, name").all<MetaResponse["pods"][number]>(),
    db.prepare("SELECT 1 AS x FROM sync_runs WHERE source = 'meta' AND status = 'ok' LIMIT 1").first(),
    db.prepare("SELECT expires_at FROM meta_connections WHERE id = 1").first<{ expires_at: string | null }>(),
    db.prepare("SELECT value FROM settings WHERE key = 'attribution'").first<{ value: string }>(),
    db.prepare("SELECT value FROM settings WHERE key = 'pods_start_detected'").first<{ value: string }>(),
    db.prepare("SELECT id, name, pod_id AS podId FROM editors ORDER BY name").all<Editor>(),
    getLatestDate(db).then((l) => (l ? untaggedSpend(db, shiftDay(l, -29), l) : { posts: 0, spendCents: 0 })),
    loadPersonas(db),
    loadEditAccess(db),
  ]);
  const attribution = { ...DEFAULT_ATTRIBUTION, ...(attr ? (JSON.parse(attr.value) as Partial<AttributionSettings>) : {}) };
  const body: MetaResponse = {
    dataMode: live ? "live" : "sample",
    connectionExpiresInDays: conn?.expires_at && !c.env.META_SYSTEM_TOKEN ? Math.floor((Date.parse(conn.expires_at) - Date.now()) / 86_400_000) : null,
    accessProtected: accessConfigured(c.env),
    lastSync: lastRun ? { source: lastRun.source, finishedAt: lastRun.finished_at, status: lastRun.status, message: lastRun.message } : null,
    latestDate,
    targets,
    // Always Harris, Dhia, Shameer, Ali, then the agency.
    pods: [...pods.results].sort((a, b) => groupOrder(a.id) - groupOrder(b.id)),
    attribution: {
      agencyPrefixes: attribution.agencyPrefixes,
      podsStartDate: attribution.podsStartDate ?? (detected ? (JSON.parse(detected.value) as string | null) : null),
      detected: !attribution.podsStartDate,
    },
    editors: editors.results,
    canEdit: canEditWith(c.env, c.get("userEmail"), editAccess),
    viewer: c.get("userEmail"),
    isMediaBuyer: isMediaBuyer(c.env, c.get("userEmail")),
    // The list itself is for editors only.
    editAccess: canEditWith(c.env, c.get("userEmail"), editAccess) ? editAccess : [],
    needsTagging: untagged.posts,
    personas,
  };
  return c.json(body);
});

app.get("/alerts", async (c) => {
  const body: AlertsResponse = await loadAlerts(c.env.DB);
  return c.json(body);
});

/** Likely pods for unassigned posts. Never applied automatically. */
app.get("/suggestions", async (c) => {
  const editors = await c.env.DB.prepare("SELECT id, name, pod_id AS podId FROM editors ORDER BY name").all<Editor>();
  const body: SuggestionsResponse = { suggestions: await loadSuggestions(c.env.DB, editors.results) };
  return c.json(body);
});

app.get("/rankings", async (c) => {
  const range = await resolveRange(c.env.DB, (k) => c.req.query(k));
  if (!range) return c.json({ error: "Invalid custom date range" }, 400);
  const sort = (c.req.query("sort") ?? "spend") as SortKey;
  const sorter = SORTERS[sort] ?? SORTERS.spend;
  const pod = c.req.query("pod") ?? "all";
  const status = c.req.query("status") ?? "all";
  const search = (c.req.query("q") ?? "").trim().toLowerCase();
  const limit = Math.min(Number(c.req.query("limit") ?? 500) || 500, 2000);

  let items = await loadPosts(c.env.DB, range.from, range.to);
  if (status === "hits_off") {
    // Every winner that no longer runs anywhere, whatever the range spent (its test post, with the hit badge).
    const latest = await getLatestDate(c.env.DB);
    const off = latest ? (await loadHitCreatives(c.env.DB, await loadConcepts(c.env.DB), latest)).filter((h) => h.offEverywhere) : [];
    const ids = new Set(off.flatMap((h) => h.testPosts));
    items = items.filter((p) => ids.has(p.postId));
  } else items = items.filter((p) => p.totals.spendCents > 0);
  if (pod === "unassigned") items = items.filter((p) => !p.assignment.podId);
  else if (pod !== "all") items = items.filter((p) => p.assignment.podId === pod);
  const format = c.req.query("format");
  const angle = c.req.query("angle");
  if (format) items = items.filter((p) => p.assignment.format === format);
  if (angle) items = items.filter((p) => p.assignment.angle === angle);
  if (status === "active") items = items.filter((p) => p.active);
  if (status === "paused") items = items.filter((p) => !p.active);
  if (status === "fatigued") items = items.filter((p) => p.fatigue);
  if (search)
    items = items.filter((p) => [p.name, p.assignment.editorName, p.assignment.angle, p.assignment.format].some((s) => s?.toLowerCase().includes(search)));

  // Posts with no value for the sort metric (e.g. CPA with 0 purchases) go last.
  items.sort((a, b) => {
    const va = sorter(a.totals);
    const vb = sorter(b.totals);
    if (va == null && vb == null) return b.totals.spendCents - a.totals.spendCents;
    if (va == null) return 1;
    if (vb == null) return -1;
    return vb - va || b.totals.spendCents - a.totals.spendCents;
  });

  const body: RankingsResponse = {
    ...range,
    totals: items.reduce((acc, p) => addTotals(acc, p.totals), ZERO_TOTALS),
    count: items.length,
    items: items.slice(0, limit),
  };
  return c.json(body);
});

/** Meta's preview of one of the post's ads, for the play button (?format=, default Facebook feed). */
app.get("/posts/:id/preview", async (c) => {
  const asked = c.req.query("format") as PreviewFormat | undefined;
  const format: PreviewFormat = asked && PREVIEW_FORMATS.includes(asked) ? asked : "MOBILE_FEED_STANDARD";
  const res = await adPreview(c.env, c.env.DB, c.req.param("id"), format);
  return "error" in res ? c.json({ error: res.error }, res.status) : c.json(res);
});

app.get("/posts/:id", async (c) => {
  const db = c.env.DB;
  const postId = c.req.param("id");
  const range = await resolveRange(db, (k) => c.req.query(k));
  if (!range) return c.json({ error: "Invalid custom date range" }, 400);

  const [summary] = await loadPosts(db, range.from, range.to, { postId });
  if (!summary) return c.json({ error: "Not found" }, 404);

  const [copies, daily, allTime] = await Promise.all([
    db
      .prepare(
        `SELECT a.id, a.name, a.campaign_name, a.adset_name, a.status, ${TOTALS_SQL}
         FROM ads a LEFT JOIN ad_daily d ON d.ad_id = a.id AND d.date BETWEEN ?2 AND ?3
         WHERE a.post_id = ?1 GROUP BY a.id ORDER BY spend_cents DESC`,
      )
      .bind(postId, range.from, range.to)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT d.date, ${TOTALS_SQL}
         FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id
         WHERE a.post_id = ?1 AND d.date BETWEEN ?2 AND ?3
         GROUP BY d.date ORDER BY d.date`,
      )
      .bind(postId, range.from, range.to)
      .all<Record<string, unknown>>(),
    db.prepare(`SELECT ${TOTALS_SQL} FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id WHERE a.post_id = ?1`).bind(postId).first<Record<string, unknown>>(),
  ]);

  const body: PostDetail = {
    ...summary,
    allTime: toTotals(allTime ?? undefined),
    copyRows: copies.results.map(
      (r): CopyRow => ({
        adId: String(r.id),
        name: String(r.name),
        campaignName: r.campaign_name == null ? null : String(r.campaign_name),
        adsetName: r.adset_name == null ? null : String(r.adset_name),
        status: String(r.status),
        totals: toTotals(r),
      }),
    ),
    daily: daily.results.map((r) => ({ date: String(r.date), ...toTotals(r) })),
  };
  return c.json(body);
});

app.get("/pods", async (c) => {
  const db = c.env.DB;
  const range = await resolveRange(db, (k) => c.req.query(k));
  if (!range) return c.json({ error: "Invalid custom date range" }, 400);
  const latest = await getLatestDate(db);
  const sparkDays = latest ? Array.from({ length: 7 }, (_, i) => shiftDay(latest, i - 6)) : [];
  const [posts, concepts, pods, daily] = await Promise.all([
    loadPosts(db, range.from, range.to),
    loadConcepts(db),
    db.prepare("SELECT id, name, color, kind FROM pods ORDER BY kind DESC, name").all<{ id: string; name: string; color: string; kind: "pod" | "agency" }>(),
    // Each post's spend per day (once per sync), grouped by the current pods below.
    memoize(
      db,
      `post-spark-${sparkDays[0] ?? ""}`,
      async () =>
        (
          await db
            .prepare(
              `SELECT a.post_id, d.date, SUM(d.spend_cents) AS spend_cents
               FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id
               WHERE d.date >= ?1 GROUP BY a.post_id, d.date`,
            )
            .bind(sparkDays[0] ?? "9999-12-31")
            .all<{ post_id: string; date: string; spend_cents: number }>()
        ).results,
      { durable: true, scope: "stats" },
    ),
  ]);
  const podOf = new Map(posts.map((p) => [p.postId, p.assignment.podId ?? ""]));
  const spendOn = new Map<string, number>();
  for (const r of daily) {
    const k = `${podOf.get(r.post_id) ?? ""}|${r.date}`;
    spendOn.set(k, (spendOn.get(k) ?? 0) + Number(r.spend_cents));
  }

  const groups: { podId: string | null; name: string; color: string | null; kind: PodRow["kind"] }[] = [
    ...pods.results.map((p) => ({ podId: p.id, name: p.name, color: p.color, kind: p.kind })),
    { podId: null, name: "Unassigned", color: null, kind: "unassigned" },
  ];

  // Concepts count toward the period in which they first spent.
  const inRange = concepts.filter((k) => k.firstSpend >= range.from && k.firstSpend <= range.to);

  const rows: PodRow[] = groups.map((g) => {
    const mine = posts.filter((p) => p.assignment.podId === g.podId);
    const launched = mine.filter((p) => p.firstSpend && p.firstSpend >= range.from && p.firstSpend <= range.to);
    const statuses = inRange.filter((k) => k.podId === g.podId).map((k) => k.status);
    const editors = new Map<string, PodRow["editors"][number]>();
    for (const p of mine) {
      const key = p.assignment.editorId ?? "";
      const e = editors.get(key) ?? {
        editorId: p.assignment.editorId,
        name: p.assignment.editorName ?? "No editor",
        totals: ZERO_TOTALS,
        concepts: 0,
      };
      e.totals = addTotals(e.totals, p.totals);
      if (launched.includes(p)) e.concepts++;
      editors.set(key, e);
    }
    return {
      ...g,
      totals: mine.reduce((acc, p) => addTotals(acc, p.totals), ZERO_TOTALS),
      concepts: statuses.length,
      hits: statuses.filter(isHit).length,
      lateHits: statuses.filter((s) => s === "late_hit").length,
      misses: statuses.filter((s) => s === "miss").length,
      testing: statuses.filter((s) => s === "testing").length,
      hitRate: hitRate(statuses),
      editors: [...editors.values()].sort((a, b) => b.totals.spendCents - a.totals.spendCents),
      spark: sparkDays.map((d) => spendOn.get(`${g.podId ?? ""}|${d}`) ?? 0),
    };
  });

  const body: PodsResponse = { ...range, rows };
  return c.json(body);
});

/** Concepts that started testing in the period (and pod): what Creative Insights counts. */
async function insightConcepts(db: D1Database, range: { from: string; to: string }, pod: string | undefined) {
  return (await loadConcepts(db)).filter((k) => k.firstSpend >= range.from && k.firstSpend <= range.to && (!pod || k.podId === pod));
}

/** Concept results grouped by one dimension. Same period rule as the Pods tab. */
app.get("/insights", async (c) => {
  const db = c.env.DB;
  const range = await resolveRange(db, (k) => c.req.query(k));
  if (!range) return c.json({ error: "Invalid custom date range" }, 400);
  const dimension = INSIGHT_DIMENSIONS.find((d) => d === c.req.query("dimension")) ?? "angle";
  const concepts = await insightConcepts(db, range, c.req.query("pod"));
  const body: InsightsResponse = { ...range, dimension, rows: insightRows(concepts, dimension), baseline: baseline(concepts) };
  return c.json(body);
});

/** What to make more of, and where test spend found nothing. */
app.get("/insights/overview", async (c) => {
  const db = c.env.DB;
  const range = await resolveRange(db, (k) => c.req.query(k));
  if (!range) return c.json({ error: "Invalid custom date range" }, 400);
  return c.json(overview(await insightConcepts(db, range, c.req.query("pod")), range));
});

/** Hit rate for each pair of two dimensions (default angle × format). */
app.get("/insights/matrix", async (c) => {
  const db = c.env.DB;
  const range = await resolveRange(db, (k) => c.req.query(k));
  if (!range) return c.json({ error: "Invalid custom date range" }, 400);
  const rows = MATRIX_DIMENSIONS.find((d) => d === c.req.query("rows")) ?? "angle";
  const cols = MATRIX_DIMENSIONS.find((d) => d === c.req.query("cols")) ?? "format";
  if (rows === cols) return c.json({ error: "Pick two different dimensions" }, 400);
  return c.json(matrix(await insightConcepts(db, range, c.req.query("pod")), rows, cols, range));
});

/**
 * Spend, purchases and revenue over time, by day or week (Monday start), for the account or one
 * pod (?pod=<id> or ?pod=unassigned).
 */
app.get("/trends", async (c) => {
  const db = c.env.DB;
  const range = await resolveRange(db, (k) => c.req.query(k));
  if (!range) return c.json({ error: "Invalid custom date range" }, 400);
  const span = Math.round((Date.parse(range.to) - Date.parse(range.from === "2000-01-01" ? range.to : range.from)) / 86_400_000);
  const grain: TrendGrain =
    c.req.query("grain") === "day" ? "day" : c.req.query("grain") === "week" || range.from === "2000-01-01" || span > 62 ? "week" : "day";
  const pod = c.req.query("pod") || null;
  const bucket = (col: string) => (grain === "week" ? `date(${col}, 'weekday 0', '-6 days')` : col);
  const podSql = pod === "unassigned" ? "AND s.pod_id IS NULL" : pod ? "AND s.pod_id = ?3" : "";
  const binds = pod && pod !== "unassigned" ? [range.from, range.to, pod] : [range.from, range.to];
  const query = () =>
    db
      .prepare(
        `SELECT ${bucket("d.date")} AS b, ${TOTALS_SQL}
         FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id ${pod ? "LEFT JOIN assignments s ON s.post_id = a.post_id" : ""}
         WHERE d.date BETWEEN ?1 AND ?2 ${podSql} GROUP BY b ORDER BY b`,
      )
      .bind(...binds)
      .all<Record<string, unknown>>();
  // The whole account doesn't depend on tags: once per sync. One pod's follows its tags: per edit.
  const meta = pod ? await query() : await memoize(db, `trend-${range.from}-${range.to}-${grain}`, query, { durable: true, scope: "stats" });
  const body: TrendsResponse = {
    ...range,
    grain,
    pod,
    points: meta.results.map((r) => ({ start: String(r.b), totals: toTotals(r) })),
  };
  return c.json(body);
});

const ATTR_SQL = `
  COALESCE(SUM(d.spend_cents), 0) AS spend_cents,
  COALESCE(SUM(d.purchases), 0) AS purchases,
  COALESCE(SUM(d.revenue_cents), 0) AS revenue_cents,
  COUNT(d.purchases_7dc) AS n7, SUM(d.purchases_7dc) AS p7, SUM(d.revenue_7dc_cents) AS r7,
  COUNT(d.purchases_inc_milli) AS ni, SUM(d.purchases_inc_milli) AS pi, SUM(d.revenue_inc_cents) AS ri,
  COALESCE(SUM(CASE WHEN d.purchases_inc_milli IS NOT NULL THEN d.spend_cents END), 0) AS covered`;

function toAttributionRow(r: Record<string, unknown>, key: string, label: string, podId: string | null): AttributionRow {
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    key,
    label,
    podId,
    spendCents: n("spend_cents"),
    standard: { purchases: n("purchases"), revenueCents: n("revenue_cents") },
    click7: n("n7") > 0 ? { purchases: n("p7"), revenueCents: n("r7") } : null,
    incremental: n("ni") > 0 ? { purchases: n("pi") / 1000, revenueCents: n("ri") } : null,
    coveredSpendCents: n("covered"),
  };
}

/**
 * Standard vs 7-day click vs incremental attribution on the same Meta spend, for the account and
 * by pod, concept or post (?level=pod|concept|post; posts limited to the top 200 by spend).
 */
app.get("/attribution", async (c) => {
  const db = c.env.DB;
  const range = await resolveRange(db, (k) => c.req.query(k));
  if (!range) return c.json({ error: "Invalid custom date range" }, 400);
  const levels: AttributionLevel[] = ["pod", "concept", "post"];
  const level = levels.find((l) => l === c.req.query("level")) ?? "pod";
  const group = { pod: "s.pod_id", concept: "a.concept_id", post: "a.post_id" }[level];
  // ?post= narrows the post level to one post (the Rankings detail panel).
  const post = level === "post" ? (c.req.query("post") ?? null) : null;
  const [total, grouped, labels] = await Promise.all([
    db.prepare(`SELECT ${ATTR_SQL} FROM ad_daily d WHERE d.date BETWEEN ?1 AND ?2`).bind(range.from, range.to).first<Record<string, unknown>>(),
    // SUM() in HAVING/ORDER BY on purpose: SQLite reads a bare spend_cents there as one row's
    // column, not the alias, which dropped any group with a zero-spend day.
    db
      .prepare(
        `SELECT ${group} AS k, MAX(s.pod_id) AS pod_id, ${ATTR_SQL}
         FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id LEFT JOIN assignments s ON s.post_id = a.post_id
         WHERE d.date BETWEEN ?1 AND ?2 ${level === "concept" ? "AND a.concept_id IS NOT NULL" : ""} ${post ? "AND a.post_id = ?3" : ""}
         GROUP BY k HAVING SUM(d.spend_cents) > 0 ORDER BY SUM(d.spend_cents) DESC ${level === "post" ? "LIMIT 200" : ""}`,
      )
      .bind(...(post ? [range.from, range.to, post] : [range.from, range.to]))
      .all<Record<string, unknown>>(),
    level === "concept"
      ? db.prepare("SELECT id AS k, label, pod_id FROM concepts").all<{ k: string; label: string; pod_id: string }>()
      : level === "post"
        ? db
            .prepare(
              "SELECT p.id AS k, (SELECT x.name FROM ads x WHERE x.post_id = p.id ORDER BY x.created_time, x.id LIMIT 1) AS label, NULL AS pod_id FROM posts p",
            )
            .all<{ k: string; label: string; pod_id: string | null }>()
        : db.prepare("SELECT id AS k, name AS label, id AS pod_id FROM pods").all<{ k: string; label: string; pod_id: string }>(),
  ]);
  const names = new Map(labels.results.map((l) => [l.k, l.label]));
  const body: AttributionResponse = {
    ...range,
    level,
    total: toAttributionRow(total ?? {}, "total", "Whole account", null),
    rows: grouped.results.map((r) => {
      const key = r.k == null ? "none" : String(r.k);
      const podId = r.pod_id == null ? null : String(r.pod_id);
      return toAttributionRow(r, key, r.k == null ? "Unassigned" : (names.get(key) ?? key), podId);
    }),
  };
  return c.json(body);
});

/** Monday of the week a day falls in. */
function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return shiftDay(day, -((d.getUTCDay() + 6) % 7));
}

/** Concepts launched (first spend) per pod per Monday–Sunday week; ?weeks=8 (max 26). */
app.get("/launches", async (c) => {
  const db = c.env.DB;
  const n = Math.min(Math.max(Number(c.req.query("weeks") ?? 8) || 8, 1), 26);
  const [latest, concepts, pods] = await Promise.all([
    getLatestDate(db),
    loadConcepts(db),
    db.prepare("SELECT id, name, kind FROM pods").all<{ id: string; name: string; kind: "pod" | "agency" }>(),
  ]);
  const current = mondayOf(latest ?? new Date().toISOString().slice(0, 10));
  const weeks = Array.from({ length: n }, (_, i) => shiftDay(current, (i - n + 1) * 7));
  const index = new Map(weeks.map((w, i) => [w, i]));
  const rows = [...pods.results]
    .sort((a, b) => groupOrder(a.id) - groupOrder(b.id))
    .map((p) => ({ podId: p.id, name: p.name, kind: p.kind, counts: weeks.map(() => 0) }));
  const byPod = new Map(rows.map((r) => [r.podId, r]));
  for (const k of concepts) {
    const i = index.get(mondayOf(k.firstSpend));
    const row = byPod.get(k.podId);
    if (i !== undefined && row) row.counts[i]!++;
  }
  const body: LaunchesResponse = { weeks, rows };
  return c.json(body);
});

/** Concepts that first spent in the range, newest first. ?pod=<id> narrows to one pod. */
/** One concept's card: its result, each of its ads, and its days (each ad's days read by key). */
app.get("/concepts/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const concept = (await loadConcepts(db)).find((k) => k.conceptId === id);
  if (!concept) return c.json({ error: "Concept not found" }, 404);
  const [ads, days] = await Promise.all([
    db
      .prepare(
        `SELECT a.id, a.post_id, a.name, a.status, a.campaign_name, p.media_type, p.thumbnail_url
         FROM ads a JOIN posts p ON p.id = a.post_id WHERE a.concept_id = ?1`,
      )
      .bind(id)
      .all<{ id: string; post_id: string; name: string; status: string; campaign_name: string | null; media_type: string; thumbnail_url: string | null }>(),
    db
      .prepare(
        `SELECT a.id, d.date, d.spend_cents, d.impressions, d.link_clicks, d.purchases, d.revenue_cents
         FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id WHERE a.concept_id = ?1`,
      )
      .bind(id)
      .all<Record<string, unknown>>(),
  ]);
  const zero = () => ({ ...ZERO_TOTALS });
  const perAd = new Map(ads.results.map((a) => [a.id, { window: zero(), allTime: zero() }]));
  const byDay = new Map<string, Totals>();
  for (const r of days.results) {
    const t = toTotals(r);
    const date = String(r.date);
    const ad = perAd.get(String(r.id));
    if (ad) {
      ad.allTime = addTotals(ad.allTime, t);
      if (date >= concept.firstSpend && date <= concept.windowEnd) ad.window = addTotals(ad.window, t);
    }
    byDay.set(date, addTotals(byDay.get(date) ?? ZERO_TOTALS, t));
  }
  const body: ConceptDetail = {
    concept,
    ads: ads.results
      .map((a) => ({
        adId: a.id,
        postId: a.post_id,
        name: a.name,
        status: a.status,
        campaignName: a.campaign_name,
        mediaType: a.media_type,
        thumbnailUrl: a.thumbnail_url,
        ...perAd.get(a.id)!,
      }))
      .sort((x, y) => y.allTime.spendCents - x.allTime.spendCents),
    daily: [...byDay]
      .filter(([, t]) => t.spendCents > 0 || t.purchases > 0)
      .map(([date, t]) => ({ date, ...t }))
      .sort((x, y) => x.date.localeCompare(y.date)),
  };
  return c.json(body);
});

app.get("/concepts", async (c) => {
  const db = c.env.DB;
  const range = await resolveRange(db, (k) => c.req.query(k));
  if (!range) return c.json({ error: "Invalid custom date range" }, 400);
  const pod = c.req.query("pod");
  // ?angle= / ?format= narrow to one tag; "none" means untagged.
  const tag = (q: string | undefined, v: string | null) => q === undefined || (q === "none" ? v === null : v === q);
  const angle = c.req.query("angle");
  const format = c.req.query("format");
  const many = (q: string | undefined, vs: string[]) => q === undefined || (q === "none" ? vs.length === 0 : vs.includes(q));
  const multi = (["atria_theme", "atria_desire", "atria_hook", "atria_persona", "belief", "motivation"] as const).map((d) => [d, c.req.query(d)] as const);
  const awareness = c.req.query("awareness");
  const persona = c.req.query("persona");
  const rows = (await loadConcepts(db))
    .filter(
      (k) =>
        k.firstSpend >= range.from &&
        k.firstSpend <= range.to &&
        (!pod || k.podId === pod) &&
        tag(angle, k.angle) &&
        tag(format, k.format) &&
        tag(awareness, k.awareness) &&
        tag(persona, k.personaId) &&
        multi.every(([d, q]) => many(q, valuesOf(k, d).filter((v): v is string => v != null))),
    )
    .sort((a, b) => b.firstSpend.localeCompare(a.firstSpend) || b.window.spendCents - a.window.spendCents);
  const body: ConceptsResponse = { ...range, rows };
  return c.json(body);
});

/** Running ads by persona × awareness level (?range, ?pod). */
app.get("/coverage", async (c) => {
  const range = await resolveRange(c.env.DB, (k) => c.req.query(k));
  if (!range) return c.json({ error: "Invalid custom date range" }, 400);
  return c.json(await loadCoverage(c.env.DB, range.from, range.to, c.req.query("pod") || undefined));
});

// Mounted last so the read routes above take precedence.
app.route("/reports", reports);
app.route("/", calls);
app.route("/", editing);

app.notFound((c) => c.json({ error: "Not found" }, 404));

// Errors come back as JSON the page can show. D1's free-plan daily limits get a plain explanation.
app.onError((err, c) => {
  const msg = err instanceof Error ? err.message : String(err);
  const limit = /limit|exceeded|quota/i.test(msg) && /D1|row|read|write|operation/i.test(msg);
  console.error(err);
  return c.json(
    {
      error: limit
        ? "The database's free daily limit is used up (Cloudflare D1). It resets at 00:00 UTC; the hub works again after that."
        : `Server error: ${msg || "unknown"}`,
    },
    limit ? 503 : 500,
  );
});

export default {
  fetch: app.fetch,
  /** Nightly: refresh ads and re-pull the last 7 days (Meta keeps revising recent days). */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSync(env, { since: utcDay(-6), until: utcDay(0), ads: true }));
  },
} satisfies ExportedHandler<Env>;
