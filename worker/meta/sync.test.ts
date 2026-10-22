import { beforeEach, describe, expect, it } from "vitest";
import app from "../index.ts";
import type { Env } from "../env.ts";
import { testDb } from "../testing/db.ts";
import { attribute, chooseThumbnail, runSync, thumbnailNeedsRefresh, wipeSampleData } from "./sync.ts";
import type { GraphAd, GraphInsight } from "./transform.ts";

const ACT = "act_2930078677198801";
const POST_HXM = "776862388850901_122144302635047339";

// Shaped like real Graph API responses from the Kojeva account.
const ADS: GraphAd[] = [
  {
    id: "120250321798060075",
    name: "HxM-1-ANIMSONG-Husband at Walmart | Post ID",
    effective_status: "PAUSED",
    created_time: "2026-09-20T10:00:00-0400",
    adset: { id: "as1", name: "ABO | Harris | Sept 20" },
    campaign: { id: "c1", name: "ABO | Creative Testing" },
    creative: {
      id: "959193566785002",
      effective_object_story_id: POST_HXM,
      thumbnail_url: "https://scontent.example/t1.jpg",
      object_type: "VIDEO",
      video_id: "1053927990294150",
    },
  },
  {
    id: "120250321798060999",
    name: "HxM-1-ANIMSONG-Husband at Walmart | Post ID - Copy",
    effective_status: "ACTIVE",
    created_time: "2026-09-28T10:00:00-0400",
    adset: { id: "as9", name: "Cost Cap | Scale" },
    campaign: { id: "c9", name: "Cost Cap | Scale" },
    creative: { id: "959193566785003", effective_object_story_id: POST_HXM, object_type: "VIDEO" },
  },
  {
    id: "120250321790210075",
    name: "GS_SA_COMPARISON VSL_HARRIS-h2 | Post ID",
    effective_status: "ACTIVE",
    created_time: "2026-10-01T10:00:00-0400",
    adset: { id: "as2", name: "Broad | Oct" },
    campaign: { id: "c1", name: "ABO | Creative Testing" },
    creative: { id: "983026154843231", effective_object_story_id: "776862388850901_122144514117047339", object_type: "VIDEO" },
  },
  {
    id: "120241757339710001",
    name: "Video 30",
    effective_status: "ACTIVE",
    created_time: "2026-06-02T10:00:00-0400",
    adset: { id: "as5", name: "Top Spenders From ABO" },
    campaign: { id: "c9", name: "Cost Cap | Scale" },
    creative: { id: "111", effective_object_story_id: "776862388850901_111", object_type: "VIDEO" },
  },
  {
    id: "120241980715400001",
    name: "V457 | CBO",
    effective_status: "ACTIVE",
    created_time: "2026-08-10T10:00:00-0400",
    adset: { id: "as6", name: "ME | R2-S12 | Statics" },
    campaign: { id: "c1", name: "ABO | Creative Testing" },
    creative: {
      id: "222",
      effective_object_story_id: "776862388850901_222",
      object_type: "PHOTO",
      image_url: "https://x/i2.jpg",
      image_hash: "b1679ce60dbda9e125c26e84d9f82e94",
    },
  },
  {
    id: "120250321829620075",
    name: "Copy of 22v1",
    effective_status: "ACTIVE",
    created_time: "2026-10-02T10:00:00-0400",
    adset: { id: "as3", name: "ABO - Dhia - Batch 22" },
    campaign: { id: "c1", name: "ABO | Creative Testing" },
    creative: { id: "1786756512545527", effective_object_story_id: "776862388850901_122144074965047339", image_url: "https://scontent.example/i.jpg", object_type: "PHOTO" },
  },
];

const purchases = (n: number, value: number) => ({
  actions: [{ action_type: "omni_purchase", value: String(n) }],
  action_values: [{ action_type: "omni_purchase", value: String(value) }],
});

