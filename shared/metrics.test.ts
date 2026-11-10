import { describe, expect, it } from "vitest";
import {
  DEFAULT_TARGETS,
  winnerTier,
  ZERO_TIERS,
  type TierCounts,
  podScores,
  judgeTurnedOff,
  ZERO_TOTALS,
  cpa,
  cpaBand,
  ctr,
  addTotals,
  dailyFrequency,
  funnelBand,
  hitRate,
  incrementalShare,
  attributedCpa,
  attributedRoas,
  lateHitWindow,
  hitStatus,
  judgingWindowEnd,
  roas,
  roasBand,
  type Totals,
} from "./metrics.ts";

const t = (spend: number, purchases: number, revenue: number): Totals => ({
  ...ZERO_TOTALS,
  spendCents: spend * 100,
  purchases,
  revenueCents: revenue * 100,
});

describe("ratios", () => {
  it("returns null instead of 0 or Infinity when the denominator is zero", () => {
    expect(cpa(t(50, 0, 0))).toBeNull();
    expect(roas(ZERO_TOTALS)).toBeNull();
    expect(ctr(ZERO_TOTALS)).toBeNull();
  });

  it("computes CPA in dollars and ROAS as a multiple", () => {
    expect(cpa(t(140, 10, 0))).toBe(14);
    expect(roas(t(100, 3, 170))).toBeCloseTo(1.7);
  });
});

describe("daily frequency and funnel band (owner, Oct 29)", () => {
  const f = (reachImpressions: number, reach: number): Totals => ({ ...ZERO_TOTALS, impressions: reachImpressions, reachImpressions, reach });
  it("is impressions ÷ daily reach, weighted by size, and missing without reach", () => {
    expect(dailyFrequency(f(1100, 1000))).toBeCloseTo(1.1);
    // A big ad at 1.30 and a tiny one at 1.00: the pod reads near 1.30, not the 1.15 middle.
    expect(dailyFrequency(addTotals(f(13_000, 10_000), f(100, 100)))).toBeCloseTo(1.297, 3);
    expect(dailyFrequency(f(0, 0))).toBeNull();
    // Results stored before reach existed (no fields) read as missing, not NaN.
    const old = { spendCents: 100, impressions: 10, linkClicks: 0, purchases: 0, revenueCents: 0 } as Totals;
    expect(dailyFrequency(addTotals(ZERO_TOTALS, old))).toBeNull();
  });
  it("uses the owner's bands: ≤1.15 top, ≤1.25 middle, above bottom (1.26–1.35 and beyond)", () => {
    const band = (v: number | null) => funnelBand(v, DEFAULT_TARGETS);
    expect(band(1.0)).toBe("top");
    expect(band(1.15)).toBe("top");
    expect(band(1.1549)).toBe("top"); // rounds to 1.15
    expect(band(1.16)).toBe("middle");
    expect(band(1.25)).toBe("middle");
    expect(band(1.26)).toBe("bottom");
    expect(band(1.35)).toBe("bottom");
    expect(band(1.8)).toBe("bottom");
    expect(band(null)).toBeNull();
  });
});

describe("bands", () => {
  it("colours CPA against the $14 target", () => {
    expect(cpaBand(14, 14)).toBe("good");
    expect(cpaBand(17.5, 14)).toBe("warn");
    expect(cpaBand(17.51, 14)).toBe("bad");
    expect(cpaBand(null, 14)).toBe("none");
    // A configured amber limit replaces the 25% default.
    expect(cpaBand(17.9, 14, 18)).toBe("warn");
    expect(cpaBand(18.01, 14, 18)).toBe("bad");
    // An amber limit at or below target is ignored.
    expect(cpaBand(17.5, 14, 12)).toBe("warn");
  });

  it("colours ROAS against the 1.7 target", () => {
    expect(roasBand(1.7, 1.7)).toBe("good");
    expect(roasBand(1.4, 1.7)).toBe("warn");
    expect(roasBand(1.3, 1.7)).toBe("bad");
  });
});

