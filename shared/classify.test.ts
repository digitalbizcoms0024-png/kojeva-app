import { describe, expect, it } from "vitest";
import { classify } from "./classify.ts";

// Real concept labels and ad names from the Kojeva account, Oct 2026.
describe("classify", () => {
  it.each([
    ["KOJEVA 3 | STATIC | Scarcity", "Scarcity", "Static"],
    ["KOJEVA 3 | STATIC | Morning Puffiness", "Depuff", "Static"],
    ["KOJEVA 3 | STATIC | Comparison", "Comparison", "Static"],
    ["KOJEVA 3 | STATIC | Social Proof", "SocialProof", "Static"],
    ["KOJEVA 3 | STATIC | Problem Aware", "ProblemAware", "Static"],
    ["KOJEVA 3 | STATIC | Simple Routine", "Routine", "Static"],
    ["KOJEVA 3 | STATIC | Advertorial", null, "Native"],
    ["KOJEVA 7 | UGC Funeral Story", null, "UGC"],
    ["KOJEVA 2 | Yapper Founder Led", "Founder", null],
    ["KOJEVA 6 | AUTHORITY VSL", "Authority", "VSL"],
    ["KOJEVA 9 | COMPARISON VSL", "Comparison", "VSL"],
    ["KOJEVA 15 | DOUBLE CHIN", "Jawline", null],
    ["KOJEVA 15 | HUSBAND", "Husband", null],
    ["KOJEVA 15 | FAKE BRUSH", "FakeBrush", null],
    ["KOJEVA 15 | STREET INTERVIEW", null, "Interview"],
    ["KOJEVA 12 | WOMEN OVER 50", "MatureFace", null],
    ["KOJEVA 12 | AI UGC", null, "AIUGC"],
    ["KOJEVA 1 | ANIMSONG-HxM1", null, "Animation"],
    // The media buyer's format names (Oct 2026), for ad sets named with them from now on.
    ["KOJEVA 16 | AI DRAMA | Mini Movie", null, "AIDrama"],
    ["KOJEVA 16 | PIXAR ANIMATION | Husband", "Husband", "Animation"],
    ["KOJEVA STATIC | Offer", "Offer", "Static"],
    ["KOJEVA STATIC | Mature Skin", "MatureFace", "Static"],
    ["Static 3 | Negative Marketing #2", "ProblemAware", "Static"],
    ["Native Ad | Concept 21 - Hooded Eyes", "EyeBags", "Native"],
    ["Native Ad | WORMS IN YOUR FACE", "Mechanism", "Native"],
    ["Static | Jawline at 52!!", "Jawline", "Static"],
    ["Video 1 | Skin Educator Video", "Authority", "Video"],
    ["Video 4 | Kojeva_GreenScreen_NeverGoBack", null, "Video"],
    ["Kojeva_Podcast_How to Tell if.._Brief", "Routine", "Podcast"],
    ["23 | Lymphatic Drainage | Videos", "Mechanism", "Video"],
    ["12 ROUND 3 | Real. vs Fake Brush", "FakeBrush", null],
    ["35 ROUND 3 | eye bags", "EyeBags", null],
    ["B030 - NON UGC - Iterations/Mashup | Sinus", "Sinus", "UGC"],
  ])("%s → %s / %s", (label, angle, format) => {
    expect(classify({ label })).toEqual({ angle, format });
  });

  it("falls back to ad names when the label says nothing", () => {
    expect(
      classify({
        label: "STATIC | Batch 3",
        adset: "IH | Dhia | STATIC | Batch 3 & 5",
        ads: ["batch 3a", "ST _ Depuffing _ 90 Second Facial Brush Ritual _ V1"],
      }),
    ).toEqual({ angle: "Depuff", format: "Static" });
    expect(classify({ label: "R2-S12 | Statics", ads: ["V457 | CBO"] })).toEqual({ angle: null, format: "Static" });
  });
});
