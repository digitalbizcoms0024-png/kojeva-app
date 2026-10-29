// The fortnightly CS performance report (docs/METRICS.md → "CS report"). Its numbers: every pod
// concept that started testing in the period (it counts in the period it launched), with its
// result, spend in the period and since launch, days and ads; earlier concepts whose result came
// in during the period (late verdicts); and the previous period's hit rate as it stands now.
// Built from stored data only. The written part (learnings, read) is drafted by a fortnightly
// Claude task through /api/ingest/report and edited by the team in the hub (reports table).
import { Hono } from "hono";
import type { LateVerdict, ReportData, ReportResponse, ReportsListResponse, ReportText } from "../shared/api.ts";
import { addTotals, cpa, roas, ZERO_TOTALS, type Totals } from "../shared/metrics.ts";
import { period, periodFrom, periodsUntil } from "../shared/periods.ts";
import { requireAccess, requireService } from "./access.ts";
import { bumpVersion } from "./cache.ts";
import type { AppEnv } from "./env.ts";
import { getLatestDate, getTargets, loadConcepts, toTotals } from "./queries.ts";
import { loadPersonas } from "./personas.ts";
import { parseMembers } from "./pods.ts";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** D1 allows 100 bound values per statement. */
const CHUNK = 90;

type Concept = Awaited<ReturnType<typeof loadConcepts>>[number];

/** Totals plus the ratios people read, so the report task doesn't recompute them. */
function figures(t: Totals) {
  return {
    ...t,
    cpa: cpa(t),
    roas: roas(t),
    cpm: t.impressions > 0 ? (t.spendCents / 100 / t.impressions) * 1000 : null,
  };
}

/** When a concept's result came in: its winner call, the end of its late-hit window, or its window closing. */
function verdictOn(k: Concept): string | null {
  if (k.call) return k.call.calledAt.slice(0, 10);
  if (k.status === "late_hit" && k.lateWindow) return k.lateWindow.to;
  if (k.status === "hit" || k.status === "miss") return k.windowEnd;
  return null;
}

