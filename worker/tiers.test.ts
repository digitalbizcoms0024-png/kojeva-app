import { beforeEach, describe, expect, it } from "vitest";
import type { PodsResponse } from "../shared/api.ts";
import type { Env } from "./env.ts";
import app from "./index.ts";
import { bumpStats } from "./cache.ts";
import { attribute } from "./meta/sync.ts";
import { loadConcepts } from "./queries.ts";
import { testDb } from "./testing/db.ts";

let env: Env;

/** A testing ad (its own "IH | Harris | <label>" ad set, so a concept) or a copy in a scaling ad set. */
async function ad(post: string, id: string, asset: string, test?: [string, string]) {
  const [adsetId, adsetName] = test ?? ["sc", "Top Spenders #2 | $17"];
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO posts (id, media_type) VALUES (?1, 'image')").bind(post),
    env.DB.prepare(
      "INSERT INTO ads (id, post_id, name, adset_id, adset_name, campaign_name, status, created_time, asset_id) VALUES (?1, ?2, ?1, ?3, ?4, ?5, 'ACTIVE', '2026-10-01T00:00:00Z', ?6)",
    ).bind(id, post, adsetId, adsetName, test ? "CBO | Internal Pod | Testing" : "CBO | Cost Cap | Scale (New)", asset),
  ]);
}

/** `dollars` a day at `roasX` (CPA $10 when roasX is 2.5) on October days `from`–`to`. */
async function spend(adId: string, from: number, to: number, dollars: number, roasX: number) {
  for (let d = from; d <= to; d++)
    await env.DB.prepare(
      "INSERT INTO ad_daily (ad_id, date, spend_cents, impressions, link_clicks, purchases, revenue_cents) VALUES (?1, ?2, ?3, 1000, 10, ?4, ?5)",
    )
      .bind(adId, `2026-10-${String(d).padStart(2, "0")}`, dollars * 100, Math.round(dollars / 25), Math.round(dollars * 100 * roasX))
      .run();
}

beforeEach(async () => {
  env = { DB: await testDb(), META_APP_ID: "x", META_AD_ACCOUNT_ID: "act_1", META_GRAPH_VERSION: "v26.0", ACCESS_TEAM_DOMAIN: "" } as Env;
  // Three Harris hits in testing (ROAS 2.5 over their first 3 days):
  // - Scaled: a scaling copy of the same image took $6,000 at ROAS 1.6 → Spend winner.
  // - Faded: a copy took $25,000 at ROAS 1.2 → still a KPI winner (not near KPI since launch).
  // - Small: never copied → KPI winner.
  // And a miss (ROAS 1.0) whose copy spent $30,000: not a winner, so no tier.
  await ad("p1", "scaled-test", "i:scaled", ["s1", "IH | Harris | Scaled"]);
  await ad("p2", "scaled-copy", "i:scaled");
  await spend("scaled-test", 1, 3, 100, 2.5);
  await spend("scaled-copy", 4, 23, 300, 1.6);
  await ad("p3", "faded-test", "i:faded", ["s2", "IH | Harris | Faded"]);
  await ad("p4", "faded-copy", "i:faded");
  await spend("faded-test", 1, 3, 100, 2.5);
  await spend("faded-copy", 4, 28, 1000, 1.2);
  await ad("p5", "small-test", "i:small", ["s3", "IH | Harris | Small"]);
  await spend("small-test", 1, 3, 100, 2.5);
  await ad("p6", "miss-test", "i:miss", ["s4", "IH | Harris | Miss"]);
  await ad("p7", "miss-copy", "i:miss");
  await spend("miss-test", 1, 3, 100, 1);
  await spend("miss-copy", 4, 28, 1200, 1.0);
  await attribute(env.DB);
  await bumpStats(env.DB);
});

describe("winner tiers", () => {
  it("adds up every copy of a winner's creatives and graduates it while near KPI", async () => {
    const byLabel = new Map((await loadConcepts(env.DB)).map((k) => [k.label, k]));
    expect(byLabel.get("Scaled")).toMatchObject({ status: "hit", tier: "spend" });
    expect(byLabel.get("Scaled")!.copies!.spendCents).toBe((300 + 6000) * 100);
    expect(byLabel.get("Faded")).toMatchObject({ status: "hit", tier: "kpi" });
    expect(byLabel.get("Faded")!.copies!.spendCents).toBe((300 + 25000) * 100);
    expect(byLabel.get("Small")).toMatchObject({ tier: "kpi" });
    expect(byLabel.get("Miss")).toMatchObject({ status: "miss", tier: null, copies: null });
  });

  it("counts the tiers on the pod's row", async () => {
    const res = await app.fetch(new Request("https://hub.test/api/pods?range=all"), env, {} as ExecutionContext);
    const body = (await res.json()) as PodsResponse;
    const harris = body.rows.find((r) => r.podId === "harris")!;
    expect(harris).toMatchObject({ hits: 3, misses: 1, tiers: { kpi: 2, spend: 1, breakthrough: 0 } });
  });
});
