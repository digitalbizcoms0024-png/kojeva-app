import { describe, expect, it } from "vitest";
import { isPodTestCampaign } from "./campaigns.ts";

describe("pod testing campaigns", () => {
  it("takes every Internal Pod Testing campaign and TOF Ads, any case", () => {
    expect(isPodTestCampaign("CBO | Internal Pod | Testing")).toBe(true);
    expect(isPodTestCampaign("CBO | Internal Pod | Testing #2")).toBe(true);
    expect(isPodTestCampaign("CBO | TOF Ads | Test")).toBe(true);
    expect(isPodTestCampaign("cbo | internal pod | testing #3")).toBe(true);
  });

  it("leaves scaling, graveyard, promo and agency campaigns out", () => {
    for (const name of ["CBO | Cost Cap | Scale (New)", "Graveyard | Cost Cap", "CBO | Promo | BFCM", "ABO | Broad Testing", "CBO | Broad | Custom Content", null])
      expect(isPodTestCampaign(name)).toBe(false);
  });
});
