import { describe, expect, it } from "vitest";
import { fatigue, type FatigueWindow } from "./fatigue.ts";
import { DEFAULT_TARGETS } from "./metrics.ts";

// First week of a winner: $700 at $10 CPA, frequency 1.2, CTR 2%.
const FIRST: FatigueWindow = { spendCents: 70000, impressions: 60000, reach: 50000, linkClicks: 1200, purchases: 70 };

describe("fatigue", () => {
  it("flags an ad whose frequency climbed while CTR and CPA got worse", () => {
    // Last 3 days: $450 at $22.50 CPA, frequency 1.8, CTR 1.2%.
    const recent = { spendCents: 45000, impressions: 36000, reach: 20000, linkClicks: 432, purchases: 20 };
    const f = fatigue(FIRST, recent, 30, DEFAULT_TARGETS)!;
    expect(f.status).toBe("fatigued");
    expect(f.signals).toEqual(["frequency", "ctr", "cpa"]);
    expect(f.frequencyChange).toBeCloseTo(0.5);
    expect(f.ctrChange).toBeCloseTo(-0.4);
    expect(f.cpaChange).toBeCloseTo(1.25);
  });

  it("watches an ad with one signal, and ignores a steady one", () => {
    const freqOnly = { spendCents: 30000, impressions: 30000, reach: 18000, linkClicks: 600, purchases: 30 };
    expect(fatigue(FIRST, freqOnly, 20, DEFAULT_TARGETS)).toMatchObject({ status: "watch", signals: ["frequency"] });
    const steady = { spendCents: 30000, impressions: 25000, reach: 20500, linkClicks: 500, purchases: 29 };
    expect(fatigue(FIRST, steady, 20, DEFAULT_TARGETS)).toBeNull();
  });

  it("doesn't count a CPA rise that stays under the amber limit", () => {
    // $10 → $15: +50%, but under $17.50.
    const recent = { spendCents: 30000, impressions: 25000, reach: 20500, linkClicks: 500, purchases: 20 };
    expect(fatigue(FIRST, recent, 20, DEFAULT_TARGETS)).toBeNull();
  });

  it("treats no purchases on real spend as a CPA rise", () => {
    const recent = { spendCents: 40000, impressions: 30000, reach: 15000, linkClicks: 300, purchases: 0 };
    const f = fatigue(FIRST, recent, 20, DEFAULT_TARGETS)!;
    expect(f.signals).toContain("cpa");
    expect(f.cpaChange).toBeNull();
  });

  it("needs enough age and recent spend, and skips frequency without reach", () => {
    const tired = { spendCents: 45000, impressions: 36000, reach: 20000, linkClicks: 432, purchases: 20 };
    expect(fatigue(FIRST, tired, 9, DEFAULT_TARGETS)).toBeNull();
    expect(fatigue(FIRST, { ...tired, spendCents: 14000 }, 30, DEFAULT_TARGETS)).toBeNull();
    const f = fatigue({ ...FIRST, reach: null }, tired, 30, DEFAULT_TARGETS)!;
    expect(f.frequencyChange).toBeNull();
    expect(f.signals).toEqual(["ctr", "cpa"]);
  });
});
