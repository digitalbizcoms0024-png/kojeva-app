import { Hono } from "hono";
import type {
  AlertsResponse,
  ConceptsResponse,
  Editor,
  InsightDimension,
  InsightRow,
  InsightsResponse,
  CopyRow,
  MetaResponse,
  PodRow,
  PodsResponse,
  PostDetail,
  RankingsResponse,
  SortKey,
  SuggestionsResponse,
} from "../shared/api.ts";
import { ZERO_TOTALS, ZERO_TW, addTotals, addTw, cpa, ctr, hitRate, roas, type Totals, type TwTotals } from "../shared/metrics.ts";
import { DEFAULT_ATTRIBUTION, type AttributionSettings } from "../shared/attribution.ts";
import { GROUPS } from "../shared/taxonomy.ts";
import { accessConfigured, accessMiddleware } from "./access.ts";
import type { AppEnv, Env } from "./env.ts";
import { loadAlerts, loadSuggestions } from "./alerts.ts";
import { atria } from "./atria.ts";
import { editing } from "./editing.ts";
import { connection, sync } from "./meta/routes.ts";
import { runSync, utcDay } from "./meta/sync.ts";
import { getLatestDate, getTargets, loadConcepts, loadPosts, shiftDay, toTotals, TOTALS_SQL, twCoverage } from "./queries.ts";
import { tripleWhale, twStatus } from "./triplewhale.ts";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", accessMiddleware);
app.route("/connection", connection);
app.route("/sync", sync);
app.route("/ingest/atria", atria);
app.route("/ingest/tw", tripleWhale);

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
  const [targets, latestDate, lastRun, pods, live, conn, attr, detected, editors, untagged, tw] = await Promise.all([
    getTargets(db),
    getLatestDate(db),
    db
      .prepare("SELECT source, finished_at, status, message FROM sync_runs ORDER BY id DESC LIMIT 1")
      .first<{ source: string; finished_at: string | null; status: string; message: string | null }>(),
    db
      .prepare("SELECT id, code, name, color, kind FROM pods ORDER BY kind DESC, name")
      .all<MetaResponse["pods"][number]>(),
    db.prepare("SELECT 1 AS x FROM sync_runs WHERE source = 'meta' AND status = 'ok' LIMIT 1").first(),
    db.prepare("SELECT expires_at FROM meta_connections WHERE id = 1").first<{ expires_at: string | null }>(),
    db.prepare("SELECT value FROM settings WHERE key = 'attribution'").first<{ value: string }>(),
    db.prepare("SELECT value FROM settings WHERE key = 'pods_start_detected'").first<{ value: string }>(),
    db.prepare("SELECT id, name, pod_id AS podId FROM editors ORDER BY name").all<Editor>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT a.post_id) AS n
         FROM ad_daily d JOIN ads a ON a.id = d.ad_id
         LEFT JOIN assignments s ON s.post_id = a.post_id
         WHERE d.date >= date((SELECT MAX(date) FROM ad_daily), '-29 days') AND d.spend_cents > 0 AND s.pod_id IS NULL`,
      )
      .first<{ n: number }>(),
    twStatus(db),
  ]);
  const attribution = { ...DEFAULT_ATTRIBUTION, ...(attr ? (JSON.parse(attr.value) as Partial<AttributionSettings>) : {}) };
  const body: MetaResponse = {
    dataMode: live ? "live" : "sample",
    connectionExpiresInDays:
      conn?.expires_at && !c.env.META_SYSTEM_TOKEN ? Math.floor((Date.parse(conn.expires_at) - Date.now()) / 86_400_000) : null,
    accessProtected: accessConfigured(c.env),
    lastSync: lastRun
      ? { source: lastRun.source, finishedAt: lastRun.finished_at, status: lastRun.status, message: lastRun.message }
      : null,
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
    canEdit: accessConfigured(c.env),
    viewer: c.get("userEmail"),
    needsTagging: Number(untagged?.n ?? 0),
    tripleWhale: tw,
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

  let items = (await loadPosts(c.env.DB, range.from, range.to)).filter((p) => p.totals.spendCents > 0);
  if (pod === "unassigned") items = items.filter((p) => !p.assignment.podId);
  else if (pod !== "all") items = items.filter((p) => p.assignment.podId === pod);
  const format = c.req.query("format");
  const angle = c.req.query("angle");
  if (format) items = items.filter((p) => p.assignment.format === format);
  if (angle) items = items.filter((p) => p.assignment.angle === angle);
  if (status === "active") items = items.filter((p) => p.active);
  if (status === "paused") items = items.filter((p) => !p.active);
  if (search)
    items = items.filter((p) =>
      [p.name, p.assignment.editorName, p.assignment.angle, p.assignment.format]
        .some((s) => s?.toLowerCase().includes(search)),
    );

  // Posts with no value for the sort metric (e.g. CPA with 0 purchases) go last.
  items.sort((a, b) => {
    const va = sorter(a.totals);
    const vb = sorter(b.totals);
    if (va == null && vb == null) return b.totals.spendCents - a.totals.spendCents;
    if (va == null) return 1;
    if (vb == null) return -1;
    return vb - va || b.totals.spendCents - a.totals.spendCents;
  });

  const sumTw = (list: typeof items): TwTotals | null =>
    list.some((p) => p.tw) ? list.reduce((acc, p) => addTw(acc, p.tw ?? ZERO_TW), ZERO_TW) : null;
  const body: RankingsResponse = {
    ...range,
    totals: items.reduce((acc, p) => addTotals(acc, p.totals), ZERO_TOTALS),
    tw: sumTw(items),
    twCoverage: await twCoverage(c.env.DB, range.from, range.to),
    count: items.length,
    items: items.slice(0, limit),
  };
  return c.json(body);
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
         FROM ad_daily d JOIN ads a ON a.id = d.ad_id
         WHERE a.post_id = ?1 AND d.date BETWEEN ?2 AND ?3
         GROUP BY d.date ORDER BY d.date`,
      )
      .bind(postId, range.from, range.to)
      .all<Record<string, unknown>>(),
    db
      .prepare(`SELECT ${TOTALS_SQL} FROM ad_daily d JOIN ads a ON a.id = d.ad_id WHERE a.post_id = ?1`)
      .bind(postId)
      .first<Record<string, unknown>>(),
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
    db
      .prepare("SELECT id, name, color, kind FROM pods ORDER BY kind DESC, name")
      .all<{ id: string; name: string; color: string; kind: "pod" | "agency" }>(),
    db
      .prepare(
        `SELECT s.pod_id, d.date, SUM(d.spend_cents) AS spend_cents
         FROM ad_daily d JOIN ads a ON a.id = d.ad_id LEFT JOIN assignments s ON s.post_id = a.post_id
         WHERE d.date >= ?1 GROUP BY s.pod_id, d.date`,
      )
      .bind(sparkDays[0] ?? "9999-12-31")
      .all<{ pod_id: string | null; date: string; spend_cents: number }>(),
  ]);
  const spendOn = new Map(daily.results.map((r) => [`${r.pod_id ?? ""}|${r.date}`, Number(r.spend_cents)]));

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
      hits: statuses.filter((s) => s === "hit").length,
      misses: statuses.filter((s) => s === "miss").length,
      testing: statuses.filter((s) => s === "testing").length,
      hitRate: hitRate(statuses),
      editors: [...editors.values()].sort((a, b) => b.totals.spendCents - a.totals.spendCents),
      spark: sparkDays.map((d) => spendOn.get(`${g.podId ?? ""}|${d}`) ?? 0),
      tw: mine.some((p) => p.tw) ? mine.reduce((acc, p) => addTw(acc, p.tw ?? ZERO_TW), ZERO_TW) : null,
    };
  });

  const body: PodsResponse = { ...range, rows, twCoverage: await twCoverage(db, range.from, range.to) };
  return c.json(body);
});

