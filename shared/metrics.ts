// Metric definitions. See docs/METRICS.md. Money is stored in integer cents;
// every ratio returns null (shown as "—") when its denominator is zero.

export interface Totals {
  spendCents: number;
  impressions: number;
  linkClicks: number;
  purchases: number;
  revenueCents: number;
}

export const ZERO_TOTALS: Totals = {
  spendCents: 0,
  impressions: 0,
  linkClicks: 0,
  purchases: 0,
  revenueCents: 0,
};

export function addTotals(a: Totals, b: Totals): Totals {
  return {
    spendCents: a.spendCents + b.spendCents,
    impressions: a.impressions + b.impressions,
    linkClicks: a.linkClicks + b.linkClicks,
    purchases: a.purchases + b.purchases,
    revenueCents: a.revenueCents + b.revenueCents,
  };
}

/** Dollars per purchase. */
export function cpa(t: Totals): number | null {
  return t.purchases > 0 ? t.spendCents / 100 / t.purchases : null;
}

export function roas(t: Totals): number | null {
  return t.spendCents > 0 ? t.revenueCents / t.spendCents : null;
}

/** Link clicks / impressions, as a fraction. */
export function ctr(t: Totals): number | null {
  return t.impressions > 0 ? t.linkClicks / t.impressions : null;
}

export interface Targets {
  targetCpa: number;
  targetRoas: number;
  testWindowDays: number;
  minTestSpend: number;
  hitRule: "both" | "either";
}

export const DEFAULT_TARGETS: Targets = {
  targetCpa: 14,
  targetRoas: 1.7,
  testWindowDays: 3,
  minTestSpend: 100,
  hitRule: "both",
};

export type Band = "good" | "warn" | "bad" | "none";

/** good at or under target, warn up to 25% over, bad beyond. */
export function cpaBand(value: number | null, target: number): Band {
  if (value == null) return "none";
  if (value <= target) return "good";
  return value <= target * 1.25 ? "warn" : "bad";
}

/** good at or over target, warn down to 80% of target, bad below. */
export function roasBand(value: number | null, target: number): Band {
  if (value == null) return "none";
  if (value >= target) return "good";
  return value >= target * 0.8 ? "warn" : "bad";
}

export type HitStatus = "hit" | "miss" | "testing" | "ineligible";

/**
 * Classifies one concept's initial test.
 * @param windowTotals totals over the first `testWindowDays` days from first spend
 * @param daysObserved days of data available since first spend (inclusive)
 */
export function hitStatus(windowTotals: Totals, daysObserved: number, t: Targets): HitStatus {
  if (daysObserved < t.testWindowDays) return "testing";
  if (windowTotals.spendCents < t.minTestSpend * 100) return "ineligible";
  const c = cpa(windowTotals);
  const r = roas(windowTotals);
  const cpaOk = c != null && c <= t.targetCpa;
  const roasOk = r != null && r >= t.targetRoas;
  const hit = t.hitRule === "both" ? cpaOk && roasOk : cpaOk || roasOk;
  return hit ? "hit" : "miss";
}

/** Hits / (hits + misses). Testing and ineligible concepts are excluded. */
export function hitRate(statuses: HitStatus[]): number | null {
  const hits = statuses.filter((s) => s === "hit").length;
  const decided = hits + statuses.filter((s) => s === "miss").length;
  return decided > 0 ? hits / decided : null;
}
