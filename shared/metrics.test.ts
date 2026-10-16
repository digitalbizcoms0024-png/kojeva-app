import { describe, expect, it } from "vitest";
import {
  DEFAULT_TARGETS,
  ZERO_TOTALS,
  cpa,
  cpaBand,
  ctr,
  hitRate,
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
