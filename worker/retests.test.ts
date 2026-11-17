import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "./env.ts";
import { bumpStats } from "./cache.ts";
import { attribute } from "./meta/sync.ts";
import { loadConcepts } from "./queries.ts";
import { testDb } from "./testing/db.ts";

let env: Env;

async function ad(id: string, adsetId: string, campaign: string, status: string, created: string) {
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO posts (id, media_type) VALUES (?1, 'video')").bind(`p-${id}`),
    env.DB.prepare(
      "INSERT INTO ads (id, post_id, name, adset_id, adset_name, campaign_name, status, created_time, asset_id) VALUES (?1, ?2, ?1, ?3, 'Shameer | Video | Morning Puff', ?4, ?5, ?6, 'v:puff')",
    ).bind(id, `p-${id}`, adsetId, campaign, status, created),
  ]);
}

async function spend(adId: string, days: string[], dollars: number, purchases: number, revenue: number) {
  for (const date of days)
    await env.DB.prepare(
      "INSERT INTO ad_daily (ad_id, date, spend_cents, impressions, link_clicks, purchases, revenue_cents) VALUES (?1, ?2, ?3, 1000, 10, ?4, ?5)",
    )
      .bind(adId, date, dollars * 100, purchases, revenue * 100)
      .run();
}

beforeEach(async () => {
  env = { DB: await testDb(), META_APP_ID: "x", META_AD_ACCOUNT_ID: "act_1", META_GRAPH_VERSION: "v26.0", ACCESS_TEAM_DOMAIN: "" } as Env;
  // The original in Internal Pod Testing never reached $100 on one ad and was turned off; its duplicate
  // in "CBO | TOF Ads | Test" (same name, same video) spends on (owner, Nov 12).
  await ad("orig", "s1", "CBO | Internal Pod | Testing", "PAUSED", "2026-10-20T00:00:00Z");
  await spend("orig", ["2026-10-20", "2026-10-21", "2026-10-22"], 30, 2, 80);
  await ad("tof", "s2", "CBO | TOF Ads | Test", "ACTIVE", "2026-11-12T05:00:00Z");
  await spend("tof", ["2026-11-12", "2026-11-13"], 60, 6, 150);
  await attribute(env.DB);
  await bumpStats(env.DB);
});

describe("a concept re-tested in a new testing campaign", () => {
  it("is one concept, judged on what both ad sets spent, in the original's period", async () => {
    const all = await loadConcepts(env.DB);
    expect(all).toHaveLength(1);
    const k = all[0]!;
    expect(k).toMatchObject({ conceptId: "s1", firstSpend: "2026-10-20", retestedIn: ["CBO | TOF Ads | Test"] });
    // No single ad had spent $100 until the TOF ad did on Nov 13: judged then, on $90 + $120 = $210.
    expect(k.qualifiedOn).toBe("2026-11-13");
    expect(k.window.spendCents).toBe(21000);
    expect(k.window.purchases).toBe(6 + 12);
    expect(k.status).toBe("hit"); // CPA $11.67 under the $14 target
  });
});
