import { Hono } from "hono";
import type {
  ConceptsResponse,
  Editor,
  CopyRow,
  MetaResponse,
  PodRow,
  PodsResponse,
  PostDetail,
  RankingsResponse,
  SortKey,
} from "../shared/api.ts";
import { ZERO_TOTALS, addTotals, cpa, ctr, hitRate, roas, type Totals } from "../shared/metrics.ts";
import { DEFAULT_ATTRIBUTION, type AttributionSettings } from "../shared/attribution.ts";
import { accessConfigured, accessMiddleware } from "./access.ts";
import type { AppEnv, Env } from "./env.ts";
import { editing } from "./editing.ts";
import { connection, sync } from "./meta/routes.ts";
import { runSync, utcDay } from "./meta/sync.ts";
import { getLatestDate, getTargets, loadConcepts, loadPosts, shiftDay, toTotals, TOTALS_SQL } from "./queries.ts";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", accessMiddleware);
app.route("/connection", connection);
app.route("/sync", sync);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

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
  const [targets, latestDate, lastRun, pods, live, conn, attr, detected, editors] = await Promise.all([
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
    pods: pods.results,
    attribution: {
      agencyPrefixes: attribution.agencyPrefixes,
      podsStartDate: attribution.podsStartDate ?? (detected ? (JSON.parse(detected.value) as string | null) : null),
      detected: !attribution.podsStartDate,
    },
    editors: editors.results,
    canEdit: accessConfigured(c.env),
  };
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

  const body: RankingsResponse = {
    ...range,
    totals: items.reduce((acc, p) => addTotals(acc, p.totals), ZERO_TOTALS),
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
  const [posts, concepts, pods] = await Promise.all([
    loadPosts(db, range.from, range.to),
    loadConcepts(db),
    db
      .prepare("SELECT id, name, color, kind FROM pods ORDER BY kind DESC, name")
      .all<{ id: string; name: string; color: string; kind: "pod" | "agency" }>(),
  ]);

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
    };
  });

  const body: PodsResponse = { ...range, rows };
  return c.json(body);
});

/** Concepts that first spent in the range, newest first. ?pod=<id> narrows to one pod. */
app.get("/concepts", async (c) => {
  const db = c.env.DB;
  const range = await resolveRange(db, (k) => c.req.query(k));
  if (!range) return c.json({ error: "Invalid custom date range" }, 400);
  const pod = c.req.query("pod");
  const rows = (await loadConcepts(db))
    .filter((k) => k.firstSpend >= range.from && k.firstSpend <= range.to && (!pod || k.podId === pod))
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
