import { beforeEach, describe, expect, it } from "vitest";
import type { RankingsResponse } from "../shared/api.ts";
import { loadAlerts } from "./alerts.ts";
import type { Env } from "./env.ts";
import app from "./index.ts";
import { attribute } from "./meta/sync.ts";
import { testDb } from "./testing/db.ts";

let env: Env;

/** A testing ad (its own "IH | Harris | <label>" ad set, so a concept) or a copy in the scaling ad set. */
async function ad(post: string, id: string, opts: { asset: string; test?: [string, string]; status?: string }) {
  const [adsetId, adsetName] = opts.test ?? ["sc", "Top Spenders From ABO"];
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO posts (id, media_type) VALUES (?1, 'image')").bind(post),
    env.DB.prepare(
      "INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time, asset_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '2026-09-01T00:00:00Z', ?7)",
    ).bind(id, post, `ST _ ${id}`, adsetId, adsetName, opts.status ?? "ACTIVE", opts.asset),
    env.DB.prepare("INSERT OR REPLACE INTO assignments (post_id, pod_id, pod_source) VALUES (?1, 'harris', 'adset')").bind(post),
  ]);
}

/** $100 a day with a $10 CPA (a hit) from `from` to `to` (days of October, or September when negative). */
async function spend(adId: string, from: number, to: number, purchases = 10) {
  for (let d = from; d <= to; d++) {
    const date = d > 0 ? `2026-10-${String(d).padStart(2, "0")}` : `2026-09-${String(30 + d).padStart(2, "0")}`;
    await env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, impressions, link_clicks, purchases, revenue_cents) VALUES (?1, ?2, 10000, 1000, 10, ?3, ?4)")
      .bind(adId, date, purchases, purchases * 2500)
      .run();
  }
}

const rankings = async (q: string) =>
  (await (await app.fetch(new Request(`https://hub.test/api/rankings?${q}`), env, {} as ExecutionContext)).json()) as RankingsResponse;

beforeEach(async () => {
  env = { DB: await testDb(), META_APP_ID: "x", META_AD_ACCOUNT_ID: "act_1", META_GRAPH_VERSION: "v26.0", ACCESS_TEAM_DOMAIN: "" } as Env;
  // Three Harris hits, data through Oct 15:
  // - Almost Sold Out: test ad paused, scaling copy stopped spending after Oct 12 → just turned off everywhere.
  // - Get It or Regret It: test ad paused after scaling, but the scaling copy still runs → not off.
  // - Old Winner: every copy stopped in September → off everywhere, but not recently.
  await ad("p1", "sold-test", { asset: "i:sold", test: ["s1", "IH | Harris | Almost Sold Out"], status: "PAUSED" });
  await ad("p2", "sold-scale", { asset: "i:sold" });
  await spend("sold-test", 1, 8);
  await spend("sold-scale", 4, 12);
  await ad("p3", "regret-test", { asset: "i:regret", test: ["s2", "IH | Harris | Get It or Regret It"], status: "PAUSED" });
  await ad("p4", "regret-scale", { asset: "i:regret" });
  await spend("regret-test", 1, 8);
  await spend("regret-scale", 4, 15);
  await ad("p5", "old-test", { asset: "i:old", test: ["s3", "IH | Harris | Old Winner"], status: "ARCHIVED" });
  await spend("old-test", -20, -10);
  await attribute(env.DB);
});

describe("hits turned off", () => {
  it("alerts only on a winner that just stopped running everywhere", async () => {
    const { alerts } = await loadAlerts(env.DB);
    expect(alerts.filter((a) => a.id.startsWith("hit-off:"))).toEqual([
      {
        id: "hit-off:s1",
        tone: "warn",
        title: "Almost Sold Out was a hit and is now off everywhere",
        detail: "Harris · all 2 copies: 1 no spend in 3 days, 1 paused · $1,000 spend in the week before",
        href: "#/rankings?status=hits_off",
        action: "See hits turned off",
      },
    ]);
  });

  it("lists every winner that no longer runs anywhere on Rankings, whatever the range spent", async () => {
    expect((await rankings("range=week&status=hits_off")).items.map((p) => p.postId).sort()).toEqual(["p1", "p5"]);
    // The normal list only shows posts that spent in the range.
    expect((await rankings("range=week")).items.map((p) => p.postId).sort()).toEqual(["p2", "p4"]);
  });
});