function insights(): GraphInsight[] {
  return [
    { ad_id: "120250321798060075", date_start: "2026-10-08", spend: "100.50", impressions: "5000", inline_link_clicks: "150", ...purchases(8, 190) },
    { ad_id: "120250321798060999", date_start: "2026-10-08", spend: "300", impressions: "15000", inline_link_clicks: "420", ...purchases(20, 520) },
    { ad_id: "120250321829620075", date_start: "2026-10-09", spend: "50", impressions: "2000", inline_link_clicks: "40", ...purchases(2, 40) },
    // Deleted in Meta, so missing from /ads, but it has history.
    { ad_id: "999", ad_name: "Video 12", adset_name: "ABO | Ali | Old", date_start: "2026-10-09", spend: "25", impressions: "900", inline_link_clicks: "10" },
  ];
}

type Handler = (url: URL) => unknown;

function fakeMeta(handler: Handler): typeof fetch & { calls: URL[] } {
  const calls: URL[] = [];
  const f = (async (input: string) => {
    const url = new URL(input);
    calls.push(url);
    const body = handler(url);
    return Response.json(body, { status: (body as { error?: unknown }).error ? 400 : 200 });
  }) as unknown as typeof fetch & { calls: URL[] };
  f.calls = calls;
  return f;
}

/** Serves ADS over two pages, and insights for any range. */
const metaHandler =
  (insightRows: () => GraphInsight[] = insights): Handler =>
  (url) => {
    if (url.pathname.endsWith(`${ACT}/ads`)) {
      if (url.searchParams.get("after") === "p2") return { data: ADS.slice(3) };
      const next = new URL(url);
      next.searchParams.set("after", "p2");
      return { data: ADS.slice(0, 3), paging: { next: next.toString() } };
    }
    if (url.pathname.endsWith(`${ACT}/insights`)) return { data: insightRows() };
    return { error: { message: `Unexpected ${url.pathname}`, code: 100 } };
  };
const metaApi = (insightRows?: () => GraphInsight[]) => fakeMeta(metaHandler(insightRows));

let env: Env;
beforeEach(async () => {
  env = {
    DB: await testDb(),
    META_APP_ID: "2206600029921100",
    META_AD_ACCOUNT_ID: ACT,
    META_GRAPH_VERSION: "v26.0",
    META_SYSTEM_TOKEN: "test-token",
  };
});

const q = <T,>(sql: string, ...p: unknown[]) => env.DB.prepare(sql).bind(...p).all<T>().then((r) => r.results);

