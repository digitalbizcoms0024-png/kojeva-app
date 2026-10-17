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
  /** Length of the rolling window a day-3 miss can still hit target in (late hit); 0 turns it off. */
  lateWindowDays: number;
}

export const DEFAULT_TARGETS: Targets = {
  targetCpa: 14,
  targetRoas: 1.7,
  testWindowDays: 3,
  minTestSpend: 100,
  hitRule: "both",
  cpaWarnMax: null,
  lateWindowDays: 7,
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

export type HitStatus = "hit" | "late_hit" | "miss" | "testing" | "ineligible";

/** Whether totals meet the targets under the hit rule (CPA and/or ROAS). */
export function meetsTargets(totals: Totals, t: Targets): boolean {
  const c = cpa(totals);
  const r = roas(totals);
  const cpaOk = c != null && c <= t.targetCpa;
  const roasOk = r != null && r >= t.targetRoas;
  return t.hitRule === "both" ? cpaOk && roasOk : cpaOk || roasOk;
}

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
  return meetsTargets(windowTotals, t) ? "hit" : "miss";
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Second look at a concept that missed its day-3 test: the first run of `lateWindowDays`
 * consecutive days (counted from first spend, days without spend included) that ends after the
 * judging window, has at least `minTestSpend` of spend, and meets the targets. Null if none.
 * @param daily the concept's totals per day with spend, any order
 */
export function lateHitWindow(
  daily: ({ date: string } & Totals)[],
  firstSpend: string,
  judgingEnd: string,
  latest: string,
  t: Targets,
): { from: string; to: string; totals: Totals } | null {
  const n = t.lateWindowDays;
  if (n <= 0) return null;
  const byDay = new Map(daily.map((d) => [d.date, d]));
  // Windows [from, from + n - 1] that end after the judging window and by the latest synced day.
  for (let from = firstSpend; addDays(from, n - 1) <= latest; from = addDays(from, 1)) {
    const to = addDays(from, n - 1);
    if (to <= judgingEnd) continue;
    let w = ZERO_TOTALS;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const v = byDay.get(d);
      if (v) w = addTotals(w, v);
    }
    if (w.spendCents >= t.minTestSpend * 100 && meetsTargets(w, t)) return { from, to, totals: w };
  }
  return null;
}

const STATUS_RANK: Record<HitStatus, number> = { hit: 0, late_hit: 1, testing: 2, miss: 3, ineligible: 4 };

/**
 * A concept's result from its own verdict and its ads' verdicts ("best ad decides"): a hit if
 * anything hit, else a late hit, else still testing while any of them is, else a miss.
 */
export function bestStatus(statuses: HitStatus[]): HitStatus {
  return statuses.reduce<HitStatus>((best, s) => (STATUS_RANK[s] < STATUS_RANK[best] ? s : best), "ineligible");
}

/** Last day of the judging window: day N from first spend, or the qualifying day if later. */
export function judgingWindowEnd(firstSpend: string, qualifiedOn: string | null, t: Targets): string {
  const d = new Date(`${firstSpend}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + t.testWindowDays - 1);
  const dayN = d.toISOString().slice(0, 10);
  return qualifiedOn && qualifiedOn > dayN ? qualifiedOn : dayN;
}

/** (Hits + late hits) / decided (hits, late hits and misses). Testing and ineligible concepts are excluded. */
export function hitRate(statuses: HitStatus[]): number | null {
  const hits = statuses.filter((s) => s === "hit" || s === "late_hit").length;
  const decided = hits + statuses.filter((s) => s === "miss").length;
  return decided > 0 ? hits / decided : null;
}

/** Purchases and revenue under one Meta attribution setting. */
export interface AttributedTotals {
  /** Fractional under incremental attribution. */
  purchases: number;
  revenueCents: number;
}

/**
 * Share of 7-day-click purchases Meta estimates would not have happened without the ad:
 * incremental ÷ 7-day click. Null when either is missing or there were no 7-day-click purchases.
 */
export function incrementalShare(inc: AttributedTotals | null, click7: AttributedTotals | null): number | null {
  return inc && click7 && click7.purchases > 0 ? inc.purchases / click7.purchases : null;
}

/** CPA in dollars under an attribution setting; null without purchases or data. */
export function attributedCpa(t: AttributedTotals | null, spendCents: number): number | null {
  return t && t.purchases > 0 ? spendCents / 100 / t.purchases : null;
}

/** ROAS under an attribution setting; null without spend or data. */
export function attributedRoas(t: AttributedTotals | null, spendCents: number): number | null {
  return t && spendCents > 0 ? t.revenueCents / spendCents : null;
}
