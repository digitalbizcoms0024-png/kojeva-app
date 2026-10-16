import { beforeEach, describe, expect, it } from "vitest";
import app from "../index.ts";
import type { Env } from "../env.ts";
import { testDb } from "../testing/db.ts";
import { runSync, wipeSampleData } from "./sync.ts";
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
    creative: { id: "959193566785002", effective_object_story_id: POST_HXM, thumbnail_url: "https://scontent.example/t1.jpg", object_type: "VIDEO" },
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
const metaApi = (insightRows: () => GraphInsight[] = insights) =>
  fakeMeta((url) => {
    if (url.pathname.endsWith(`${ACT}/ads`)) {
      if (url.searchParams.get("after") === "p2") return { data: ADS.slice(2) };
      const next = new URL(url);
      next.searchParams.set("after", "p2");
      return { data: ADS.slice(0, 2), paging: { next: next.toString() } };
    }
    if (url.pathname.endsWith(`${ACT}/insights`)) return { data: insightRows() };
    return { error: { message: `Unexpected ${url.pathname}`, code: 100 } };
  });

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
    expect(result).toMatchObject({ ok: true, ads: 4, posts: 3, rows: 4 });

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

  it("records an expired token as needing reconnection", async () => {
    const expired = fakeMeta(() => ({ error: { message: "Error validating access token: Session has expired", code: 190 } }));
    const result = await runSync(env, { since: "2026-10-08", until: "2026-10-14", ads: true }, expired);
    expect(result).toMatchObject({ ok: false, reconnect: true });
    const [run] = await q<{ status: string; message: string }>("SELECT status, message FROM sync_runs ORDER BY id DESC LIMIT 1");
    expect(run).toEqual({ status: "error", message: "Error validating access token: Session has expired" });
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
    const locked = { ...env, ACCESS_TEAM_DOMAIN: "kojeva.cloudflareaccess.com", ACCESS_AUD: "aud" };
    const res = await app.fetch(new Request("https://hub.test/api/rankings"), locked, {} as ExecutionContext);
    expect(res.status).toBe(401);
  });
});
