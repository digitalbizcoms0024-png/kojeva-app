import { describe, expect, it } from "vitest";
import { attributePod, podFromAdSetName } from "./attribution.ts";

describe("podFromAdSetName", () => {
  it.each([
    ["ABO | Harris | Oct 12", "HAR"],
    ["Dhia - Testing - Batch 15", "DHI"],
    ["SHAMEER_ABO_TEST", "SHA"],
    ["ali broad 3", "ALI"],
  ])("%s → %s", (name, code) => {
    expect(podFromAdSetName(name)).toBe(code);
  });

  it("matches whole words only", () => {
    expect(podFromAdSetName("Valid audiences | Broad")).toBeNull();
    expect(podFromAdSetName("Harrison lookalike")).toBeNull();
  });

  it("refuses ad sets naming two strategists", () => {
    expect(podFromAdSetName("Harris + Dhia shared test")).toBeNull();
  });

  it("handles missing names", () => {
    expect(podFromAdSetName(null)).toBeNull();
    expect(podFromAdSetName("Cost Cap | Scale")).toBeNull();
  });
});

describe("attributePod", () => {
  it("credits the pod from the original ad set, not the scaling copies", () => {
    const result = attributePod([
      { name: "HxM-120 Proving My Husband Wrong - Copy", adsetName: "Cost Cap | Scale", createdTime: "2026-10-05" },
      { name: "HxM-120 Proving My Husband Wrong", adsetName: "ABO | Harris | Oct", createdTime: "2026-10-01" },
    ]);
    expect(result).toMatchObject({ podCode: "HAR", source: "adset" });
  });

  it("falls back to a copy's ad set when the original names nobody", () => {
    const result = attributePod([
      { name: "Video 153", adsetName: "Broad", createdTime: "2026-10-01" },
      { name: "Video 153 - Copy", adsetName: "Ali | ABO", createdTime: "2026-10-03" },
    ]);
    expect(result).toMatchObject({ podCode: "ALI", source: "adset" });
  });

  it("lets a pod code in a new-style ad name win", () => {
    const result = attributePod([{ name: "DHI-V612 | - | UGC | - | PDP", adsetName: "ABO | Harris", createdTime: "2026-10-01" }]);
    expect(result).toMatchObject({ podCode: "DHI", source: "name" });
  });

  it("uses a strategist named in the ad name as a last resort", () => {
    const result = attributePod([{ name: "GS_SA_COMPARISON VSL_HARRIS-h2 | Post ID", adsetName: "Broad", createdTime: null }]);
    expect(result).toMatchObject({ podCode: "HAR", source: "name" });
  });

  it("returns null when nothing identifies the pod", () => {
    expect(attributePod([{ name: "4-2", adsetName: "Broad", createdTime: null }])).toBeNull();
    expect(attributePod([])).toBeNull();
  });
});
