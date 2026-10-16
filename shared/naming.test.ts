import { describe, expect, it } from "vitest";
import { buildAdName, parseAdName, suggestPodCode, validateNameFields } from "./naming.ts";

// Real Kojeva ad names (Ads Manager, Oct 2026).
describe("parseAdName — legacy names", () => {
  const cases: [string, Partial<ReturnType<typeof parseAdName>>][] = [
    ["Video 153", { convention: "legacy", creativeId: "V153", isCopy: false, title: null }],
    ["V457 | CBO", { creativeId: "V457", campaignHint: "CBO", title: null }],
    ["Video 100 | PDP", { creativeId: "V100", landingPage: "PDP", title: null }],
    ["V556 PDP", { creativeId: "V556", landingPage: "PDP" }],
    ["Video 88 - Copy", { creativeId: "V88", isCopy: true }],
    ["Video 131 - Copy", { creativeId: "V131", isCopy: true }],
    ["batch15-2", { creativeId: "B15", iteration: 2 }],
    ["4-2", { creativeId: "4", iteration: 2 }],
    ["23v2 - Copy", { creativeId: "23", iteration: 2, isCopy: true }],
    [
      "HxM-120 Proving My Husband Wrong - Ad",
      {
        legacyPrefix: "HxM",
        creativeId: "HxM-120",
        angle: "Husband",
        title: "Proving My Husband Wrong - Ad",
      },
    ],
    [
      "HxM 7.1 Funeral_MatureFace_UGC_Story",
      {
        legacyPrefix: "HxM",
        creativeId: "HxM-7",
        iteration: 1,
        angle: "MatureFace",
        format: "UGC",
        hook: "Story",
        title: "Funeral_MatureFace_UGC_Story",
      },
    ],
    // From the Graph API, Oct 2026.
    [
      "HxM2-Yapper Founder-2 | Post ID",
      { legacyPrefix: "HxM", creativeId: "HxM-2", isCopy: false, title: "Yapper Founder-2" },
    ],
    [
      "HxM-1-ANIMSONG-Husband at Walmart | Post ID",
      { legacyPrefix: "HxM", creativeId: "HxM-1", angle: "Husband", title: "ANIMSONG-Husband at Walmart" },
    ],
    ["kojeva 10 HK2 | Post ID", { legacyPrefix: "kojeva", creativeId: "kojeva-10", title: "HK2" }],
    [
      "GS_SA_COMPARISON VSL_HARRIS-h2 | Post ID",
      { convention: "unparsed", angle: "Comparison", format: "VSL", strategistHint: "HAR" },
    ],
    ["Copy of 22v1", { creativeId: "22", iteration: 1, isCopy: true }],
    ["ad2 - Copy 4", { legacyPrefix: "ad", creativeId: "ad-2", isCopy: true }],
  ];

  it.each(cases)("%s", (raw, expected) => {
    expect(parseAdName(raw)).toMatchObject(expected);
  });

  it("never assigns a pod to a legacy name on its own", () => {
    expect(parseAdName("HxM-120 Proving My Husband Wrong").podCode).toBeNull();
  });
});

describe("standard convention", () => {
  it("parses every field", () => {
    expect(parseAdName("HAR-V612-i2 | Depuff | UGC | Story | PDP")).toMatchObject({
      convention: "standard",
      podCode: "HAR",
      creativeId: "V612",
      iteration: 2,
      angle: "Depuff",
      format: "UGC",
      hook: "Story",
      landingPage: "PDP",
    });
  });

  it("treats '-' as empty and tolerates copies", () => {
    expect(parseAdName("dhi-88 | - | Static | - | - - Copy 3")).toMatchObject({
      podCode: "DHI",
      creativeId: "88",
      iteration: null,
      angle: null,
      format: "Static",
      hook: null,
      landingPage: null,
      isCopy: true,
    });
  });

  it("round-trips through buildAdName", () => {
    const fields = {
      podCode: "SHA" as const,
      creativeId: "V700",
      iteration: 3,
      angle: "Comparison",
      format: "UGC",
      hook: null,
      landingPage: "LIST",
    };
    const name = buildAdName(fields);
    expect(name).toBe("SHA-V700-i3 | Comparison | UGC | - | LIST");
    expect(parseAdName(name)).toMatchObject(fields);
  });
});

describe("validateNameFields", () => {
  it("rejects bad ids and pipes", () => {
    expect(validateNameFields({ podCode: "ALI", creativeId: "Video 1" })).toHaveLength(1);
    expect(validateNameFields({ podCode: "ALI", creativeId: "V1", angle: "a|b" })).toHaveLength(1);
    expect(validateNameFields({ podCode: "ALI", creativeId: "V1", iteration: 0 })).toHaveLength(1);
    expect(validateNameFields({ podCode: "ALI", creativeId: "V1", iteration: 2 })).toEqual([]);
  });
});

describe("suggestPodCode", () => {
  it("uses the pod from a standard name", () => {
    expect(suggestPodCode(parseAdName("ALI-5 | - | - | - | -"), {})).toEqual({
      podCode: "ALI",
      reason: "from ad name",
    });
  });

  it("uses a strategist named in the ad name", () => {
    expect(suggestPodCode(parseAdName("GS_SA_COMPARISON VSL_HARRIS-h2 | Post ID"), {})).toEqual({
      podCode: "HAR",
      reason: "Harris named in ad name",
    });
  });

  it("maps legacy prefixes only when configured", () => {
    const parsed = parseAdName("HxM-120 Proving My Husband Wrong");
    expect(suggestPodCode(parsed, {})).toBeNull();
    expect(suggestPodCode(parsed, { hxm: "HAR" })).toEqual({
      podCode: "HAR",
      reason: "from HxM prefix",
    });
  });
});
