import { describe, expect, it } from "vitest";
import {
  DEFAULT_TARGETS,
  ZERO_TOTALS,
  cpa,
  cpaBand,
  twCpa,
  twRoas,
  ctr,
  hitRate,
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

  it("needs both CPA ≤ $14 and ROAS ≥ 1.7 by default", () => {
    expect(hitStatus(t(140, 10, 240), done, T)).toBe("hit");
    expect(hitStatus(t(140, 10, 200), done, T)).toBe("miss"); // ROAS 1.43
    expect(hitStatus(t(150, 10, 300), done, T)).toBe("miss"); // CPA $15
    expect(hitStatus(t(150, 0, 0), done, T)).toBe("miss"); // no purchases
  });

  it("supports an either-target rule", () => {
    expect(hitStatus(t(140, 10, 200), done, { ...T, hitRule: "either" })).toBe("hit");
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

describe("Triple Whale metrics", () => {
  it("divides attributed revenue and orders by Meta spend", () => {
    const tw = { purchases: 2.5, revenueCents: 9000 };
    expect(twRoas(tw, 6000)).toBeCloseTo(1.5);
    expect(twCpa(tw, 6000)).toBeCloseTo(24);
  });
  it("is missing (not zero) without spend, orders or synced data", () => {
    expect(twRoas({ purchases: 0, revenueCents: 0 }, 0)).toBeNull();
    expect(twCpa({ purchases: 0, revenueCents: 0 }, 5000)).toBeNull();
    expect(twRoas(null, 5000)).toBeNull();
    expect(twRoas({ purchases: 0, revenueCents: 0 }, 5000)).toBe(0);
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

  it("finds the first rolling window that hits target after the judging window", () => {
    // Oct 1–7: $700 / 58 purchases = $12.07 CPA, ROAS 2.07 → hits.
    expect(lateHitWindow(daily, "2026-10-01", "2026-10-03", "2026-10-12", T)).toMatchObject({ from: "2026-10-01", to: "2026-10-07" });
  });

  it("needs a full window of synced days", () => {
    expect(lateHitWindow(daily.slice(0, 6), "2026-10-01", "2026-10-03", "2026-10-06", T)).toBeNull();
  });

  it("can find a later window when early days drag the first one down", () => {
    const slow = daily.map((d, i) => (i < 5 ? { ...d, purchases: 2, revenueCents: 5000 } : d));
    // Oct 1–7 has 5 slow days; the first window that hits starts Oct 4.
    expect(lateHitWindow(slow, "2026-10-01", "2026-10-03", "2026-10-12", T)).toMatchObject({ from: "2026-10-04", to: "2026-10-10" });
  });

  it("counts days without spend as part of the window, and respects the minimum spend and switch-off", () => {
    const sparse = [{ ...daily[0]!, date: "2026-10-05", spendCents: 5000, purchases: 5, revenueCents: 12500 }];
    expect(lateHitWindow(sparse, "2026-10-01", "2026-10-03", "2026-10-12", T)).toBeNull(); // $50 < $100 minimum
    expect(lateHitWindow(daily, "2026-10-01", "2026-10-03", "2026-10-12", { ...T, lateWindowDays: 0 })).toBeNull();
  });

  it("counts late hits in the hit rate", () => {
    expect(hitRate(["hit", "late_hit", "miss", "testing"])).toBeCloseTo(2 / 3);
  });
});
