import { describe, expect, it } from "vitest";
import { attributePod, detectPodsStart, isAgencyAdSet, podFromAdSetName } from "./attribution.ts";

describe("podFromAdSetName", () => {
  it.each([
    ["ABO | Harris | Oct 12", "HAR"],
    ["Dhia - Testing - Batch 15", "DHI"],
    ["SHAMEER_ABO_TEST", "SHA"],
    ["ali broad 3", "ALI"],
    // Real ad sets, Oct 2026.
    ["IH | Harris | KOJEVA 3 | STATIC | Scarcity", "HAR"],
    ["IH | Dhia | STATIC | Batch 15", "DHI"],
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

describe("agency", () => {
  const prefixes = ["ME", "QW", "TV", "YD"];
  it.each([
    ["ME | R2-S12 | Statics", true],
    ["QW  | 12 ROUND 3 | Real. vs Fake Brush", true],
    ["TV | B036", true],
    ["YD | B2C2 - UGC - Krystle Ann Ruppe | Esthetician Wrong Way Tutorial", true],
    ["IH | Harris | KOJEVA 3 | STATIC | Scarcity", false],
    ["Top Spenders From ABO", false],
    ["METRO broad", false],
  ])("%s → %s", (name, expected) => {
    expect(isAgencyAdSet(name, prefixes)).toBe(expected);
  });

  it("detects when the pods started from the first IH ad set", () => {
    expect(
      detectPodsStart([
        { name: "a", adsetName: "ME | R2-S12 | Statics", createdTime: "2026-05-01T00:00:00.000Z" },
        { name: "b", adsetName: "IH | Dhia | STATIC | Batch 15", createdTime: "2026-09-29T00:00:00.000Z" },
        { name: "c", adsetName: "IH | Harris | KOJEVA 3", createdTime: "2026-09-24T00:00:00.000Z" },
      ]),
    ).toBe("2026-09-24T00:00:00.000Z");
  });

  const settings = { agencyPrefixes: prefixes, podsStartDate: "2026-09-24T00:00:00.000Z" };

  it("credits agency ad sets to the agency", () => {
    expect(attributePod([{ name: "Video 100", adsetName: "QW | 23 | Lymphatic Drainage | Videos", createdTime: "2026-10-01" }], {}, settings)).toMatchObject({
      podCode: "AGY",
      source: "adset",
    });
  });

  it("credits untraceable posts launched before the pods to the agency", () => {
    expect(attributePod([{ name: "batch15-2", adsetName: "Top Spenders From ABO", createdTime: "2026-06-02" }], {}, settings)).toMatchObject({
      podCode: "AGY",
      source: "era",
    });
  });

  it("leaves untraceable posts launched after the pods started unassigned", () => {
    expect(attributePod([{ name: "Video 612", adsetName: "Top Spenders From ABO", createdTime: "2026-10-05" }], {}, settings)).toBeNull();
  });

  it("prefers the pod over the agency when a copy sits in an agency ad set", () => {
    expect(
      attributePod(
        [
          { name: "HxM-1", adsetName: "IH | Harris | KOJEVA 1", createdTime: "2026-10-01" },
          { name: "HxM-1 - Copy", adsetName: "ME | R2-S12 | Statics", createdTime: "2026-10-03" },
        ],
        {},
        settings,
      ),
    ).toMatchObject({ podCode: "HAR", source: "adset" });
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
