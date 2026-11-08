import { beforeEach, describe, expect, it } from "vitest";
import type { AlertsResponse, BfcmResponse, ConceptsResponse } from "../shared/api.ts";
import type { Env } from "./env.ts";
import app from "./index.ts";
import { attribute } from "./meta/sync.ts";
import { testDb } from "./testing/db.ts";

let env: Env;
const get = async <T>(path: string) =>
  (await (await app.fetch(new Request(`https://hub.test${path}`), env, {} as ExecutionContext)).json()) as T;

async function ad(id: string, post: string, adset: string, campaign: string, status = "ACTIVE") {
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO posts (id, media_type) VALUES (?1, 'image')").bind(post),
    env.DB.prepare(
      "INSERT INTO ads (id, post_id, name, adset_id, adset_name, campaign_name, status, created_time) VALUES (?1, ?2, ?1, ?3, ?3, ?4, ?5, '2026-11-01T00:00:00Z')",
    ).bind(id, post, adset, campaign, status),
  ]);
}
async function day(adId: string, date: string, spend: number, purchases: number, revenue: number) {
  await env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, impressions, link_clicks, purchases, revenue_cents, reach) VALUES (?1, ?2, ?3, 1000, 20, ?4, ?5, 900)")
    .bind(adId, date, spend * 100, purchases, revenue * 100)
    .run();
}

beforeEach(async () => {
  env = { DB: await testDb(), META_APP_ID: "x", META_AD_ACCOUNT_ID: "act_1", META_GRAPH_VERSION: "v26.0", ACCESS_TEAM_DOMAIN: "" } as Env;
  await ad("bf-1", "p1", "Shameer | Black Friday | The Apology", "CBO | Promo | BFCM");
  await ad("bf-2", "p2", "Statics | Black Friday | Batch #1", "CBO | Promo | BFCM", "PAUSED");
  // A copy of p1 outside the promo: not counted on the BFCM page.
  await ad("cc-1", "p1", "Cost Cap | Scale", "CBO | Cost Cap | Scale (New)");
  // A normal Shameer test, which is a concept.
  await ad("t-1", "p3", "Shameer | Static | Test", "CBO | Internal Pod | Testing");
  await day("bf-1", "2026-11-08", 60, 3, 150);
  await day("bf-1", "2026-11-09", 40, 2, 100);
  await day("bf-2", "2026-11-09", 10, 0, 0);
  await day("cc-1", "2026-11-09", 500, 20, 1000);
  await day("t-1", "2026-11-09", 120, 9, 300);
  await day("bf-1", "2026-11-07", 99, 1, 1); // before the promo
  await attribute(env.DB);
});

describe("BFCM", () => {
  it("lists the promo's posts with only their days in the promo campaign", async () => {
    const r = await get<BfcmResponse>("/api/bfcm");
    expect(r.from).toBe("2026-11-08");
    const p1 = r.ads.find((a) => a.postId === "p1")!;
    expect(p1.adsets).toEqual(["Shameer | Black Friday | The Apology"]);
    expect(p1.active).toBe(true);
    expect(p1.daily.map((d) => [d.date, d.spendCents])).toEqual([
      ["2026-11-08", 6000],
      ["2026-11-09", 4000],
    ]);
    expect(r.ads.find((a) => a.postId === "p2")!.active).toBe(false);
    expect(r.ads.map((a) => a.postId).sort()).toEqual(["p1", "p2"]);
  });

  it("keeps promo ad sets out of the pods' concepts (hit rate)", async () => {
    const { rows } = await get<ConceptsResponse>("/api/concepts?range=all");
    expect(rows.map((c) => c.adsetName)).toEqual(["Shameer | Static | Test"]);
  });

  it("alerts on ads to scale during the promo", async () => {
    const { alerts } = await get<AlertsResponse>("/api/alerts");
    // p1: $100 in the promo at 2.5 ROAS, all in the last 3 days.
    expect(alerts.find((a) => a.id.startsWith("bfcm-scale:"))).toMatchObject({ title: "BFCM: 1 to scale", href: "#/bfcm" });
    expect(alerts.some((a) => a.id.startsWith("bfcm-cut:"))).toBe(false);
  });
});
