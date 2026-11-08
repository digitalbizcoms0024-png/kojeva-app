// BFCM page (owner, Nov 8): the promo campaign's ads, with a Scale / Watch / Cut call for each.
// The usual targets apply (Settings → Targets). See docs/METRICS.md → BFCM.
import type { BfcmDay } from "./api.ts";
import { addTotals, cpa, meetsTargets, roas, ZERO_TOTALS, type Targets, type Totals } from "./metrics.ts";

/** The promo: ads in a campaign whose name contains this (any case), on these days. */
export const BFCM = {
  campaign: "Promo | BFCM",
  label: "CBO | Promo | BFCM",
  from: "2026-11-08",
  to: "2026-12-01",
  /** Days marked on the daily chart. */
  days: [
    { date: "2026-11-27", label: "Black Friday" },
    { date: "2026-11-30", label: "Cyber Monday" },
  ],
} as const;

/** Under this much spent in the promo an ad is too early to call. */
export const BFCM_EARLY_DOLLARS = 50;
/** An ad is judged (scale or cut) from this much spent. */
export const BFCM_JUDGE_DOLLARS = 100;
/** Cut below this ROAS once judged. */
export const BFCM_CUT_ROAS = 1;
/** "Slipping": the last 3 days' ROAS more than this far below the promo so far. */
export const BFCM_SLIP = 0.8;

export type BfcmAction = "scale" | "watch" | "cut" | "early";

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const r2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));

/**
 * The call for one ad, from its promo-to-date totals and its last 3 synced days:
 * - early: under $50 spent in the promo;
 * - cut: $100+ spent with no purchase, or ROAS under 1.0;
 * - scale: $100+ spent in the last 3 days, at target there (ROAS ≥ target or CPA ≤ target, as the
 *   hit rule says), and not slipping (last 3 days' ROAS at least 80% of the promo's);
 * - watch: everything else (spent enough to judge, between the two).
 */
export function bfcmAction(promo: Totals, last3: Totals, t: Targets): { action: BfcmAction; reason: string } {
  const spent = promo.spendCents;
  if (spent < BFCM_EARLY_DOLLARS * 100) return { action: "early", reason: `${usd(spent)} spent so far` };
  const promoRoas = roas(promo);
  if (spent >= BFCM_JUDGE_DOLLARS * 100) {
    if (promo.purchases === 0) return { action: "cut", reason: `No purchases on ${usd(spent)}` };
    if ((promoRoas ?? 0) < BFCM_CUT_ROAS) return { action: "cut", reason: `ROAS ${r2(promoRoas)} on ${usd(spent)}` };
  }
  const recentRoas = roas(last3);
  if (last3.spendCents >= BFCM_JUDGE_DOLLARS * 100 && meetsTargets(last3, t)) {
    if (promoRoas != null && recentRoas != null && recentRoas < promoRoas * BFCM_SLIP)
      return { action: "watch", reason: `At target but slipping: ROAS ${r2(recentRoas)} last 3 days, ${r2(promoRoas)} overall` };
    const c = cpa(last3);
    return { action: "scale", reason: `ROAS ${r2(recentRoas)}${c != null ? `, CPA $${c.toFixed(2)}` : ""} on ${usd(last3.spendCents)}, last 3 days` };
  }
  if (spent < BFCM_JUDGE_DOLLARS * 100) return { action: "watch", reason: `${usd(spent)} spent, judged from $${BFCM_JUDGE_DOLLARS}` };
  return { action: "watch", reason: `ROAS ${r2(promoRoas)} on ${usd(spent)}: under target, above the cut line` };
}

export type BfcmView = "promo" | "last3" | "latest" | "before";

const shift = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** The days a view covers, by the latest synced day (kept inside the promo). */
export function bfcmWindow(view: BfcmView, latest: string): [string, string] {
  const end = latest > BFCM.to ? BFCM.to : latest;
  if (view === "promo") return [BFCM.from, end];
  if (view === "last3") return [shift(end, -2), end];
  if (view === "latest") return [end, end];
  return [shift(end, -1), shift(end, -1)];
}

export type BfcmTotals = Totals & { outboundClicks: number | null; addToCart: number | null };

/** An ad's totals over [from, to]; outbound clicks and adds to cart are null if any day lacks them. */
export function bfcmSum(days: BfcmDay[], [from, to]: [string, string]): BfcmTotals {
  let t: Totals = ZERO_TOTALS;
  let ob: number | null = 0;
  let atc: number | null = 0;
  for (const d of days) {
    if (d.date < from || d.date > to) continue;
    t = addTotals(t, d);
    ob = ob == null || d.outboundClicks == null ? null : ob + d.outboundClicks;
    atc = atc == null || d.addToCart == null ? null : atc + d.addToCart;
  }
  return { ...t, outboundClicks: ob, addToCart: atc };
}

/** The call for an ad from its days: promo so far and the last 3 synced days. */
export function bfcmCall(days: BfcmDay[], latest: string, t: Targets) {
  const promo = bfcmSum(days, bfcmWindow("promo", latest));
  return { promo, ...bfcmAction(promo, bfcmSum(days, bfcmWindow("last3", latest)), t) };
}
