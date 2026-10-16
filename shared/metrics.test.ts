import { describe, expect, it } from "vitest";
import {
  DEFAULT_TARGETS,
  ZERO_TOTALS,
  cpa,
  cpaBand,
  ctr,
  hitRate,
  hitStatus,
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

  it("is still testing before the window has elapsed", () => {
    expect(hitStatus(t(500, 50, 2000), 2, T)).toBe("testing");
  });

  it("ignores concepts under the minimum test spend", () => {
    expect(hitStatus(t(40, 4, 200), 3, T)).toBe("ineligible");
  });

  it("needs both CPA ≤ $14 and ROAS ≥ 1.7 by default", () => {
    expect(hitStatus(t(140, 10, 240), 3, T)).toBe("hit");
    expect(hitStatus(t(140, 10, 200), 3, T)).toBe("miss"); // ROAS 1.43
    expect(hitStatus(t(150, 10, 300), 3, T)).toBe("miss"); // CPA $15
    expect(hitStatus(t(150, 0, 0), 5, T)).toBe("miss"); // no purchases
  });

  it("supports an either-target rule", () => {
    expect(hitStatus(t(140, 10, 200), 3, { ...T, hitRule: "either" })).toBe("hit");
  });
});

describe("hitRate", () => {
  it("only counts decided concepts", () => {
    expect(hitRate(["hit", "miss", "miss", "testing", "ineligible"])).toBeCloseTo(1 / 3);
    expect(hitRate(["testing"])).toBeNull();
  });
});
