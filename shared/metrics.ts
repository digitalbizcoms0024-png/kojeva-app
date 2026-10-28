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
  /** CPA up to this shows amber ("near target"); null means 25% over target. */
  cpaWarnMax: number | null;
  /** Length of the rolling window a day-3 miss can still hit target in (late hit); 0 turns it off. */
  lateWindowDays: number;
  /** A miss is flagged for a winner call from this ROAS since launch… */
  winnerMinRoas: number;
  /** …once it has spent this much ($) since launch… */
  winnerMinSpend: number;
  /** …over at least this many days. */
  winnerMinDays: number;
  /** A candidate with this much spend ($) is flagged as a possible super winner. */
  superWinnerMinSpend: number;
  /** Ad Rankings by purchases, ROAS, CTR or CPA only rank posts that spent this much ($) per day of the range. */
  rankMinSpendPerDay: number;
  /** Pod score weights (points out of 100, summing to 100): hit rate, spend, ROAS. See `podScores`. */
  scoreWeightHitRate: number;
  scoreWeightSpend: number;
  scoreWeightRoas: number;
  /** A pod's ROAS part is scaled down below this much spend ($) in the period. */
  scoreRoasMinSpend: number;
  /** A pod at this hit rate (%) or above gets the full hit-rate points. */
  scoreFullHitRate: number;
}

export const DEFAULT_TARGETS: Targets = {
  targetCpa: 14,
  targetRoas: 1.7,
  testWindowDays: 3,
  minTestSpend: 100,
  hitRule: "either",
  cpaWarnMax: null,
  lateWindowDays: 7,
  winnerMinRoas: 1.5,
  winnerMinSpend: 1000,
  winnerMinDays: 5,
  superWinnerMinSpend: 5000,
  rankMinSpendPerDay: 50,
  scoreWeightHitRate: 40,
  scoreWeightSpend: 40,
  scoreWeightRoas: 20,
  scoreRoasMinSpend: 300,
  scoreFullHitRate: 20,
};

export interface PodScore {
  /** 0–100: the three parts added up. */
  score: number;
  hitRate: number;
  spend: number;
  roas: number;
}

/**
 * The pod leaderboard's score (owner, Oct 28), out of 100:
 * - hit rate: the pod's hit rate ÷ `scoreFullHitRate` (20%), capped at 1, × `scoreWeightHitRate`
 *   (no decided concepts: 0). Measured against that standard, not the best pod (owner, Oct 28), so a
 *   pod's points don't move with another pod's lucky run;
 * - spend: the pod's spend in the period ÷ the biggest pod's, × `scoreWeightSpend` (whose ads take budget);
 * - ROAS: the pod's ROAS ÷ target ROAS, capped at 1, × `scoreWeightRoas`, scaled down by
 *   spend ÷ `scoreRoasMinSpend` below that spend, so a few lucky dollars can't earn full marks.
 * Compared among the rows passed in (the pods, never Agency).
 */
export function podScores(rows: { hitRate: number | null; totals: Totals }[], t: Targets): PodScore[] {
  const fullRate = t.scoreFullHitRate / 100;
  const maxSpend = Math.max(0, ...rows.map((r) => r.totals.spendCents));
  return rows.map((r) => {
    const hitRate = fullRate > 0 ? Math.min(1, (r.hitRate ?? 0) / fullRate) * t.scoreWeightHitRate : 0;
    const spend = maxSpend > 0 ? (r.totals.spendCents / maxSpend) * t.scoreWeightSpend : 0;
    const x = roas(r.totals);
    const guard = t.scoreRoasMinSpend > 0 ? Math.min(1, r.totals.spendCents / 100 / t.scoreRoasMinSpend) : 1;
    const roasPart = x != null && t.targetRoas > 0 ? Math.min(1, x / t.targetRoas) * guard * t.scoreWeightRoas : 0;
    return { score: hitRate + spend + roasPart, hitRate, spend, roas: roasPart };
  });
}

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

/** "winner" / "super_winner": a miss the media buyer called a winner (see winnerCandidate). */
export type HitStatus = "hit" | "late_hit" | "winner" | "super_winner" | "miss" | "testing" | "ineligible";

/** Hits on target, late hits and winners by call all count as hits. */
export function isHit(s: HitStatus | null | undefined): boolean {
  return s === "hit" || s === "late_hit" || s === "winner" || s === "super_winner";
}

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