describe("runSync", () => {
  it("syncs ads, groups copies, attributes pods and loads daily metrics", async () => {
    const meta = metaApi();
    const result = await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, meta);
    expect(result).toMatchObject({ ok: true, ads: 6, posts: 5, rows: 4 });

    // Paging followed, account and version used, token sent.
    const adsCalls = meta.calls.filter((u) => u.pathname === `/v26.0/${ACT}/ads`);
    expect(adsCalls).toHaveLength(2);
    expect(adsCalls[0]!.searchParams.get("access_token")).toBe("test-token");
    const insightCall = meta.calls.find((u) => u.pathname.endsWith("/insights"))!;
    expect(insightCall.searchParams.get("level")).toBe("ad");
    expect(JSON.parse(insightCall.searchParams.get("time_range")!)).toEqual({ since: "2026-10-08", until: "2026-10-14" });

    // Both HxM ads share one post; the pod comes from the original ABO ad set, not the Scale copy.
    const pods = await q<{ post_id: string; pod_id: string | null; pod_source: string | null }>(
      "SELECT post_id, pod_id, pod_source FROM assignments ORDER BY post_id",
    );
    expect(pods).toContainEqual({ post_id: POST_HXM, pod_id: "harris", pod_source: "adset" });
    expect(pods).toContainEqual({ post_id: "776862388850901_122144514117047339", pod_id: "harris", pod_source: "name" });
    expect(pods).toContainEqual({ post_id: "776862388850901_122144074965047339", pod_id: "dhia", pod_source: "adset" });
    expect(pods).toContainEqual({ post_id: "ad:999", pod_id: "ali", pod_source: "adset" });
    // Agency: by ad set prefix, and by launching before the first strategist-named ad set (Sept 20).
    expect(pods).toContainEqual({ post_id: "776862388850901_222", pod_id: "agency", pod_source: "adset" });
    expect(pods).toContainEqual({ post_id: "776862388850901_111", pod_id: "agency", pod_source: "era" });

    // Testing ad sets become concepts; scaling ad sets don't.
    const concepts = await q<{ id: string; pod_id: string; label: string }>("SELECT id, pod_id, label FROM concepts ORDER BY id");
    expect(concepts).toEqual([
      { id: "as1", pod_id: "harris", label: "ABO | Harris | Sept 20" },
      { id: "as3", pod_id: "dhia", label: "ABO - Dhia - Batch 22" },
      { id: "as6", pod_id: "agency", label: "R2-S12 | Statics" },
    ]);
    // Ads whose media Meta hides stand in with their post, so Claude can still label them.
    expect((await q<{ asset_id: string }>("SELECT asset_id FROM ads WHERE id = '120241757339710001'"))[0]!.asset_id).toBe("p:776862388850901_111");
    const assets = await q<{ id: string; asset_id: string | null }>("SELECT id, asset_id FROM ads WHERE asset_id NOT LIKE 'p:%' ORDER BY id");
    expect(assets).toEqual([
      { id: "120241980715400001", asset_id: "i:b1679ce60dbda9e125c26e84d9f82e94" },
      { id: "120250321798060075", asset_id: "v:1053927990294150" },
    ]);
    const [copy] = await q<{ concept_id: string | null }>("SELECT concept_id FROM ads WHERE id = '120250321798060999'");
    expect(copy!.concept_id).toBeNull();

    const [post] = await q<{ media_type: string; thumbnail_url: string }>("SELECT media_type, thumbnail_url FROM posts WHERE id = ?1", POST_HXM);
    expect(post).toEqual({ media_type: "video", thumbnail_url: "https://scontent.example/t1.jpg" });

    const [daily] = await q<{ spend: number; purchases: number; revenue: number }>(
      `SELECT SUM(spend_cents) spend, SUM(purchases) purchases, SUM(revenue_cents) revenue
       FROM ad_daily d JOIN ads a ON a.id = d.ad_id WHERE a.post_id = ?1`,
      POST_HXM,
    );
    expect(daily).toEqual({ spend: 40050, purchases: 28, revenue: 71000 });
  });

  it("replaces the window on re-sync and keeps manual pods", async () => {
    await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, metaApi());
    await env.DB.prepare("UPDATE assignments SET pod_id = 'shameer', pod_source = 'manual' WHERE post_id = ?1").bind(POST_HXM).run();

    // Meta revised Oct 8 and dropped the deleted ad's row.
    const revised = () => insights().filter((r) => r.ad_id !== "999").map((r) => (r.ad_id === "120250321798060075" ? { ...r, spend: "110" } : r));
    await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, metaApi(revised));

    const [hxm] = await q<{ pod_id: string; pod_source: string }>("SELECT pod_id, pod_source FROM assignments WHERE post_id = ?1", POST_HXM);
    expect(hxm).toEqual({ pod_id: "shameer", pod_source: "manual" });
    const rows = await q<{ ad_id: string; spend_cents: number }>("SELECT ad_id, spend_cents FROM ad_daily ORDER BY ad_id");
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.ad_id === "120250321798060075")!.spend_cents).toBe(11000);
  });

  it("serves synced data through the API as live", async () => {
    await env.DB.prepare("INSERT INTO sync_runs (source, started_at, status) VALUES ('sample', '2026-10-01', 'ok')").run();
    await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, metaApi());
    const metaRes = await app.fetch(new Request("https://hub.test/api/meta"), env, {} as ExecutionContext);
    expect(await metaRes.json()).toMatchObject({ dataMode: "live", latestDate: "2026-10-09", accessProtected: false });

    const res = await app.fetch(new Request("https://hub.test/api/rankings?range=all"), env, {} as ExecutionContext);
    const body = (await res.json()) as { items: { postId: string; name: string; copies: number; assignment: { podId: string } }[] };
    expect(body.items[0]).toMatchObject({ postId: POST_HXM, name: "HxM-1-ANIMSONG-Husband at Walmart | Post ID", copies: 2, assignment: { podId: "harris" } });
  });

  it("writes nothing when a re-sync finds nothing changed", async () => {
    const first = await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, metaApi());
    expect(first.written).toBeGreaterThan(0);
    const changes = async () => (await env.DB.prepare("SELECT total_changes() AS n").first<{ n: number }>())!.n;
    const before = await changes();
    const second = await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, metaApi());
    expect(second.written).toBe(0);
    // Only the sync_runs row (insert + finish update) is written.
    expect((await changes()) - before).toBe(2);
  });

  it("never lets an incomplete day from Meta (purchases, no spend) wipe stored spend, and keeps one row per ad and day", async () => {
    await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, metaApi());
    const ad = "120250321798060075";
    // Meta sends Oct 8 twice: the full row, then a copy with purchases and no delivery.
    const repeated = () => [...insights(), { ad_id: ad, date_start: "2026-10-08", spend: "0", impressions: "0", inline_link_clicks: "0", ...purchases(8, 190) }];
    await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: false }, metaApi(repeated));
    const spend = async () => (await q<{ spend_cents: number; purchases: number }>("SELECT spend_cents, purchases FROM ad_daily WHERE ad_id = ?1", ad))[0];
    expect(await spend()).toEqual({ spend_cents: 10050, purchases: 8 });

    // Only the incomplete copy arrives (purchases revised to 9): spend stays, purchases update, and the sync says so.
    const incomplete = () => insights().map((r) => (r.ad_id === ad ? { ...r, spend: "0", impressions: "0", inline_link_clicks: "0", ...purchases(9, 210) } : r));
    const res = await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: false }, metaApi(incomplete));
    expect(res.incomplete).toBe(1);
    expect(await spend()).toEqual({ spend_cents: 10050, purchases: 9 });
  });

  it("judges a slow concept up to the day one ad crossed $100", async () => {
    await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, metaApi());
    // Dhia's concept (one ad): $50 on Oct 9, then $20/day, crossing $100 on Oct 12 (day 4).
    const ad = "120250321829620075";
    await env.DB.batch(
      ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"].map((d) =>
        env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES (?1, ?2, 2000, 2, 5000)").bind(ad, d),
      ),
    );
    const res = await app.fetch(new Request("https://hub.test/api/concepts?range=all&pod=dhia"), env, {} as ExecutionContext);
    const [concept] = ((await res.json()) as { rows: Record<string, unknown>[] }).rows;
    expect(concept).toMatchObject({
      firstSpend: "2026-10-09",
      qualifiedOn: "2026-10-12",
      windowEnd: "2026-10-12",
      window: { spendCents: 11000, purchases: 8, revenueCents: 19000 },
      status: "hit", // $13.75 CPA, 1.73 ROAS
    });
  });

  it("shrinks the page size when Meta says a page is too much data", async () => {
    const base = metaHandler();
    const limits: number[] = [];
    const picky = fakeMeta((url) => {
      if (url.pathname.endsWith("/ads") || url.pathname.endsWith("/insights")) {
        const limit = Number(url.searchParams.get("limit"));
        limits.push(limit);
        if (limit > 60) return { error: { message: "Please reduce the amount of data you're asking for, then retry your request", code: 1 } };
      }
      return base(url);
    });
    const result = await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, picky);
    expect(result).toMatchObject({ ok: true, ads: 6, rows: 4 });
    expect(limits.slice(0, 3)).toEqual([200, 100, 50]);
  });

  it("records an expired token as needing reconnection", async () => {
    const expired = fakeMeta(() => ({ error: { message: "Error validating access token: Session has expired", code: 190 } }));
    const result = await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, expired);
    expect(result).toMatchObject({ ok: false, reconnect: true });
    const [run] = await q<{ status: string; message: string }>("SELECT status, message FROM sync_runs ORDER BY id DESC LIMIT 1");
    expect(run).toEqual({ status: "error", message: "Error validating access token: Session has expired" });
  });
});