/** Concept results grouped by angle or format. Same period rule as the Pods tab. */
app.get("/insights", async (c) => {
  const db = c.env.DB;
  const range = await resolveRange(db, (k) => c.req.query(k));
  if (!range) return c.json({ error: "Invalid custom date range" }, 400);
  const dims: InsightDimension[] = ["angle", "format", "atria_theme", "atria_desire"];
  const dimension = (dims.find((d) => d === c.req.query("dimension")) ?? "angle") as InsightDimension;
  const pod = c.req.query("pod");
  const concepts = (await loadConcepts(db)).filter(
    (k) => k.firstSpend >= range.from && k.firstSpend <= range.to && (!pod || k.podId === pod),
  );
  // Angle/format: one value per concept. Atria: every theme/desire the concept carries.
  const valuesOf = (k: (typeof concepts)[number]): (string | null)[] => {
    if (dimension === "angle" || dimension === "format") return [k[dimension]];
    const v = dimension === "atria_theme" ? k.atriaThemes : k.atriaDesires;
    return v.length ? v : [null];
  };
  const groups = new Map<string | null, typeof concepts>();
  for (const k of concepts) for (const v of valuesOf(k)) groups.set(v, [...(groups.get(v) ?? []), k]);
  const rows: InsightRow[] = [...groups].map(([value, list]) => {
    const statuses = list.map((k) => k.status);
    const pods = new Map<string, number>();
    for (const k of list) pods.set(k.podId, (pods.get(k.podId) ?? 0) + 1);
    return {
      value,
      concepts: list.length,
      hits: statuses.filter((s) => s === "hit").length,
      misses: statuses.filter((s) => s === "miss").length,
      testing: statuses.filter((s) => s === "testing").length,
      hitRate: hitRate(statuses),
      window: list.reduce((acc, k) => addTotals(acc, k.window), ZERO_TOTALS),
      pods: [...pods].map(([podId, n]) => ({ podId, concepts: n })).sort((a, b) => b.concepts - a.concepts),
    };
  });
  rows.sort((a, b) => (a.value === null ? 1 : b.value === null ? -1 : b.concepts - a.concepts || b.window.spendCents - a.window.spendCents));
  const body: InsightsResponse = { ...range, dimension, rows };
  return c.json(body);
});

/** Concepts that first spent in the range, newest first. ?pod=<id> narrows to one pod. */
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
  const theme = c.req.query("atria_theme");
  const desire = c.req.query("atria_desire");
  const rows = (await loadConcepts(db))
    .filter(
      (k) =>
        k.firstSpend >= range.from &&
        k.firstSpend <= range.to &&
        (!pod || k.podId === pod) &&
        tag(angle, k.angle) &&
        tag(format, k.format) &&
        many(theme, k.atriaThemes) &&
        many(desire, k.atriaDesires),
    )
    .sort((a, b) => b.firstSpend.localeCompare(a.firstSpend) || b.window.spendCents - a.window.spendCents);
  const body: ConceptsResponse = { ...range, rows };
  return c.json(body);
});

// Mounted last so the read routes above take precedence.
app.route("/", editing);

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default {
  fetch: app.fetch,
  /** Nightly: refresh ads and re-pull the last 7 days (Meta keeps revising recent days). */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSync(env, { since: utcDay(-6), until: utcDay(0), ads: true }));
  },
} satisfies ExportedHandler<Env>;