describe("hitStatus", () => {
  const T = DEFAULT_TARGETS;
  const done = { qualified: true, complete: true };

  it("is still testing until the judging window has passed", () => {
    expect(hitStatus(t(500, 50, 2000), { qualified: true, complete: false }, T)).toBe("testing");
    expect(hitStatus(t(20, 1, 30), { qualified: false, complete: false }, T)).toBe("testing");
  });

  it("doesn't count concepts where no ad reached $100", () => {
    expect(hitStatus(t(240, 24, 600), { qualified: false, complete: true }, T)).toBe("ineligible");
  });

  it("hits on CPA ≤ $14 or ROAS ≥ 1.7 by default (Kojeva's rule)", () => {
    expect(T.hitRule).toBe("either");
    expect(hitStatus(t(140, 10, 200), done, T)).toBe("hit"); // CPA $14, ROAS 1.43
    expect(hitStatus(t(220, 10, 380), done, T)).toBe("hit"); // CPA $22, ROAS 1.73
    expect(hitStatus(t(150, 10, 200), done, T)).toBe("miss"); // CPA $15, ROAS 1.33
    expect(hitStatus(t(150, 0, 0), done, T)).toBe("miss"); // no purchases
  });

  it("supports a both-targets rule", () => {
    const both = { ...T, hitRule: "both" as const };
    expect(hitStatus(t(140, 10, 240), done, both)).toBe("hit");
    expect(hitStatus(t(140, 10, 200), done, both)).toBe("miss"); // ROAS 1.43
    expect(hitStatus(t(150, 10, 300), done, both)).toBe("miss"); // CPA $15
  });
});

describe("judgingWindowEnd", () => {
  const T = DEFAULT_TARGETS;
  it("is day 3, or the day an ad crossed $100 if later", () => {
    expect(judgingWindowEnd("2026-10-01", null, T)).toBe("2026-10-03");
    expect(judgingWindowEnd("2026-10-01", "2026-10-02", T)).toBe("2026-10-03");
    expect(judgingWindowEnd("2026-10-01", "2026-10-06", T)).toBe("2026-10-06");
  });
});

describe("hitRate", () => {
  it("only counts decided concepts", () => {
    expect(hitRate(["hit", "miss", "miss", "testing", "ineligible"])).toBeCloseTo(1 / 3);
    expect(hitRate(["testing"])).toBeNull();
  });
});

