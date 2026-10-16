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

/** Triple Whale pixel-attributed results. Never added to Meta's numbers; shown beside them. */
export interface TwTotals {
  /** Attributed orders; fractional under multi-touch models. */
  purchases: number;
  revenueCents: number;
}

export const ZERO_TW: TwTotals = { purchases: 0, revenueCents: 0 };

export function addTw(a: TwTotals, b: TwTotals): TwTotals {
  return { purchases: a.purchases + b.purchases, revenueCents: a.revenueCents + b.revenueCents };
}

/** Triple Whale ROAS: attributed revenue over Meta spend (Triple Whale uses the platform's spend too). */
export function twRoas(tw: TwTotals | null, spendCents: number): number | null {
  return tw && spendCents > 0 ? tw.revenueCents / spendCents : null;
}

/** Triple Whale CPA in dollars: Meta spend over attributed orders. */
export function twCpa(tw: TwTotals | null, spendCents: number): number | null {
  return tw && tw.purchases > 0 ? spendCents / 100 / tw.purchases : null;
}

export interface Targets {
  targetCpa: number;
  targetRoas: number;
  testWindowDays: number;
  minTestSpend: number;
  hitRule: "both" | "either";
  /** CPA up to this shows amber ("near target"); null means 25% over target. */
  cpaWarnMax: number | null;
}

export const DEFAULT_TARGETS: Targets = {
  targetCpa: 14,
  targetRoas: 1.7,
  testWindowDays: 3,
  minTestSpend: 100,
  hitRule: "both",
  cpaWarnMax: null,
};

export type Band = "good" | "warn" | "bad" | "none";

/** Top of the amber CPA band: the configured value, or 25% over target. */
export function cpaWarnLimit(target: number, warnMax?: number | null): number {
  return warnMax != null && warnMax > target ? warnMax : target * 1.25;
}

/** good at or under target, warn up to the amber limit (default 25% over), bad beyond. */
export function cpaBand(value: number | null, target: number, warnMax?: number | null): Band {
  if (value == null) return "none";
  if (value <= target) return "good";
  return value <= cpaWarnLimit(target, warnMax) ? "warn" : "bad";
}

/** good at or over target, warn down to 80% of target, bad below. */
export function roasBand(value: number | null, target: number): Band {
  if (value == null) return "none";
  if (value >= target) return "good";
  return value >= target * 0.8 ? "warn" : "bad";
}

export type HitStatus = "hit" | "miss" | "testing" | "ineligible";

/**
 * Classifies one concept's test. A concept qualifies once any single ad in it has spent
 * `minTestSpend`; it's judged on the concept's totals from first spend to the later of
 * day `testWindowDays` and the day that ad crossed `minTestSpend` (see `judgingWindowEnd`).
 * @param windowTotals the concept's totals over that judging window
 * @param state.qualified some ad has reached `minTestSpend`
 * @param state.complete the judging window has fully passed
 */
export function hitStatus(windowTotals: Totals, state: { qualified: boolean; complete: boolean }, t: Targets): HitStatus {
  if (!state.complete) return "testing";
  if (!state.qualified) return "ineligible";
  const c = cpa(windowTotals);
  const r = roas(windowTotals);
  const cpaOk = c != null && c <= t.targetCpa;
  const roasOk = r != null && r >= t.targetRoas;
  const hit = t.hitRule === "both" ? cpaOk && roasOk : cpaOk || roasOk;
  return hit ? "hit" : "miss";
}

/** Last day of the judging window: day N from first spend, or the qualifying day if later. */
export function judgingWindowEnd(firstSpend: string, qualifiedOn: string | null, t: Targets): string {
  const d = new Date(`${firstSpend}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + t.testWindowDays - 1);
  const dayN = d.toISOString().slice(0, 10);
  return qualifiedOn && qualifiedOn > dayN ? qualifiedOn : dayN;
}

/** Hits / (hits + misses). Testing and ineligible concepts are excluded. */
export function hitRate(statuses: HitStatus[]): number | null {
  const hits = statuses.filter((s) => s === "hit").length;
  const decided = hits + statuses.filter((s) => s === "miss").length;
  return decided > 0 ? hits / decided : null;
}
