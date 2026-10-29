import { beforeEach, describe, expect, it } from "vitest";
import type { PostDetail, RankingsResponse } from "../shared/api.ts";
import type { Env } from "./env.ts";
import app from "./index.ts";
import { attribute } from "./meta/sync.ts";
import { testDb } from "./testing/db.ts";

let env: Env;

const get = async <T>(path: string) =>
  (await (await app.fetch(new Request(`https://hub.test${path}`), env, {} as ExecutionContext)).json()) as T;

async function ad(post: string, id: string, media: "image" | "video") {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO posts (id, media_type) VALUES (?1, ?2)").bind(post, media),
    env.DB.prepare(
      "INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time, asset_id) VALUES (?1, ?2, ?3, ?4, ?5, 'ACTIVE', '2026-10-01T00:00:00Z', ?1)",
    ).bind(id, post, `ST _ ${id}`, `s-${id}`, `IH | Harris | ${id}`),
  ]);
}

/** One day of $100 with optional outbound clicks / adds to cart / reach (null = not stored that day). */
async function day(adId: string, date: string, outbound: number | null, atc: number | null, reach: number | null) {
  await env.DB.prepare(
    "INSERT INTO ad_daily (ad_id, date, spend_cents, impressions, link_clicks, purchases, revenue_cents, outbound_clicks, add_to_cart, reach) VALUES (?1, ?2, 10000, 1000, 10, 5, 20000, ?3, ?4, ?5)",
  )
    .bind(adId, date, outbound, atc, reach)
    .run();
}

beforeEach(async () => {
  env = { DB: await testDb(), META_APP_ID: "x", META_AD_ACCOUNT_ID: "act_1", META_GRAPH_VERSION: "v26.0", ACCESS_TEAM_DOMAIN: "" } as Env;
  await ad("img", "a-img", "image");
  await ad("vid", "a-vid", "video");
  await day("a-img", "2026-10-10", 40, 8, 900);
  await day("a-img", "2026-10-11", 60, 12, 800);
  await day("a-vid", "2026-10-10", null, null, null);
  await day("a-vid", "2026-10-11", 50, 5, 700);
  await attribute(env.DB);
});

describe("Ad Swipe data", () => {
  it("filters rankings by format", async () => {
    const ids = async (q: string) => (await get<RankingsResponse>(`/api/rankings?range=all${q}`)).items.map((p) => p.postId).sort();
    expect(await ids("")).toEqual(["img", "vid"]);
    expect(await ids("&media=image")).toEqual(["img"]);
    expect(await ids("&media=video")).toEqual(["vid"]);
  });

  it("sums outbound clicks, adds to cart and reach, and shows — when a spend day lacks them", async () => {
    const img = await get<PostDetail>("/api/posts/img?range=all");
    expect(img.extra).toEqual({ outboundClicks: 100, addToCart: 20, reach: 1700 });
    expect(img.lastSpend).toBe("2026-10-11");
    const vid = await get<PostDetail>("/api/posts/vid?range=all");
    expect(vid.extra).toEqual({ outboundClicks: null, addToCart: null, reach: null });
  });
});
