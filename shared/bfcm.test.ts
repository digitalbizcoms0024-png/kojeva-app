import { describe, expect, it } from "vitest";
import { bfcmAction } from "./bfcm.ts";
import { isPromoCampaign } from "./concepts.ts";
import { DEFAULT_TARGETS, ZERO_TOTALS, type Totals } from "./metrics.ts";

const T = { ...DEFAULT_TARGETS, targetRoas: 1.7, targetCpa: 14, hitRule: "either" as const };
const t = (spend: number, purchases: number, revenue: number): Totals => ({ ...ZERO_TOTALS, spendCents: spend * 100, purchases, revenueCents: revenue * 100 });

describe("bfcmAction (owner, Nov 8)", () => {
  it("is too early under $50", () => {
    expect(bfcmAction(t(49, 3, 300), t(49, 3, 300), T).action).toBe("early");
  });
  it("cuts after $100 with no purchase, or under 1.0 ROAS", () => {
    expect(bfcmAction(t(120, 0, 0), t(80, 0, 0), T)).toEqual({ action: "cut", reason: "No purchases on $120" });
    expect(bfcmAction(t(200, 4, 180), t(100, 2, 90), T).action).toBe("cut");
  });
  it("scales an ad at target over the last 3 days with $100+ there", () => {
    expect(bfcmAction(t(300, 15, 600), t(150, 8, 320), T).action).toBe("scale");
    // CPA alone is enough under "either": $12.50 CPA at 1.2 ROAS.
    expect(bfcmAction(t(300, 24, 360), t(150, 12, 180), T).action).toBe("scale");
  });
  it("watches one at target but slipping, one under $100 in the last 3 days, and one between the lines", () => {
    expect(bfcmAction(t(400, 30, 1200), t(150, 8, 300), T).action).toBe("watch"); // 2.0 vs 3.0 overall
    expect(bfcmAction(t(160, 8, 400), t(60, 4, 200), T).action).toBe("watch");
    expect(bfcmAction(t(300, 15, 390), t(150, 6, 180), T).action).toBe("watch"); // 1.3 ROAS, $20 CPA
    expect(bfcmAction(t(70, 2, 120), t(70, 2, 120), T).action).toBe("watch"); // judged from $100
  });
});

describe("isPromoCampaign", () => {
  it("matches the promo campaign, not others", () => {
    expect(isPromoCampaign("CBO | Promo | BFCM")).toBe(true);
    expect(isPromoCampaign("CBO | Internal Pod | Testing")).toBe(false);
    expect(isPromoCampaign("Promotional test")).toBe(false);
    expect(isPromoCampaign(null)).toBe(false);
  });
});
