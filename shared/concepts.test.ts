import { describe, expect, it } from "vitest";
import { buildConcepts, conceptLabel, partFor, splitParts, staticTitle } from "./concepts.ts";

// Real ad sets and ads from the Kojeva account, Oct 2026.
const ad = (id: string, name: string, adsetId: string, adsetName: string) => ({ id, name, adsetId, adsetName });

const DHIA_35 = "IH | Dhia | STATIC | Batch 3 & 5";
const DHIA_69 = "IH | Dhia | STATIC | Batch 6 & 9";
const HARRIS_DJ = "IH | Harris | KOJEVA STATIC | Depuffing + Jawline";
const HARRIS_OP = "IH | Harris | KOJEVA STATIC | Offer + Price";
const HARRIS_MN = "IH | Harris | KOJEVA STATIC | Mature Skin + Neck";

describe("conceptLabel / splitParts", () => {
  it("drops the team prefix and strategist", () => {
    expect(conceptLabel("IH | Harris | KOJEVA 3 | STATIC | Scarcity")).toBe("KOJEVA 3 | STATIC | Scarcity");
    expect(conceptLabel("ME | R2-S12 | Statics")).toBe("R2-S12 | Statics");
    expect(conceptLabel("QW  | 12 ROUND 3 | Real. vs Fake Brush")).toBe("12 ROUND 3 | Real. vs Fake Brush");
  });
  it("splits combined segments", () => {
    expect(splitParts("Batch 3 & 5")).toEqual(["Batch 3", "Batch 5"]);
    expect(splitParts("Batch 10 & 11")).toEqual(["Batch 10", "Batch 11"]);
    expect(splitParts("Depuffing + Jawline")).toEqual(["Depuffing", "Jawline"]);
    expect(splitParts("Scarcity")).toEqual(["Scarcity"]);
  });
});

describe("partFor", () => {
  it.each([
    ["batch 3a", ["Batch 3", "Batch 5"], 0],
    ["batch 3b", ["Batch 3", "Batch 5"], 0],
    ["batch5", ["Batch 3", "Batch 5"], 1],
    ["batch 6 | 1", ["Batch 6", "Batch 9"], 0],
    ["batch 1b", ["Batch 1", "Batch 2"], 0],
    ["batch 10", ["Batch 10", "Batch 11"], 0],
    ["batch 11", ["Batch 10", "Batch 11"], 1],
    ["ST _ Depuffing _ 90 Second Facial Brush Ritual _ V1", ["Depuffing", "Jawline"], 0],
    ["ST _ Depuffing _ Bye Puffy Jawline _ V1", ["Depuffing", "Jawline"], 1],
    ["ST _ Mature Skin _ Morning Puffiness Before After _ V1", ["Mature Skin", "Neck"], 0],
    ["ST _ Neck _ Day 1 vs Day 5 _ V1", ["Mature Skin", "Neck"], 1],
    ["ST _ Offer _ Warehouse 60 Percent Off _ V1", ["Offer", "Price"], 0],
    ["ST _ Offer _ $16.99 Price Comparison _ V1", ["Offer", "Price"], 1],
    ["Did you know", ["Batch 6", "Batch 9"], null],
  ])("%s → part %s", (name, parts, expected) => {
    expect(partFor(name, parts)).toBe(expected);
  });
});