describe("many concepts", () => {
  it("loads more concepts than fit in one D1 query", async () => {
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 80; i++) {
      stmts.push(
        env.DB.prepare("INSERT INTO posts (id, media_type) VALUES (?1, 'video')").bind(`p${i}`),
        env.DB.prepare(
          "INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time) VALUES (?1, ?2, ?3, ?4, ?5, 'ACTIVE', '2026-10-01T00:00:00.000Z')",
        ).bind(`a${i}`, `p${i}`, `Static ${i}`, `as${i}`, `Shameer | Static ${i} | Test`),
        env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES (?1, '2026-10-01', 12000, 9, 21000)").bind(`a${i}`),
      );
    }
    await env.DB.batch(stmts);
    await attribute(env.DB);
    for (const path of ["/api/concepts?range=all", "/api/pods?range=all", "/api/rankings?range=all"]) {
      const res = await app.fetch(new Request(`https://hub.test${path}`), env, {} as ExecutionContext);
      expect(res.status, path).toBe(200);
    }
    const res = await app.fetch(new Request("https://hub.test/api/concepts?range=all"), env, {} as ExecutionContext);
    const rows = ((await res.json()) as { rows: { window: { spendCents: number } }[] }).rows;
    expect(rows).toHaveLength(80);
    expect(rows.every((r) => r.window.spendCents === 12000)).toBe(true);
  });
});

