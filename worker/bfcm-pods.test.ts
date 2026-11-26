import { beforeEach, describe, expect, it } from "vitest";
import type { BfcmResponse } from "../shared/api.ts";
import type { Env } from "./env.ts";
import app from "./index.ts";
import { bumpStats } from "./cache.ts";
import { bfcmGroup } from "./bfcm.ts";
import { testDb } from "./testing/db.ts";

// "BFCM by pod" (owner, Nov 26): promo ad sets grouped by the pod their name credits, the agency
// ("Agency | …" on this page only) or General In-house. Names are real BFCM ad sets.
let env: Env;

async function ad(id: string, adset: string, status: string, dollars: number) {
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO posts (id, media_type) VALUES (?1, 'image')").bind("p-" + id),
    env.DB.prepare(
      "INSERT INTO ads (id, post_id, name, adset_id, adset_name, campaign_name, status, created_time) VALUES (?1, ?2, ?1, ?3, ?3, 'CBO | Promo | BFCM', ?4, '2026-11-10T00:00:00Z')",
    ).bind(id, "p-" + id, adset, status),
    env.DB.prepare(
      "INSERT INTO ad_daily (ad_id, date, spend_cents, impressions, link_clicks, purchases, revenue_cents) VALUES (?1, '2026-11-20', ?2, 1000, 10, 1, ?3)",
    ).bind(id, dollars * 100, dollars * 200),
  ]);
}

beforeEach(async () => {
  env = { DB: await testDb(), META_APP_ID: "x", META_AD_ACCOUNT_ID: "act_1", META_GRAPH_VERSION: "v26.0", ACCESS_TEAM_DOMAIN: "" } as Env;
});

describe("BFCM by pod", () => {
  it("groups ad sets by pod name, Agency prefix or General In-house", () => {
    expect(bfcmGroup("Ali | Statics | Black Friday | Batch #1")).toBe("ali");
    expect(bfcmGroup("Agency | Statics | Black Friday | Batch #4")).toBe("agency");
    expect(bfcmGroup("YD | R1-S10 | Statics")).toBe("agency");
    // Copies of a pod's ads in an ad set that doesn't name the pod are General In-house (owner).
    expect(bfcmGroup("Statics | Early Black Friday | Batch #5")).toBe("general");
    expect(bfcmGroup(null)).toBe("general");
  });

  it("returns each promo ad set's days, live ads and group", async () => {
    await ad("a1", "Agency | Statics | Black Friday | Batch #4", "ACTIVE", 400);
    await ad("a2", "Agency | Statics | Black Friday | Batch #4", "PAUSED", 100);
    await ad("g1", "Statics | Black Friday | Batch #8", "ACTIVE", 300);
    await ad("s1", "Shameer | Black Friday | The Apology", "ACTIVE", 25);
    await bumpStats(env.DB);
    const res = await app.fetch(new Request("https://hub.test/api/bfcm"), env, {} as ExecutionContext);
    const body = (await res.json()) as BfcmResponse;
    const by = new Map(body.adsets.map((s) => [s.name, s]));
    expect(by.get("Agency | Statics | Black Friday | Batch #4")).toMatchObject({ group: "agency", liveAds: 1 });
    expect(by.get("Agency | Statics | Black Friday | Batch #4")!.daily.reduce((n, d) => n + d.spendCents, 0)).toBe(500 * 100);
    expect(by.get("Statics | Black Friday | Batch #8")).toMatchObject({ group: "general", liveAds: 1 });
    expect(by.get("Shameer | Black Friday | The Apology")).toMatchObject({ group: "shameer" });
  });
});
