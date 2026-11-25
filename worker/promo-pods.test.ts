import { beforeEach, describe, expect, it } from "vitest";
import type { PodsResponse } from "../shared/api.ts";
import type { Env } from "./env.ts";
import app from "./index.ts";
import { bumpStats } from "./cache.ts";
import { attribute } from "./meta/sync.ts";
import { loadConcepts } from "./queries.ts";
import { testDb } from "./testing/db.ts";

// BFCM stays out of pod numbers (owner, Nov 25): spend, ROAS and spend by pod, and winner tiers.
let env: Env;

async function ad(id: string, post: string, adset: string, campaign: string, asset: string) {
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO posts (id, media_type) VALUES (?1, 'image')").bind(post),
    env.DB.prepare(
      "INSERT INTO ads (id, post_id, name, adset_id, adset_name, campaign_name, status, created_time, asset_id) VALUES (?1, ?2, ?1, ?3, ?4, ?5, 'ACTIVE', '2026-11-01T00:00:00Z', ?6)",
    ).bind(id, post, "s-" + id, adset, campaign, asset),
  ]);
}

/** `dollars` a day at ROAS `roasX` on November days `from`–`to`. */
async function spend(adId: string, from: number, to: number, dollars: number, roasX: number) {
  for (let d = from; d <= to; d++)
    await env.DB.prepare(
      "INSERT INTO ad_daily (ad_id, date, spend_cents, impressions, link_clicks, purchases, revenue_cents) VALUES (?1, ?2, ?3, 1000, 10, ?4, ?5)",
    )
      .bind(adId, "2026-11-" + String(d).padStart(2, "0"), dollars * 100, Math.round(dollars / 25), Math.round(dollars * 100 * roasX))
      .run();
}

const pods = async () =>
  (await (await app.fetch(new Request("https://hub.test/api/pods?range=all"), env, {} as ExecutionContext)).json()) as PodsResponse;

beforeEach(async () => {
  env = { DB: await testDb(), META_APP_ID: "x", META_AD_ACCOUNT_ID: "act_1", META_GRAPH_VERSION: "v26.0", ACCESS_TEAM_DOMAIN: "" } as Env;
  // A Shameer test that hit (ROAS 2.5, $300), copied into BFCM where it spent $6,000 at ROAS 1.6, and a
  // BFCM ad set naming Shameer ($1,000).
  await ad("test", "p1", "IH | Shameer | Morning Puff", "CBO | Internal Pod | Testing", "i:puff");
  await spend("test", 1, 3, 100, 2.5);
  await ad("bfcm-copy", "p1", "Statics | Black Friday", "CBO | Promo | BFCM", "i:puff");
  await spend("bfcm-copy", 8, 27, 300, 1.6);
  await ad("bfcm-own", "p2", "Shameer | Black Friday | Statics", "CBO | Promo | BFCM", "i:bf");
  await spend("bfcm-own", 8, 17, 100, 3);
  await attribute(env.DB);
  await bumpStats(env.DB);
});

describe("promo campaigns in pod numbers", () => {
  it("leave BFCM spend and results out of the pod's row", async () => {
    const shameer = (await pods()).rows.find((r) => r.podId === "shameer")!;
    expect(shameer.totals.spendCents).toBe(300 * 100);
    expect(shameer.totals.revenueCents).toBe(300 * 100 * 2.5);
  });

  it("don't make a winner a Spend winner with BFCM copies", async () => {
    const k = (await loadConcepts(env.DB)).find((c) => c.label === "Morning Puff")!;
    expect(k).toMatchObject({ status: "hit", tier: "kpi" });
    expect(k.copies!.spendCents).toBe(300 * 100);
  });
});