describe("thumbnails", () => {
  const TINY = "https://scontent.example/v/t1.jpg?stp=c0.5000x0.5000f_dst-emg0_p64x64_q75_tt6";
  const SHARP = "https://scontent.example/v/frame.jpg";

  it("keeps a valid stored one, upgrades a 64px one, and drops the Page logo of hidden media", () => {
    expect(chooseThumbnail(SHARP, "https://scontent.example/other.jpg", false)).toBe(SHARP);
    expect(chooseThumbnail(TINY, SHARP, false)).toBe(SHARP);
    expect(chooseThumbnail(TINY, TINY.replace("t1", "t2"), false)).toBe(TINY); // no sharper one: no churn
    expect(chooseThumbnail(undefined, TINY, false)).toBe(TINY);
    expect(chooseThumbnail(TINY, TINY, true)).toBeNull();
  });

  it("uses the video's own cover frame, and writes nothing on a re-sync", async () => {
    const ads: GraphAd[] = [
      { ...ADS[0]!, creative: { ...ADS[0]!.creative!, thumbnail_url: TINY } },
      // A "Post ID" ad whose post the token can't read: Meta returns the Page logo.
      {
        ...ADS[2]!,
        creative: { id: "cr-hidden", effective_object_story_id: "776862388850901_1516733839978074", object_type: "PRIVACY_CHECK_FAIL", thumbnail_url: TINY },
      },
    ];
    const meta = () =>
      fakeMeta((url) => {
        if (url.searchParams.has("ids")) {
          expect(url.searchParams.get("ids")).toBe("1053927990294150");
          return { "1053927990294150": { thumbnails: { data: [{ uri: "https://scontent.example/small.jpg", width: 200 }, { uri: SHARP, width: 1080, is_preferred: true }] } } };
        }
        if (url.pathname.endsWith(`${ACT}/ads`)) return { data: ads };
        if (url.pathname.endsWith(`${ACT}/insights`)) return { data: [] };
        return { error: { message: `Unexpected ${url.pathname}`, code: 100 } };
      });
    await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, meta());
    const thumbs = await env.DB.prepare("SELECT id, thumbnail_url FROM posts ORDER BY id").all<{ id: string; thumbnail_url: string | null }>();
    expect(Object.fromEntries(thumbs.results.map((r) => [r.id, r.thumbnail_url]))).toEqual({
      [POST_HXM]: SHARP,
      "776862388850901_1516733839978074": null,
    });
    const again = meta();
    expect((await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, again)).written).toBe(0);
    // The cover isn't fetched again once a sharp one is stored.
    expect(again.calls.some((u) => u.searchParams.has("ids"))).toBe(false);
  });

  it("shows the Facebook feed image of an ad with one image per placement, and writes nothing on a re-sync", async () => {
    const STORY = "https://scontent.example/story.png";
    const FEED = "https://scontent.example/feed.png";
    const post = "776862388850901_122147682321047339";
    const spec = (rules: boolean) => ({
      images: [
        { hash: "h-story", adlabels: [{ name: "story" }] },
        { hash: "h-feed", adlabels: [{ name: "feed" }] },
      ],
      asset_customization_rules: rules
        ? [
            { customization_spec: { publisher_platforms: ["facebook"], facebook_positions: ["story"] }, image_label: { name: "story" }, priority: 1 },
            { customization_spec: { publisher_platforms: ["facebook"], facebook_positions: ["feed"] }, image_label: { name: "feed" }, priority: 2 },
          ]
        : [],
    });
    const meta = (rules: boolean) =>
      fakeMeta((url) => {
        if (url.pathname.endsWith(`${ACT}/adimages`))
          return {
            data: [
              { hash: "h-story", url: STORY, width: 1080, height: 1920 },
              { hash: "h-feed", url: FEED, width: 1080, height: 1350 },
            ],
          };
        if (url.pathname.endsWith(`${ACT}/ads`))
          return {
            data: [
              {
                id: "120250303598690075",
                name: "1",
                adset: { id: "as9", name: "Shameer | Static 3 | Negative Marketing #2" },
                creative: { id: "1709247247216003", effective_object_story_id: post, object_type: "SHARE", thumbnail_url: STORY, asset_feed_spec: spec(rules) },
              },
            ],
          };
        if (url.pathname.endsWith(`${ACT}/insights`)) return { data: [] };
        return { error: { message: `Unexpected ${url.pathname}`, code: 100 } };
      });
    const thumb = async () => (await env.DB.prepare("SELECT thumbnail_url, thumb_hash FROM posts WHERE id = ?1").bind(post).first())!;

    await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, meta(true));
    expect(await thumb()).toEqual({ thumbnail_url: FEED, thumb_hash: "h-feed" });
    const again = meta(true);
    expect((await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, again)).written).toBe(0);
    expect(again.calls.some((u) => u.pathname.endsWith("/adimages"))).toBe(false);

    // Without placement rules, the feed-shaped image (4:5, not 9:16) wins.
    await env.DB.prepare("UPDATE posts SET thumb_hash = NULL").run();
    await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, meta(false));
    expect(await thumb()).toEqual({ thumbnail_url: FEED, thumb_hash: "h-feed" });
  });
});

