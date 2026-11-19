import { describe, expect, it } from "vitest";
import { isNativeTestCampaign, isPodTestCampaign } from "./campaigns.ts";

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

describe("the natives-only testing campaign (owner, Nov 19)", () => {
  it("is Testing #3 only, any case", () => {
    expect(isNativeTestCampaign("CBO | Internal Pod | Testing #3")).toBe(true);
    expect(isNativeTestCampaign("cbo | internal pod | testing #3")).toBe(true);
    for (const name of ["CBO | Internal Pod | Testing", "CBO | Internal Pod | Testing #2", "CBO | Internal Pod | Testing #30", "CBO | TOF Ads | Test", null])
      expect(isNativeTestCampaign(name)).toBe(false);
  });

  it("is still a pod testing campaign (Dashboard's new launches, Ad Swipe)", () => {
    expect(isPodTestCampaign("CBO | Internal Pod | Testing #3")).toBe(true);
  });
});