/** Meta effective statuses of an ad switched off (itself, its ad set or its campaign) or archived/deleted. */
export const OFF_STATUSES: readonly string[] = ["PAUSED", "ADSET_PAUSED", "CAMPAIGN_PAUSED", "ARCHIVED", "DELETED"];

/**
 * Turning a concept off ends its test (owner, Oct 28): once every ad in it is off, a concept still
 * testing, or with no ad at `minTestSpend`, is judged at once on everything it spent, whatever it
 * spent. A result already decided (hit, miss) stays as it is.
 */
export function judgeTurnedOff(status: HitStatus, allTime: Totals, t: Targets): HitStatus {
  if (status !== "testing" && status !== "ineligible") return status;
  return meetsTargets(allTime, t) ? "hit" : "miss";
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Second look at a concept that missed its day-3 test and kept spending. It becomes a late hit on the
 * first day D, at least `lateWindowDays` days in (day 7 by default), after the judging window and by
 * the latest synced day, where either look has at least `minTestSpend` spent and meets the targets:
 * - its totals **since launch** (first spend through D, the bad first days included), or
 * - the **last `lateWindowDays` days** up to D (a rolling window; it may overlap the test days).
 * Since launch wins when both hit on the same day. Null if neither ever hits.
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
  const byDate = new Map<string, Totals>();
  for (const d of daily) byDate.set(d.date, addTotals(byDate.get(d.date) ?? ZERO_TOTALS, d));
  const firstDay = addDays(firstSpend, n - 1);
  const hits = (w: Totals) => w.spendCents >= t.minTestSpend * 100 && meetsTargets(w, t);
  let sinceLaunch = ZERO_TOTALS;
  for (let to = firstSpend; to <= latest; to = addDays(to, 1)) {
    sinceLaunch = addTotals(sinceLaunch, byDate.get(to) ?? ZERO_TOTALS);
    if (to < firstDay || to <= judgingEnd) continue;
    if (hits(sinceLaunch)) return { from: firstSpend, to, totals: sinceLaunch };
    const from = addDays(to, 1 - n);
    let rolling = ZERO_TOTALS;
    for (let d = from; d <= to; d = addDays(d, 1)) rolling = addTotals(rolling, byDate.get(d) ?? ZERO_TOTALS);
    if (hits(rolling)) return { from, to, totals: rolling };
  }
  return null;
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
  const hits = statuses.filter(isHit).length;
  const decided = hits + statuses.filter((s) => s === "miss").length;
  return decided > 0 ? hits / decided : null;
}

/** Fewer decided tests than this and a hit rate is a hint, not a verdict. */
export const MIN_DECIDED = 3;

/**
 * Lower bound of the 90% Wilson interval for a hit rate: how high the rate is, discounted for
 * small samples (3/3 ranks below 25/30). Null with nothing decided.
 */
export function hitRateFloor(hits: number, decided: number): number | null {
  if (decided === 0) return null;
  const z = 1.645;
  const p = hits / decided;
  const z2 = (z * z) / decided;
  return Math.max(0, (p + z2 / 2 - z * Math.sqrt((p * (1 - p)) / decided + z2 / (4 * decided))) / (1 + z2));
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

/**
 * Whether a concept that missed its test is worth a winner call: close to target since launch
 * (ROAS ≥ winnerMinRoas), taking real spend (≥ winnerMinSpend) for at least winnerMinDays days.
 * Only flags it; the media buyer decides (worker/calls.ts). Null when it doesn't qualify.
 */
export function winnerCandidate(
  k: { status: HitStatus; allTime: Totals; firstSpend: string; lastSpend: string | null },
  t: Targets,
): "winner" | "super_winner" | null {
  if (k.status !== "miss" || !k.lastSpend) return null;
  const r = roas(k.allTime);
  const days = Math.round((Date.parse(k.lastSpend) - Date.parse(k.firstSpend)) / 86_400_000) + 1;
  if (r == null || r < t.winnerMinRoas || k.allTime.spendCents < t.winnerMinSpend * 100 || days < t.winnerMinDays) return null;
  return k.allTime.spendCents >= t.superWinnerMinSpend * 100 ? "super_winner" : "winner";
}

/**
 * The coverage map places ads that spent at least this much in the period (cents). Smaller tests
 * still count everywhere else; they'd only clutter the map and its "not on the map" count.
 */
export const MIN_MAP_SPEND_CENTS = 5000;
