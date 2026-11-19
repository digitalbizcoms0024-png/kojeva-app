import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "./env.ts";
import { bumpStats } from "./cache.ts";
import { attribute } from "./meta/sync.ts";
import { loadConcepts } from "./queries.ts";
import { testDb } from "./testing/db.ts";

let env: Env;

async function ad(id: string, adsetId: string, adsetName: string, campaign: string) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO posts (id, media_type) VALUES (?1, 'image')").bind(`p-${id}`),
    env.DB.prepare(
      "INSERT INTO ads (id, post_id, name, adset_id, adset_name, campaign_name, status, created_time, asset_id) VALUES (?1, ?2, ?1, ?3, ?4, ?5, 'ACTIVE', '2026-11-19T00:00:00Z', ?6)",
    ).bind(id, `p-${id}`, adsetId, adsetName, campaign, `i:${id}`),
    env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, impressions, link_clicks, purchases, revenue_cents) VALUES (?1, '2026-11-19', 5000, 1000, 10, 1, 9000)").bind(id),
  ]);
}

beforeEach(async () => {
  env = { DB: await testDb(), META_APP_ID: "x", META_AD_ACCOUNT_ID: "act_1", META_GRAPH_VERSION: "v26.0", ACCESS_TEAM_DOMAIN: "" } as Env;
  await ad("n1", "s1", "Shameer | Morning Puff", "CBO | Internal Pod | Testing #3");
  await ad("s2", "s2", "Shameer | Static | Evening Puff", "CBO | Internal Pod | Testing #2");
  await attribute(env.DB);
  await bumpStats(env.DB);
});

describe("CBO | Internal Pod | Testing #3 (natives only, owner Nov 19)", () => {
  it("makes its concepts Native and leaves other campaigns to the names", async () => {
    const byLabel = new Map((await loadConcepts(env.DB)).map((k) => [k.adsetName, k.format]));
    expect(byLabel.get("Shameer | Morning Puff")).toBe("Native");
    expect(byLabel.get("Shameer | Static | Evening Puff")).toBe("Static");
  });
});