describe("lateHitWindow", () => {
  const T = { ...DEFAULT_TARGETS };
  // $100/day. Days 1–3 at $25 CPA (a day-3 miss), then $10 CPA and $250 revenue a day.
  const daily = Array.from({ length: 12 }, (_, i) => {
    const date = `2026-10-${String(i + 1).padStart(2, "0")}`;
    const purchases = i < 3 ? 4 : 10;
    return { ...ZERO_TOTALS, date, spendCents: 10000, impressions: 1000, linkClicks: 10, purchases, revenueCents: purchases * 2500 };
  });

  it("judges the totals since launch, from day 7 on", () => {
    // Oct 1–7 since launch: $700 / 52 purchases = $13.46 CPA, ROAS 1.86 → hits on day 7.
    expect(lateHitWindow(daily, "2026-10-01", "2026-10-03", "2026-10-12", T)).toMatchObject({ from: "2026-10-01", to: "2026-10-07" });
  });

  it("waits for day 7 to be synced", () => {
    expect(lateHitWindow(daily.slice(0, 6), "2026-10-01", "2026-10-03", "2026-10-06", T)).toBeNull();
  });

  it("also hits on any rolling 7 days, so bad first days can't hold back a recovery", () => {
    const slow = daily.map((d, i) => (i < 5 ? { ...d, purchases: 2, revenueCents: 5000 } : d));
    // Since launch never meets the targets (Oct 1–12: $15 CPA, ROAS 1.67), but Oct 4–10 does:
    // 2×2 + 5×10 = 54 purchases on $700 = $12.96 CPA.
    expect(lateHitWindow(slow, "2026-10-01", "2026-10-03", "2026-10-12", T)).toMatchObject({ from: "2026-10-04", to: "2026-10-10" });
  });

  it("lets a rolling window overlap the test days, but only one ending after the judging window", () => {
    // Days 1–2 great, then flat: Oct 1–7 (since launch and rolling alike) is the first look.
    const early = daily.map((d, i) => ({ ...d, purchases: i < 2 ? 30 : 4, revenueCents: (i < 2 ? 30 : 4) * 2500 }));
    // With a judging window to Oct 8, the first look is Oct 9 (since launch: 88 purchases on $900).
    expect(lateHitWindow(early, "2026-10-01", "2026-10-08", "2026-10-12", T)).toMatchObject({ from: "2026-10-01", to: "2026-10-09" });
    expect(lateHitWindow(early, "2026-10-01", "2026-10-03", "2026-10-12", T)).toMatchObject({ from: "2026-10-01", to: "2026-10-07" });
  });

  it("matches Harris KOJEVA 12 | WOMEN OVER 50 and Get It or Regret It (both late hits), Meta, Sep–Oct 2026", () => {
    // Revenue = spend × ROAS, or given directly for days with purchases but no spend (Meta shows no ROAS there).
    const day = (date: string, spend: number, purchases: number, roas: number, revenue?: number) => ({
      ...ZERO_TOTALS,
      date,
      spendCents: Math.round(spend * 100),
      impressions: 0,
      linkClicks: 0,
      purchases,
      revenueCents: Math.round((revenue ?? spend * roas) * 100),
    });
    const either = { ...T, hitRule: "either" as const };
    const women = [day("2026-09-28", 118.35, 2, 0.552), day("2026-09-29", 81.45, 2, 0.893), day("2026-09-30", 129.96, 1, 0.177), day("2026-10-01", 87.14, 4, 2.195), day("2026-10-02", 41.24, 3, 2.368)];
    // Since launch never hits (ROAS 0.98), but the rolling Oct 1–7 does: $128 spend, ROAS 2.25.
    expect(lateHitWindow(women, "2026-09-28", "2026-09-30", "2026-10-17", either)).toMatchObject({ from: "2026-10-01", to: "2026-10-07" });
    const regret = [
      day("2026-09-18", 54.77, 3, 2.043),
      day("2026-09-19", 78.17, 4, 1.462),
      day("2026-09-20", 87.84, 3, 0.909),
      day("2026-09-21", 17.81, 1, 3.608),
      // The hub's Sep 18–24 (14 purchases, CPA $19.88, ROAS 1.81) puts these 3 purchases at ~$133.
      day("2026-09-22", 0, 1, 0, 44.5),
      day("2026-09-23", 0, 2, 0, 89),
      day("2026-09-24", 39.69, 0, 0),
      day("2026-09-25", 72.16, 3, 1.223),
    ];
    const w = lateHitWindow(regret, "2026-09-18", "2026-09-20", "2026-10-17", either);
    expect(w).toMatchObject({ from: "2026-09-18", to: "2026-09-24" });
  });

  it("respects the minimum spend and the switch-off", () => {
    const sparse = [{ ...daily[0]!, date: "2026-10-05", spendCents: 5000, purchases: 5, revenueCents: 12500 }];
    expect(lateHitWindow(sparse, "2026-10-01", "2026-10-03", "2026-10-12", T)).toBeNull(); // $50 < $100 minimum
    expect(lateHitWindow(daily, "2026-10-01", "2026-10-03", "2026-10-12", { ...T, lateWindowDays: 0 })).toBeNull();
  });

  it("counts late hits in the hit rate", () => {
    expect(hitRate(["hit", "late_hit", "miss", "testing"])).toBeCloseTo(2 / 3);
  });
});

