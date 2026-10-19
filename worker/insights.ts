import type { ConceptsResponse, HitBaseline, InsightDimension, InsightPick, InsightRow, InsightsMatrix, InsightsOverview, MatrixDimension } from "../shared/api.ts";
import { addTotals, cpa, hitRate, hitRateFloor, MIN_DECIDED, ZERO_TOTALS } from "../shared/metrics.ts";

type Concept = ConceptsResponse["rows"][number];

export const INSIGHT_DIMENSIONS: InsightDimension[] = [
  "angle",
  "format",
  "awareness",
  "persona",
  "motivation",
  "atria_hook",
  "atria_persona",
  "atria_desire",
  "belief",
  "atria_theme",
];
export const MATRIX_DIMENSIONS: MatrixDimension[] = ["angle", "format", "awareness", "persona", "motivation"];

/** A concept's values on a dimension: one for angle/format/awareness/persona, every tag it carries for the rest. */
export function valuesOf(k: Concept, d: InsightDimension): (string | null)[] {
  if (d === "angle" || d === "format" || d === "awareness") return [k[d]];
  if (d === "persona") return [k.personaId];
  const v = { atria_theme: k.atriaThemes, atria_desire: k.atriaDesires, atria_hook: k.atriaHooks, atria_persona: k.atriaPersonas, belief: k.beliefGroups, motivation: k.motivations }[d];
  return v.length ? v : [null];
}

function summarize(value: string | null, list: Concept[]): InsightRow {
  const statuses = list.map((k) => k.status);
  const pods = new Map<string, number>();
  for (const k of list) pods.set(k.podId, (pods.get(k.podId) ?? 0) + 1);
  return {
    value,
    concepts: list.length,
    hits: statuses.filter((s) => s === "hit" || s === "late_hit").length,
    lateHits: statuses.filter((s) => s === "late_hit").length,
    misses: statuses.filter((s) => s === "miss").length,
    testing: statuses.filter((s) => s === "testing").length,
    hitRate: hitRate(statuses),
    window: list.reduce((acc, k) => addTotals(acc, k.window), ZERO_TOTALS),
    pods: [...pods].map(([podId, n]) => ({ podId, concepts: n })).sort((a, b) => b.concepts - a.concepts),
  };
}

export function baseline(concepts: Concept[]): HitBaseline {
  const r = summarize(null, concepts);
  return { concepts: r.concepts, hits: r.hits, decided: r.hits + r.misses, hitRate: r.hitRate, window: r.window };
}

/** Concept results grouped by one dimension; most concepts first, untagged last. */
export function insightRows(concepts: Concept[], d: InsightDimension): InsightRow[] {
  const groups = new Map<string | null, Concept[]>();
  for (const k of concepts) for (const v of valuesOf(k, d)) groups.set(v, [...(groups.get(v) ?? []), k]);
  const rows = [...groups].map(([value, list]) => summarize(value, list));
  return rows.sort((a, b) => (a.value === null ? 1 : b.value === null ? -1 : b.concepts - a.concepts || b.window.spendCents - a.window.spendCents));
}

const floor = (r: InsightRow) => hitRateFloor(r.hits, r.hits + r.misses) ?? 0;

/** Dimensions the overview picks winners from, in the order they're shown on a tie. */
const PICK_FROM: InsightDimension[] = ["angle", "format", "motivation", "atria_hook", "awareness", "persona"];

/**
 * Per dimension, the tagged value most likely to hit (highest hit-rate floor) among those with at
 * least MIN_DECIDED decided tests that beat the average; and, across angle and format, the values
 * whose decided tests found no hit, by test spend.
 */
export function overview(concepts: Concept[], range: { from: string; to: string }): InsightsOverview {
  const base = baseline(concepts);
  const winners: InsightPick[] = [];
  const sinks: InsightPick[] = [];
  for (const d of PICK_FROM) {
    const rows = insightRows(concepts, d).filter((r): r is InsightRow & { value: string } => r.value !== null && r.hits + r.misses >= MIN_DECIDED);
    const best = rows
      .filter((r) => r.hitRate != null && r.hitRate > (base.hitRate ?? 0))
      .sort((a, b) => floor(b) - floor(a) || b.hits - a.hits || (cpa(a.window) ?? Infinity) - (cpa(b.window) ?? Infinity))[0];
    if (best) winners.push({ dimension: d, row: best });
    if (d === "angle" || d === "format") for (const r of rows) if (r.hits === 0) sinks.push({ dimension: d, row: r });
  }
  winners.sort((a, b) => floor(b.row) - floor(a.row));
  sinks.sort((a, b) => b.row.window.spendCents - a.row.window.spendCents);
  return {
    ...range,
    baseline: base,
    winners,
    sinks: sinks.slice(0, 3),
    untagged: (["angle", "format"] as const).map((d) => ({ dimension: d, concepts: concepts.filter((k) => k[d] == null).length })),
  };
}

/** Hit rate for each pair of values on two dimensions (e.g. angle × format), tagged values only. */
export function matrix(concepts: Concept[], rows: MatrixDimension, cols: MatrixDimension, range: { from: string; to: string }): InsightsMatrix {
  const cells = new Map<string, { row: string; col: string; list: Concept[] }>();
  const rowCount = new Map<string, number>();
  const colCount = new Map<string, number>();
  let skipped = 0;
  for (const k of concepts) {
    const rs = valuesOf(k, rows).filter((v): v is string => v != null);
    const cs = valuesOf(k, cols).filter((v): v is string => v != null);
    if (!rs.length || !cs.length) {
      skipped++;
      continue;
    }
    for (const r of rs) rowCount.set(r, (rowCount.get(r) ?? 0) + 1);
    for (const c of cs) colCount.set(c, (colCount.get(c) ?? 0) + 1);
    for (const r of rs)
      for (const c of cs) {
        const key = JSON.stringify([r, c]);
        const cell = cells.get(key) ?? { row: r, col: c, list: [] };
        cell.list.push(k);
        cells.set(key, cell);
      }
  }
  const order = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
  return {
    ...range,
    rows,
    cols,
    rowValues: order(rowCount),
    colValues: order(colCount),
    cells: [...cells.values()].map((c) => ({ ...summarize(c.row, c.list), row: c.row, col: c.col })),
    baseline: baseline(concepts),
    skipped,
  };
}
