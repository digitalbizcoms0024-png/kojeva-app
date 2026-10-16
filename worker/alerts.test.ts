import { beforeEach, describe, expect, it } from "vitest";
import { loadAlerts, loadSuggestions } from "./alerts.ts";
import { testDb } from "./testing/db.ts";

let db: D1Database;

async function ad(post: string, id: string, name: string, opts: { pod?: string; asset?: string; concept?: string } = {}) {
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO posts (id, media_type) VALUES (?1, 'video')").bind(post),
    db
      .prepare(
        "INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time, asset_id, concept_id) VALUES (?1, ?2, ?3, 'as1', 'Some ad set', 'ACTIVE', '2026-10-01T00:00:00Z', ?4, ?5)",
      )
      .bind(id, post, name, opts.asset ?? null, opts.concept ?? null),
    ...(opts.pod
      ? [db.prepare("INSERT OR REPLACE INTO assignments (post_id, pod_id, pod_source) VALUES (?1, ?2, 'adset')").bind(post, opts.pod)]
      : []),
  ]);
}

/** One day of results: spend and revenue in dollars. */
async function day(adId: string, date: string, spend: number, purchases: number, revenue = 0) {
  await db
    .prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, impressions, link_clicks, purchases, revenue_cents) VALUES (?1, ?2, ?3, 1000, 10, ?4, ?5)")
    .bind(adId, date, spend * 100, purchases, revenue * 100)
    .run();
}

beforeEach(async () => {
  db = await testDb();
});

describe("alerts", () => {
  it("flags an ad whose CPA jumped over the last 3 days", async () => {
    await ad("p1", "a1", "Video 131", { pod: "dhia" });
    // Oct 6–12: $10 CPA. Oct 13–15: $25 CPA.
    for (let d = 6; d <= 12; d++) await day("a1", `2026-10-${String(d).padStart(2, "0")}`, 100, 10);
    for (let d = 13; d <= 15; d++) await day("a1", `2026-10-${d}`, 100, 4);
    const { asOf, alerts } = await loadAlerts(db);
    expect(asOf).toBe("2026-10-15");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ tone: "bad", href: "#/rankings?post=p1" });
    expect(alerts[0]!.title).toBe("Video 131 CPA up 150% in 3 days, likely fatigue");
  });

  it("doesn't flag a steady ad, and counts untagged spend from the last 7 days", async () => {
    await ad("p1", "a1", "Steady", { pod: "harris" });
    await ad("p2", "a2", "Who made this");
    for (let d = 6; d <= 15; d++) await day("a1", `2026-10-${String(d).padStart(2, "0")}`, 100, 8);
    await day("a2", "2026-10-15", 320, 2);
    await day("a2", "2026-09-01", 999, 2); // too old to count
    const { alerts } = await loadAlerts(db);
    expect(alerts).toEqual([
      expect.objectContaining({ id: "untagged", tone: "warn", title: "1 ad with $320 spend needs a pod", href: "#/tagging" }),
    ]);
  });

  it("reports concepts whose test closed as a hit this week", async () => {
    await db.prepare("INSERT INTO concepts (id, adset_id, adset_name, label, pod_id) VALUES ('k1', 'as1', 'IH | Ali | V575', 'V575', 'ali')").run();
    await ad("p1", "a1", "ALI-V575-i1", { pod: "ali", concept: "k1" });
    for (let d = 10; d <= 15; d++) await day("a1", `2026-10-${d}`, 120, 10, 250);
    const { alerts } = await loadAlerts(db);
    expect(alerts.map((a) => [a.tone, a.title])).toEqual([["good", "V575 hit target"]]);
  });

  it("is empty before any data is synced", async () => {
    expect(await loadAlerts(db)).toEqual({ asOf: null, alerts: [] });
  });
});

describe("pod suggestions", () => {
  it("suggests the pod of a credited post that runs the same creative", async () => {
    await ad("p_credited", "a1", "ALI-V575-i1", { pod: "ali", asset: "v:9" });
    await ad("p_copy", "a2", "Copy of V575", { asset: "v:9" });
    expect(await loadSuggestions(db, [])).toEqual({
      p_copy: { podId: "ali", confidence: "high", reason: 'Same creative as "ALI-V575-i1"' },
    });
  });

  it("skips a creative that runs under two pods", async () => {
    await ad("p_h", "a1", "One", { pod: "harris", asset: "v:9" });
    await ad("p_d", "a2", "Two", { pod: "dhia", asset: "v:9" });
    await ad("p_x", "a3", "Three", { asset: "v:9" });
    expect(await loadSuggestions(db, [])).toEqual({});
  });

  it("suggests an editor's pod when one roster editor is named in the ad", async () => {
    await ad("p1", "a1", "UGC Priya 04");
    await ad("p2", "a2", "Priya and Omar cut");
    await ad("p3", "a3", "Priyanka hooks"); // a longer word isn't a match
    const editors = [
      { id: "e1", name: "Priya", podId: "shameer" },
      { id: "e2", name: "Omar", podId: "harris" },
    ];
    expect(await loadSuggestions(db, editors)).toEqual({
      p1: { podId: "shameer", confidence: "medium", reason: "Editor Priya is in the ad name" },
    });
  });
});