describe("thumbnailNeedsRefresh", () => {
  const now = Date.parse("2026-10-16T00:00:00Z");
  const at = (iso: string) => `https://scontent.xx.fbcdn.net/v/t45/a.jpg?stp=x&oe=${(Date.parse(iso) / 1000).toString(16).toUpperCase()}`;
  it("keeps a stored URL until three days before it expires", () => {
    expect(thumbnailNeedsRefresh(at("2026-10-25T00:00:00Z"), now)).toBe(false);
    expect(thumbnailNeedsRefresh(at("2026-10-18T00:00:00Z"), now)).toBe(true);
    expect(thumbnailNeedsRefresh(null, now)).toBe(true);
  });
});

describe("wipeSampleData", () => {
  it("clears sample rows before the first live sync, and never after", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO posts (id, media_type) VALUES ('post_1000', 'video')"),
      env.DB.prepare("INSERT INTO ads (id, post_id, name, status) VALUES ('ad_1000_0', 'post_1000', 'Video 1', 'ACTIVE')"),
      env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents) VALUES ('ad_1000_0', '2026-10-01', 500)"),
      env.DB.prepare("INSERT INTO sync_runs (source, started_at, status) VALUES ('sample', '2026-10-01', 'ok')"),
    ]);
    expect(await wipeSampleData(env.DB)).toBe(true);
    expect(await q("SELECT * FROM ads")).toHaveLength(0);

    await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, metaApi());
    expect(await wipeSampleData(env.DB)).toBe(false);
    expect((await q("SELECT * FROM ads")).length).toBeGreaterThan(0);
  });
});

