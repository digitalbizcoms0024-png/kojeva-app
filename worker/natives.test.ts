import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "./env.ts";
import { bumpStats } from "./cache.ts";
import { attribute } from "./meta/sync.ts";
import { loadConcepts } from "./queries.ts";
import { testDb } from "./testing/db.ts";

let env: Env;

const NATIVES = "CBO | Internal Pod | Testing #3 (Native Ads)";

async function ad(id: string, adsetId: string, adsetName: string, campaign: string, asset = `i:${id}`, created = "2026-11-19T00:00:00Z") {
  const post = `p-${id}`;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO posts (id, media_type) VALUES (?1, 'image')").bind(post),
    env.DB.prepare(
      "INSERT INTO ads (id, post_id, name, adset_id, adset_name, campaign_name, status, created_time, asset_id) VALUES (?1, ?2, ?1, ?3, ?4, ?5, 'ACTIVE', ?7, ?6)",
    ).bind(id, post, adsetId, adsetName, campaign, asset, created),
    env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, impressions, link_clicks, purchases, revenue_cents) VALUES (?1, '2026-11-19', 5000, 1000, 10, 1, 9000)").bind(id),
  ]);
}

beforeEach(async () => {
  env = { DB: await testDb(), META_APP_ID: "x", META_AD_ACCOUNT_ID: "act_1", META_GRAPH_VERSION: "v26.0", ACCESS_TEAM_DOMAIN: "" } as Env;
  await ad("n1", "s1", "Shameer | Morning Puff", NATIVES);
  // A native ad set from the main Internal Pod test, its name not saying Native, duplicated into Testing #3.
  await ad("o1", "s3", "Ali | Where did my face go", "CBO | Internal Pod | Testing", "i:face", "2026-11-05T00:00:00Z");
  await ad("d1", "s4", "Ali | Where did my face go – Copy", NATIVES, "i:face");
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

  it("merges a native duplicated from Internal Pod Testing into its original, as Native", async () => {
    const face = (await loadConcepts(env.DB)).filter((k) => k.adsetName.startsWith("Ali | Where did my face go"));
    expect(face).toHaveLength(1);
    expect(face[0]).toMatchObject({ conceptId: "s3", format: "Native", retestedIn: [NATIVES] });
  });
});