export async function buildReport(db: D1Database, from: string, to: string): Promise<ReportData> {
  const [targets, all, personas, pods] = await Promise.all([
    getTargets(db),
    loadConcepts(db),
    loadPersonas(db),
    db.prepare("SELECT id, name, kind, members FROM pods").all<{ id: string; name: string; kind: string; members: string | null }>(),
  ]);
  const podIds = new Set(pods.results.filter((p) => p.kind === "pod").map((p) => p.id));
  // Pod concepts launched in the period; the agency is shown elsewhere, never counted.
  const launched = all.filter((k) => podIds.has(k.podId) && k.firstSpend >= from && k.firstSpend <= to);

  // Each launched concept's ads by day, all dates (to see how early results held up).
  type DayRow = { concept_id: string; ad_id: string; name: string; status: string; date: string } & Record<string, unknown>;
  const rows: DayRow[] = [];
  for (let i = 0; i < launched.length; i += CHUNK) {
    const ids = launched.slice(i, i + CHUNK).map((k) => k.conceptId);
    const { results } = await db
      .prepare(
        `SELECT a.concept_id, a.id AS ad_id, a.name, a.status, d.date, d.spend_cents, d.impressions, d.link_clicks, d.purchases, d.revenue_cents
         FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id
         WHERE a.concept_id IN (${ids.map((_, j) => `?${j + 1}`).join(", ")})`,
      )
      .bind(...ids)
      .all<DayRow>();
    rows.push(...results);
  }

  // All testing spend in the period, including concepts launched before it.
  const spend = await db
    .prepare(
      `SELECT a.concept_id, COALESCE(SUM(d.spend_cents), 0) AS spend_cents
       FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id
       WHERE a.concept_id IS NOT NULL AND d.date BETWEEN ?1 AND ?2 GROUP BY a.concept_id`,
    )
    .bind(from, to)
    .all<{ concept_id: string; spend_cents: number }>();
  // A concept shared with a partner counts in both pods' testing spend.
  const podsOf = new Map(all.map((k) => [k.conceptId, [k.podId, ...(k.coPodId ? [k.coPodId] : [])]]));
  const testingSpend = new Map<string, number>();
  for (const r of spend.results)
    for (const pod of podsOf.get(r.concept_id) ?? [])
      if (podIds.has(pod)) testingSpend.set(pod, (testingSpend.get(pod) ?? 0) + Number(r.spend_cents));

  const persona = new Map(personas.map((p) => [p.id, p.name]));
  const concepts: ReportData["concepts"] = launched.map((k: Concept) => {
    const mine = rows.filter((r) => r.concept_id === k.conceptId);
    const byDay = new Map<string, Totals>();
    const ads = new Map<string, { name: string; status: string; period: Totals; allTime: Totals }>();
    let period = ZERO_TOTALS;
    for (const r of mine) {
      const t = toTotals(r);
      byDay.set(r.date, addTotals(byDay.get(r.date) ?? ZERO_TOTALS, t));
      const ad = ads.get(r.ad_id) ?? { name: r.name, status: r.status, period: ZERO_TOTALS, allTime: ZERO_TOTALS };
      ad.allTime = addTotals(ad.allTime, t);
      if (r.date >= from && r.date <= to) {
        ad.period = addTotals(ad.period, t);
        period = addTotals(period, t);
      }
      ads.set(r.ad_id, ad);
    }
    return {
      conceptId: k.conceptId,
      podId: k.podId,
      coPodId: k.coPodId,
      label: k.label,
      adsetName: k.adsetName,
      status: k.status,
      // The media buyer's winner call (status "winner" / "super_winner"), with its evidence.
      call: k.call,
      candidate: k.candidate,
      firstSpend: k.firstSpend,
      windowEnd: k.windowEnd,
      lastSpend: k.lastSpend,
      stillRunning: k.stillRunning,
      tags: {
        angle: k.angle,
        format: k.format,
        awareness: k.awareness,
        persona: k.personaId ? (persona.get(k.personaId) ?? null) : null,
        motivations: k.motivations,
        beliefGroups: k.beliefGroups,
        atriaThemes: k.atriaThemes,
        atriaHooks: k.atriaHooks,
      },
      window: figures(k.window),
      lateWindow: k.lateWindow ? { from: k.lateWindow.from, to: k.lateWindow.to, ...figures(k.lateWindow.totals) } : null,
      period: figures(period),
      allTime: figures(k.allTime),
      daily: [...byDay]
        .filter(([, t]) => t.spendCents > 0 || t.purchases > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, t]) => ({ date, ...figures(t) })),
      ads: [...ads.values()]
        .sort((a, b) => b.allTime.spendCents - a.allTime.spendCents)
        .map((a) => ({ name: a.name, status: a.status, period: figures(a.period), allTime: figures(a.allTime) })),
    };
  });

  const lateVerdicts: LateVerdict[] = all
    .filter((k) => podIds.has(k.podId) && k.firstSpend < from)
    .flatMap((k) => {
      const on = verdictOn(k);
      if (!on || on < from || on > to) return [];
      return [
        {
          conceptId: k.conceptId,
          podId: k.podId,
          coPodId: k.coPodId,
          label: k.label,
          format: k.format,
          status: k.status,
          firstSpend: k.firstSpend,
          verdictOn: on,
          window: figures(k.window),
          lateWindow: k.lateWindow ? { from: k.lateWindow.from, to: k.lateWindow.to, ...figures(k.lateWindow.totals) } : null,
          allTime: figures(k.allTime),
        },
      ];
    })
    .sort((a, b) => a.verdictOn.localeCompare(b.verdictOn) || b.window.spendCents - a.window.spendCents);

  const here = periodFrom(from);
  const prev = here && here.n > 1 && here.to === to ? period(here.n - 1) : null;

  return {
    from,
    to,
    n: here && here.to === to ? here.n : null,
    lateVerdicts,
    previous: prev && {
      ...prev,
      concepts: all
        .filter((k) => podIds.has(k.podId) && k.firstSpend >= prev.from && k.firstSpend <= prev.to)
        .map((k) => ({ podId: k.podId, label: k.label, status: k.status })),
    },
    targets,
    pods: pods.results.filter((p) => podIds.has(p.id)).map((p) => ({ podId: p.id, name: p.name, testingSpendCents: testingSpend.get(p.id) ?? 0, members: parseMembers(p.members) })),
    concepts,
  };
}

async function loadText(db: D1Database, from: string): Promise<ReportText | null> {
  const r = await db
    .prepare("SELECT learnings, read, source, updated_by, updated_at FROM reports WHERE period_from = ?1")
    .bind(from)
    .first<{ learnings: string; read: string; source: ReportText["source"]; updated_by: string | null; updated_at: string }>();
  return r && { learnings: r.learnings, read: r.read, source: r.source, updatedBy: r.updated_by, updatedAt: r.updated_at };
}

const MAX_TEXT = 12_000;
const cleanText = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : null);