describe("buildConcepts", () => {
  const concepts = buildConcepts([
    ad("a1", "batch 3a", "s35", DHIA_35),
    ad("a2", "batch 3b", "s35", DHIA_35),
    ad("a3", "batch5", "s35", DHIA_35),
    ad("b1", "batch 6 | 1", "s69", DHIA_69),
    ad("b2", "batch 6 | 2", "s69", DHIA_69),
    ad("b3", "Did you know", "s69", DHIA_69),
    ad("c1", "ST _ Depuffing _ 90 Second Facial Brush Ritual _ V1", "sdj", HARRIS_DJ),
    ad("c2", "ST _ Depuffing _ Bye Puffy Jawline _ V1", "sdj", HARRIS_DJ),
    ad("c3", "ST _ Depuffing _ Goodbye Puffy Face Hello Jawline _ V1", "sdj", HARRIS_DJ),
    ad("c4", "ST _ Depuffing _ Depuffed Jawline in 3 Weeks _ V1", "sdj", HARRIS_DJ),
    ad("d1", "ST _ Offer _ Warehouse 60 Percent Off _ V1", "sop", HARRIS_OP),
    ad("d2", "ST _ Offer _ $16.99 Price Comparison _ V1", "sop", HARRIS_OP),
    ad("e1", "ST _ Mature Skin _ Sculpted Face Benefits _ V1", "smn", HARRIS_MN),
    ad("e2", "ST _ Neck _ Day 1 vs Day 5 _ V1", "smn", HARRIS_MN),
    ad("f1", "HxM2-Yapper Founder-2 | Post ID", "syf", "IH | Harris | KOJEVA 2 | Yapper Founder Led"),
    ad("f2", "HxM2-Yapper Founder-3", "syf", "IH | Harris | KOJEVA 2 | Yapper Founder Led"),
    ad("g1", "V457 | CBO", "sme", "ME | R2-S12 | Statics"),
    ad("h1", "Video 30", "stop", "Top Spenders From ABO"),
  ]);
  const byLabel = Object.fromEntries(concepts.map((c) => [c.label, c]));

  it("splits combined ad sets into one concept per part", () => {
    expect(byLabel["STATIC | Batch 3"]).toMatchObject({ podCode: "DHI", adIds: ["a1", "a2"] });
    expect(byLabel["STATIC | Batch 5"]).toMatchObject({ podCode: "DHI", adIds: ["a3"] });
    expect(byLabel["STATIC | Batch 6"]!.adIds).toEqual(["b1", "b2"]);
    expect(byLabel["STATIC | Batch 9"]!.adIds).toEqual(["b3"]);
    expect(byLabel["KOJEVA STATIC | Depuffing"]!.adIds).toEqual(["c1"]);
    expect(byLabel["KOJEVA STATIC | Jawline"]!.adIds).toEqual(["c2", "c3", "c4"]);
    expect(byLabel["KOJEVA STATIC | Offer"]!.adIds).toEqual(["d1"]);
    expect(byLabel["KOJEVA STATIC | Price"]!.adIds).toEqual(["d2"]);
    expect(byLabel["KOJEVA STATIC | Mature Skin"]!.adIds).toEqual(["e1"]);
    expect(byLabel["KOJEVA STATIC | Neck"]!.adIds).toEqual(["e2"]);
  });

  it("keeps a normal ad set as one concept, including the agency's", () => {
    expect(byLabel["KOJEVA 2 | Yapper Founder Led"]).toMatchObject({ id: "syf", podCode: "HAR", adIds: ["f1", "f2"] });
    expect(byLabel["R2-S12 | Statics"]).toMatchObject({ podCode: "AGY" });
  });

  it("doesn't split a '+' that isn't two concepts", () => {
    const [c, ...rest] = buildConcepts([
      ad("v1", "Apology v1", "sv", "Shameer | AI Voiceover + Brolls | Apology"),
      ad("v2", "Apology v2", "sv", "Shameer | AI Voiceover + Brolls | Apology"),
    ]);
    expect(rest).toHaveLength(0);
    expect(c).toMatchObject({ id: "sv", podCode: "SHA", label: "AI Voiceover + Brolls | Apology", adIds: ["v1", "v2"] });
  });

  it("handles the CBO testing ad sets (strategist name, no IH)", () => {
    const cs = buildConcepts([
      ad("x1", "neg 2", "s1", "Shameer | Static 3 | Negative Marketing #2"),
      ad("x2", "hooded", "s2", "Ali | Native Ad | Concept 21 - Hooded Eyes"),
      ad("x3", "c8", "s3", "Harris | AI UGC | Concept 8"),
      ad("x4", "q", "s4", "Anti-Fake / Quality Comparison"),
    ]);
    expect(cs.map((c) => [c.podCode, c.label])).toEqual([
      ["SHA", "Static 3 | Negative Marketing #2"],
      ["ALI", "Native Ad | Concept 21 - Hooded Eyes"],
      ["HAR", "AI UGC | Concept 8"],
    ]);
  });

  it("never treats scaling ad sets as concepts", () => {
    expect(concepts.some((c) => c.adsetId === "stop")).toBe(false);
    expect(concepts).toHaveLength(12);
  });
});

describe("ad sets with one concept per static", () => {
  const SCARCITY = "IH | Harris | KOJEVA 3 | STATIC | Scarcity";
  const ad = (id: string, name: string, adsetId: string) => ({ id, name, adsetId, adsetName: SCARCITY });

  it("splits Harris KOJEVA 3 Scarcity into one concept per static, keeping versions together", () => {
    const concepts = buildConcepts([
      ad("1", "ST _ Scarcity _ Almost Sold Out _ V1", "120249807197790075"),
      ad("2", "ST _ Scarcity _ Get It or Regret It _ V1", "120249807197790075"),
      ad("3", "ST _ Scarcity _ Empty Warehouse _ V1", "120249807197790075"),
      ad("4", "ST _ Scarcity _ Almost Sold Out _ V2", "120249807197790075"),
    ]);
    expect(concepts.map((c) => [c.label, c.adIds])).toEqual([
      ["KOJEVA 3 | STATIC | Scarcity | Almost Sold Out", ["1", "4"]],
      ["KOJEVA 3 | STATIC | Scarcity | Get It or Regret It", ["2"]],
      ["KOJEVA 3 | STATIC | Scarcity | Empty Warehouse", ["3"]],
    ]);
    expect(concepts[0]).toMatchObject({ id: "120249807197790075#almost-sold-out", podCode: "HAR" });
  });

  it("leaves every other ad set as it was", () => {
    expect(buildConcepts([ad("1", "ST _ Scarcity _ Almost Sold Out _ V1", "other"), ad("2", "ST _ Scarcity _ Get It _ V1", "other")])).toHaveLength(1);
  });

  it("reads the static's title from its name", () => {
    expect(staticTitle("ST _ Scarcity _ Almost Sold Out _ V1 | 122144277081047339")).toBe("Almost Sold Out");
    expect(staticTitle("ST _ Comparison _ Gua Sha vs Kojeva _ V1_ Listicle")).toBe("Gua Sha vs Kojeva V1 Listicle");
  });
});