describe("attribution comparison", () => {
  const click7 = { purchases: 40, revenueCents: 120000 };
  const inc = { purchases: 14.5, revenueCents: 41000 };
  it("computes the incremental share and per-setting CPA and ROAS on the same spend", () => {
    expect(incrementalShare(inc, click7)).toBeCloseTo(0.3625);
    expect(attributedCpa(inc, 56000)).toBeCloseTo(38.62, 2);
    expect(attributedRoas(click7, 56000)).toBeCloseTo(2.14, 2);
  });
  it("is missing, not zero, without data", () => {
    expect(incrementalShare(null, click7)).toBeNull();
    expect(incrementalShare(inc, { purchases: 0, revenueCents: 0 })).toBeNull();
    expect(attributedCpa({ purchases: 0, revenueCents: 0 }, 1000)).toBeNull();
    expect(attributedRoas(null, 1000)).toBeNull();
  });
});

describe("podScores", () => {
  // The owner's weights 50 / 20 / 30 and ROAS minimum $1,000 (Nov 10).
  const t = { ...DEFAULT_TARGETS, scoreWeightHitRate: 50, scoreWeightSpend: 20, scoreWeightRoas: 30, scoreRoasMinSpend: 1000 };
  const pod = (tiers: Partial<TierCounts>, decided: number, spend: number, roasX: number) => ({
    tiers: { ...ZERO_TIERS, ...tiers },
    decided,
    totals: { ...ZERO_TOTALS, spendCents: spend * 100, revenueCents: Math.round(spend * 100 * roasX) },
  });

  it("scores the leaderboard of Oct 12 – Nov 10 by winner tiers", () => {
    // The Pods page that day (spend, ROAS, decided) with each pod's winners by tier.
    const rows = [
      pod({ spend: 1, kpi: 2 }, 11, 22100, 1.66), // Shameer: Negative Marketing #2 scaled to $14K
      pod({ kpi: 3 }, 9, 14500, 1.38), // Harris
      pod({ kpi: 1 }, 5, 1900, 1.21), // Ali
      pod({ kpi: 2 }, 3, 1600, 1.53), // POD 0
      pod({ kpi: 1 }, 3, 3100, 1.22), // Dhia
      pod({}, 0, 230, 0.82), // Caicos
    ];
    const [shameer, harris, ali, pod0, dhia, caicos] = podScores(rows, t);
    expect(shameer!.hitRate).toBeCloseTo((5 / 11 / 0.6) * 50); // 37.9
    expect(harris!.hitRate).toBeCloseTo((3 / 9 / 0.6) * 50); // 27.8
    // POD 0: 2 KPI in 3 is past full points, but KPI alone stops at 2/3, then 3 of 5 decided.
    expect(pod0!.hitRate).toBeCloseTo(50 * (2 / 3) * (3 / 5)); // 20
    expect([shameer, harris, ali, pod0, dhia, caicos].map((s) => Math.round(s!.score))).toEqual([87, 65, 40, 48, 41, 4]);
  });

  it("counts the type of winner, not just how many", () => {
    // 3 winners in 9 decided each: all KPI vs one of every tier.
    const [kpi, mixed] = podScores([pod({ kpi: 3 }, 9, 1000, 1), pod({ kpi: 1, spend: 1, breakthrough: 1 }, 9, 1000, 1)], t);
    expect(kpi!.hitRate).toBeCloseTo(27.8, 1);
    expect(mixed!.hitRate).toBe(50);
    // KPI winners alone never reach full points, however many.
    expect(podScores([pod({ kpi: 9 }, 9, 1000, 1)], t)[0]!.hitRate).toBeCloseTo(50 * (2 / 3));
    // One Spend winner on top of them does.
    expect(podScores([pod({ kpi: 8, spend: 1 }, 9, 1000, 1)], t)[0]!.hitRate).toBe(50);
  });

  it("doesn't move a pod's winners points when another pod does better", () => {
    const alone = podScores([pod({ kpi: 1 }, 10, 1000, 1)], t)[0]!.hitRate;
    const beside = podScores([pod({ kpi: 1 }, 10, 1000, 1), pod({ breakthrough: 5 }, 10, 1000, 1)], t)[0]!.hitRate;
    expect(alone).toBeCloseTo(beside);
  });

  it("caps ROAS at the target and gives nothing for missing numbers", () => {
    const [top, none] = podScores([pod({}, 0, 1000, 3), { tiers: ZERO_TIERS, decided: 0, totals: ZERO_TOTALS }], DEFAULT_TARGETS);
    expect(top).toMatchObject({ hitRate: 0, spend: 40, roas: 20, score: 60 });
    expect(none).toMatchObject({ hitRate: 0, spend: 0, roas: 0, score: 0 });
  });
});