describe("guards", () => {
  it("refuses to connect or sync until Cloudflare Access is configured", async () => {
    for (const [path, init] of [
      ["/api/connection/token", { method: "POST", body: JSON.stringify({ token: "x".repeat(40) }) }],
      ["/api/sync", { method: "POST", body: JSON.stringify({ since: "2026-10-01", until: "2026-10-07" }) }],
      ["/api/connection/facebook/start", {}],
    ] as const) {
      const res = await app.fetch(new Request(`https://hub.test${path}`, init), env, {} as ExecutionContext);
      expect(res.status, path).toBe(403);
    }
  });

  it("requires an Access sign-in on every API call once configured", async () => {
    const locked = { ...env, ACCESS_TEAM_DOMAIN: "kojeva.cloudflareaccess.com" };
    const res = await app.fetch(new Request("https://hub.test/api/rankings"), locked, {} as ExecutionContext);
    expect(res.status).toBe(401);
  });
});

describe("attribution comparison (7-day click and incremental)", () => {
  // With action_attribution_windows, Meta adds a key per window to each action.
  const windowed = (url: URL): GraphInsight[] =>
    url.searchParams.has("action_attribution_windows")
      ? [
          {
            ad_id: "120250321798060075",
            date_start: "2026-10-08",
            actions: [{ action_type: "omni_purchase", value: "8", "7d_click": "6", incrementality: "2.5" }],
            action_values: [{ action_type: "omni_purchase", value: "190", "7d_click": "150", incrementality: "61.2" }],
          },
          // No default row exists for this one, so it's ignored.
          { ad_id: "424242", date_start: "2026-10-08", actions: [{ action_type: "omni_purchase", value: "1", "7d_click": "1", incrementality: "1" }] },
        ]
      : insights();

  it("stores both windows beside the default numbers, from a separate request, and re-syncs with 0 writes", async () => {
    const meta = fakeMeta((url) => (url.pathname.endsWith(`${ACT}/insights`) ? { data: windowed(url) } : metaHandler()(url)));
    await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, meta);

    const calls = meta.calls.filter((u) => u.pathname.endsWith("/insights"));
    expect(calls.map((u) => u.searchParams.get("action_attribution_windows"))).toEqual([null, '["7d_click","incrementality"]']);
    const [row] = await q<Record<string, number | null>>(
      "SELECT purchases, revenue_cents, purchases_7dc, revenue_7dc_cents, purchases_inc_milli, revenue_inc_cents FROM ad_daily WHERE ad_id = '120250321798060075'",
    );
    expect(row).toEqual({ purchases: 8, revenue_cents: 19000, purchases_7dc: 6, revenue_7dc_cents: 15000, purchases_inc_milli: 2500, revenue_inc_cents: 6120 });
    // Ads Meta returned nothing for keep NULL (unknown), not 0.
    const [other] = await q<{ purchases_inc_milli: number | null }>("SELECT purchases_inc_milli FROM ad_daily WHERE ad_id = '120250321829620075'");
    expect(other!.purchases_inc_milli).toBeNull();

    const again = await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: false }, meta);
    expect(again.written).toBe(0);
  });

  it("keeps syncing when Meta refuses the comparison windows, and says so", async () => {
    const meta = fakeMeta((url) =>
      url.pathname.endsWith(`${ACT}/insights`) && url.searchParams.has("action_attribution_windows")
        ? { error: { message: "Invalid parameter", code: 100 } }
        : metaHandler()(url),
    );
    const result = await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, meta);
    expect(result.ok).toBe(true);
    const [run] = await q<{ status: string; message: string }>("SELECT status, message FROM sync_runs ORDER BY id DESC LIMIT 1");
    expect(run!.status).toBe("ok");
    expect(run!.message).toContain("7-day click / incremental not available");
  });
});
