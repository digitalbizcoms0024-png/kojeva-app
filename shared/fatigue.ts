// Creative fatigue: an ad's last 3 days against its own first week of spend.
// Documented in docs/METRICS.md → "Fatigue".
import { cpaWarnLimit, type Targets } from "./metrics.ts";

/** Totals for one window. `reach` sums daily reach (Meta reports it per day), or null if unknown. */
export interface FatigueWindow {
  spendCents: number;
  impressions: number;
  reach: number | null;
  linkClicks: number;
  purchases: number;
}

export type FatigueSignal = "frequency" | "ctr" | "cpa";

export interface Fatigue {
  status: "fatigued" | "watch";
  signals: FatigueSignal[];
  /** Change vs the first week, as fractions (+0.3 = 30% higher); null when either side is missing. */
  frequencyChange: number | null;
  ctrChange: number | null;
  cpaChange: number | null;
}

/** The recent window needs this much spend before anything is flagged. */
export const FATIGUE_MIN_RECENT_SPEND_CENTS = 150_00;
/** …and the ad must have been spending at least this many days (first week + recent days). */
export const FATIGUE_MIN_AGE_DAYS = 10;
export const FREQUENCY_RISE = 0.25;
export const CTR_DROP = 0.25;
export const CPA_RISE = 0.3;

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const change = (now: number | null, before: number | null) => (now == null || before == null || before === 0 ? null : now / before - 1);

/**
 * Compares an ad's recent days with its first week. Signals:
 * - frequency (impressions ÷ reach) up ≥ 25%;
 * - link CTR down ≥ 25%;
 * - CPA up ≥ 30% and above the amber limit.
 * Two or more signals = "fatigued", one = "watch", none (or too little data) = null.
 */
export function fatigue(first: FatigueWindow, recent: FatigueWindow, ageDays: number, targets: Targets): Fatigue | null {
  if (ageDays < FATIGUE_MIN_AGE_DAYS || recent.spendCents < FATIGUE_MIN_RECENT_SPEND_CENTS) return null;
  const freq = (w: FatigueWindow) => (w.reach == null ? null : ratio(w.impressions, w.reach));
  const ctr = (w: FatigueWindow) => ratio(w.linkClicks, w.impressions);
  const cpa = (w: FatigueWindow) => (w.purchases > 0 ? w.spendCents / 100 / w.purchases : null);

  const frequencyChange = change(freq(recent), freq(first));
  const ctrChange = change(ctr(recent), ctr(first));
  const recentCpa = cpa(recent);
  // No purchases lately on real spend counts as a CPA rise.
  const cpaChange = recentCpa == null && first.purchases > 0 ? Infinity : change(recentCpa, cpa(first));

  const signals: FatigueSignal[] = [];
  if (frequencyChange != null && frequencyChange >= FREQUENCY_RISE) signals.push("frequency");
  if (ctrChange != null && ctrChange <= -CTR_DROP) signals.push("ctr");
  const overLimit = recentCpa == null || recentCpa > cpaWarnLimit(targets.targetCpa, targets.cpaWarnMax);
  if (cpaChange != null && cpaChange >= CPA_RISE && overLimit) signals.push("cpa");
  if (signals.length === 0) return null;
  return {
    status: signals.length >= 2 ? "fatigued" : "watch",
    signals,
    frequencyChange,
    ctrChange,
    cpaChange: cpaChange === Infinity ? null : cpaChange,
  };
}