describe("winnerTier", () => {
  const t = DEFAULT_TARGETS;
  const copies = (spend: number, roasX: number, purchases = 0) => ({
    ...ZERO_TOTALS,
    spendCents: spend * 100,
    revenueCents: Math.round(spend * 100 * roasX),
    purchases,
  });

  it("is null unless the concept won", () => {
    expect(winnerTier("miss", copies(30000, 2), t)).toBeNull();
    expect(winnerTier("testing", null, t)).toBeNull();
  });

  it("graduates on spend across all copies while near KPI (real concepts, Nov 10)", () => {
    // Shameer Static 3 | Negative Marketing #2: $8,452 in test + $5,819 Cost Cap copy, ROAS 1.72.
    expect(winnerTier("late_hit", copies(14271, 1.72, 789), t)).toBe("spend");
    // Harris AI UGC | Concept 7: $6,303 at ROAS 1.49 and CPA $19.45: not near KPI, stays a KPI winner.
    expect(winnerTier("late_hit", copies(6303, 1.49, 324), t)).toBe("kpi");
    // Shameer Negative Marketing #3: $3,114, not yet $5,000.
    expect(winnerTier("hit", copies(3114, 2.06, 204), t)).toBe("kpi");
    expect(winnerTier("hit", copies(20000, 1.5), t)).toBe("breakthrough");
  });

  it("counts CPA as near KPI too, and drops a winner that faded", () => {
    // ROAS 1.2 but CPA $15: still near KPI.
    expect(winnerTier("hit", copies(6000, 1.2, 400), t)).toBe("spend");
    // Scaled to $25K but faded to ROAS 1.3 and CPA $25: back to KPI winner.
    expect(winnerTier("hit", copies(25000, 1.3, 1000), t)).toBe("kpi");
  });

  it("keeps a super-hit call at least a Spend winner", () => {
    expect(winnerTier("super_winner", copies(4000, 1.1, 100), t)).toBe("spend");
    expect(winnerTier("super_winner", copies(21000, 1.6, 900), t)).toBe("breakthrough");
    expect(winnerTier("winner", null, t)).toBe("kpi");
  });
});

describe("judgeTurnedOff", () => {
  const t = (spend: number, purchases: number) => ({ ...ZERO_TOTALS, spendCents: spend * 100, purchases, revenueCents: purchases * 2500 });
  it("judges a concept still testing or never qualified on all its spend, and leaves decided ones", () => {
    expect(judgeTurnedOff("testing", t(110, 10), DEFAULT_TARGETS)).toBe("hit");
    expect(judgeTurnedOff("ineligible", t(90, 1), DEFAULT_TARGETS)).toBe("miss");
    expect(judgeTurnedOff("miss", t(110, 10), DEFAULT_TARGETS)).toBe("miss");
    expect(judgeTurnedOff("hit", t(500, 1), DEFAULT_TARGETS)).toBe("hit");
  });
});
