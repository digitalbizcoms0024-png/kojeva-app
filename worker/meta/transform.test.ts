import { describe, expect, it } from "vitest";
import { insightToDaily, isoTime, mediaTypeFor, pickAction, postIdFor } from "./transform.ts";

describe("pickAction", () => {
  it("prefers omni_purchase, as Ads Manager's Purchases column does", () => {
    expect(
      pickAction([
        { action_type: "purchase", value: "9" },
        { action_type: "omni_purchase", value: "10" },
        { action_type: "link_click", value: "400" },
      ]),
    ).toBe(10);
  });
  it("falls back to pixel purchases, then 0", () => {
    expect(pickAction([{ action_type: "offsite_conversion.fb_pixel_purchase", value: "3" }])).toBe(3);
    expect(pickAction(undefined)).toBe(0);
  });
});

describe("insightToDaily", () => {
  it("converts Meta's strings to cents and counts", () => {
    expect(
      insightToDaily({
        ad_id: "1",
        date_start: "2026-10-08",
        spend: "68394.02",
        impressions: "1897316",
        inline_link_clicks: "41000",
        actions: [{ action_type: "omni_purchase", value: "4885" }],
        action_values: [{ action_type: "omni_purchase", value: "117240.55" }],
      }),
    ).toEqual({
      adId: "1",
      date: "2026-10-08",
      spendCents: 6839402,
      impressions: 1897316,
      linkClicks: 41000,
      purchases: 4885,
      revenueCents: 11724055,
    });
  });
  it("treats missing fields as zero", () => {
    expect(insightToDaily({ ad_id: "1", date_start: "2026-10-08" })).toMatchObject({ spendCents: 0, purchases: 0, revenueCents: 0 });
  });
});

describe("postIdFor", () => {
  it("uses the post ID so copies group together", () => {
    const creative = { id: "c1", effective_object_story_id: "776862388850901_122144298927047339" };
    expect(postIdFor({ id: "a1", creative })).toBe(postIdFor({ id: "a2", creative }));
    expect(postIdFor({ id: "a1", creative })).toBe("776862388850901_122144298927047339");
  });
  it("falls back to the creative, then the ad", () => {
    expect(postIdFor({ id: "a1", creative: { id: "c9" } })).toBe("creative:c9");
    expect(postIdFor({ id: "a1" })).toBe("ad:a1");
  });
});

describe("mediaTypeFor / isoTime", () => {
  it("classifies creatives", () => {
    expect(mediaTypeFor({ creative: { id: "c", object_type: "VIDEO" } })).toBe("video");
    expect(mediaTypeFor({ creative: { id: "c", object_type: "PHOTO" } })).toBe("image");
    expect(mediaTypeFor({ creative: { id: "c", object_type: "SHARE", image_url: "https://x" } })).toBe("image");
  });
  it("normalises Meta timestamps", () => {
    expect(isoTime("2026-10-08T14:03:11-0400")).toBe("2026-10-08T18:03:11.000Z");
    expect(isoTime(undefined)).toBeNull();
  });
});