// ---- In the hub: everyone signed in reads; editors edit the written part. ----

export const reports = new Hono<AppEnv>();

reports.get("/", async (c) => {
  const db = c.env.DB;
  const latest = await getLatestDate(db);
  const { results } = await db.prepare("SELECT period_from, source FROM reports").all<{ period_from: string; source: ReportText["source"] }>();
  const text = new Map(results.map((r) => [r.period_from, r.source]));
  const body: ReportsListResponse = { periods: latest ? periodsUntil(latest).map((p) => ({ ...p, text: text.get(p.from) ?? null })) : [] };
  return c.json(body);
});

reports.get("/:from", async (c) => {
  const p = periodFrom(c.req.param("from"));
  if (!p) return c.json({ error: "No report period starts on that day." }, 404);
  const body: ReportResponse = { data: await buildReport(c.env.DB, p.from, p.to), text: await loadText(c.env.DB, p.from) };
  return c.json(body);
});

/** { learnings, read }: the team's edit. From then on Claude's draft never replaces it. */
reports.put("/:from", requireAccess, async (c) => {
  const p = periodFrom(c.req.param("from"));
  if (!p) return c.json({ error: "No report period starts on that day." }, 404);
  const body = await c.req.json<{ learnings?: unknown; read?: unknown }>().catch(() => null);
  const learnings = cleanText(body?.learnings);
  const read = cleanText(body?.read);
  if (learnings == null || read == null || learnings.length > MAX_TEXT || read.length > MAX_TEXT)
    return c.json({ error: `Send learnings and read as text (up to ${MAX_TEXT} characters each).` }, 400);
  await c.env.DB.prepare(
    `INSERT INTO reports (period_from, period_to, learnings, read, source, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, 'edited', ?5, ?6)
     ON CONFLICT(period_from) DO UPDATE SET learnings = excluded.learnings, read = excluded.read, source = 'edited',
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  )
    .bind(p.from, p.to, learnings, read, c.get("userEmail"), new Date().toISOString())
    .run();
  return c.json({ ok: true });
});

// ---- For the fortnightly Claude task (service token only). ----

export const report = new Hono<AppEnv>();
report.use("*", requireService("ATRIA_CLIENT_ID"));

/** GET /api/ingest/report?from=YYYY-MM-DD&to=YYYY-MM-DD: the numbers for any range. */
report.get("/", async (c) => {
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || from > to) return c.json({ error: "Give from and to as YYYY-MM-DD." }, 400);
  return c.json(await buildReport(c.env.DB, from, to));
});

/** The latest closed period without a written part yet, or null: what the task should draft. */
report.get("/due", async (c) => {
  const db = c.env.DB;
  const latest = await getLatestDate(db);
  if (!latest) return c.json({ due: null });
  const closed = periodsUntil(latest).filter((p) => p.closed && p.n > 1);
  const last = closed[0];
  const drafted = last && (await db.prepare("SELECT 1 AS x FROM reports WHERE period_from = ?1").bind(last.from).first());
  return c.json({ due: last && !drafted ? last : null });
});

/** POST { from, learnings, read }: Claude's draft. Refused once the team has edited the report. */
report.post("/draft", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ from?: string; learnings?: unknown; read?: unknown }>().catch(() => null);
  const p = periodFrom(body?.from ?? "");
  const learnings = cleanText(body?.learnings);
  const read = cleanText(body?.read);
  if (!p) return c.json({ error: "from must be the first day of a report period." }, 400);
  if (!learnings || !read || learnings.length > MAX_TEXT || read.length > MAX_TEXT)
    return c.json({ error: `Send learnings and read as text (up to ${MAX_TEXT} characters each).` }, 400);
  const existing = await loadText(db, p.from);
  if (existing?.source === "edited") return c.json({ error: "The team has edited this report; the draft wasn't saved." }, 409);
  const res = await db
    .prepare(
      `INSERT INTO reports (period_from, period_to, learnings, read, source, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, 'claude', NULL, ?5)
       ON CONFLICT(period_from) DO UPDATE SET learnings = excluded.learnings, read = excluded.read, updated_at = excluded.updated_at
       WHERE reports.source = 'claude' AND (reports.learnings <> excluded.learnings OR reports.read <> excluded.read)`,
    )
    .bind(p.from, p.to, learnings, read, new Date().toISOString())
    .run();
  if (res.meta.changes > 0) await bumpVersion(db);
  return c.json({ ok: true, saved: res.meta.changes > 0 });
});
