import { beforeEach, describe, expect, it } from "vitest";
import type { FrequencyTrendResponse, PodsResponse, PostDetail, RankingsResponse } from "../shared/api.ts";
import { dailyFrequency } from "../shared/metrics.ts";
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

describe("Reach by pod", () => {
  beforeEach(async () => {
    // a-img (1.25 → middle: 100/80 and 150/120), a-vid (only the day with reach: 1000/700 → bottom); add a top-of-funnel Dhia ad.
    await env.DB.batch([
      env.DB.prepare("UPDATE ad_daily SET impressions = 100, reach = 80 WHERE ad_id = 'a-img' AND date = '2026-10-10'"),
      env.DB.prepare("UPDATE ad_daily SET impressions = 150, reach = 120 WHERE ad_id = 'a-img' AND date = '2026-10-11'"),
    ]);
    await ad("dhia", "a-dhia", "image");
    await env.DB.prepare("UPDATE ads SET adset_name = 'IH | Dhia | a-dhia' WHERE id = 'a-dhia'").run();
    await day("a-dhia", "2026-10-11", null, null, 950);
    await env.DB.prepare("UPDATE ad_daily SET impressions = 1000 WHERE ad_id = 'a-dhia'").run();
    await attribute(env.DB);
  });

  it("splits each pod's spend by its ads' bands and ranks ads by lowest frequency", async () => {
    const pods = await get<PodsResponse>("/api/pods?range=all");
    const harris = pods.rows.find((r) => r.podId === "harris")!;
    expect(harris.funnelSpend).toEqual({ top: 0, middle: 20000, bottom: 20000, unknown: 0 });
    // 250 + 1000 impressions with reach ÷ (200 + 700) people.
    expect(dailyFrequency(harris.totals)).toBeCloseTo(1250 / 900);
    expect(pods.rows.find((r) => r.podId === "dhia")!.funnelSpend.top).toBe(10000);
    const ranked = await get<RankingsResponse>("/api/rankings?range=all&sort=freq");
    expect(ranked.items.map((p) => p.postId)).toEqual(["dhia", "img", "vid"]);
  });

  it("gives each pod's weekly average daily frequency", async () => {
    const trend = await get<FrequencyTrendResponse>("/api/pods/frequency");
    expect(trend.weeks).toHaveLength(8);
    expect(trend.weeks.at(-1)).toBe("2026-10-05");
    expect(trend.pods.harris!.at(-1)).toEqual({ reachImpressions: 1250, reach: 900 });
    expect(trend.pods.dhia!.at(-1)).toEqual({ reachImpressions: 1000, reach: 950 });
  });
});
