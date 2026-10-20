// The fortnightly CS performance report's numbers: every pod concept that started testing in
// the period, with its judged result, its spend in the period and since launch, its days and
// its ads. Read by the report task through /api/ingest/report (service token only); the
// learnings are written from this. Built from stored data only (no Meta calls).
import { Hono } from "hono";
import { addTotals, cpa, roas, ZERO_TOTALS, type Totals } from "../shared/metrics.ts";
import { requireService } from "./access.ts";
import type { AppEnv } from "./env.ts";
import { getTargets, loadConcepts, toTotals } from "./queries.ts";
import { loadPersonas } from "./personas.ts";

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

export async function buildReport(db: D1Database, from: string, to: string) {
  const [targets, all, personas, pods] = await Promise.all([
    getTargets(db),
    loadConcepts(db),
    loadPersonas(db),
    db.prepare("SELECT id, name, kind FROM pods").all<{ id: string; name: string; kind: string }>(),
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
  const podOf = new Map(all.map((k) => [k.conceptId, k.podId]));
  const testingSpend = new Map<string, number>();
  for (const r of spend.results) {
    const pod = podOf.get(r.concept_id);
    if (pod && podIds.has(pod)) testingSpend.set(pod, (testingSpend.get(pod) ?? 0) + Number(r.spend_cents));
  }

  const persona = new Map(personas.map((p) => [p.id, p.name]));
  const concepts = launched.map((k: Concept) => {
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
      label: k.label,
      adsetName: k.adsetName,
      status: k.status,
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

  return {
    from,
    to,
    targets,
    pods: pods.results.filter((p) => podIds.has(p.id)).map((p) => ({ podId: p.id, name: p.name, testingSpendCents: testingSpend.get(p.id) ?? 0 })),
    concepts,
  };
}

export const report = new Hono<AppEnv>();
report.use("*", requireService("ATRIA_CLIENT_ID"));

/** GET /api/ingest/report?from=YYYY-MM-DD&to=YYYY-MM-DD */
report.get("/", async (c) => {
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || from > to) return c.json({ error: "Give from and to as YYYY-MM-DD." }, 400);
  return c.json(await buildReport(c.env.DB, from, to));
});
