import { describe, expect, it } from "vitest";
import {
  DEFAULT_TARGETS,
  ZERO_TOTALS,
  cpa,
  cpaBand,
  ctr,
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
    return { date, spendCents: 10000, impressions: 1000, linkClicks: 10, purchases, revenueCents: purchases * 2500 };
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
