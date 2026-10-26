import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app, { WARM_PATHS, warmDashboard } from "./index.ts";
import type { Env } from "./env.ts";
import { bumpStats, forgetMemory, readSnapshot, writeSnapshot } from "./cache.ts";
import { attribute } from "./meta/sync.ts";
import { accessFixture, TEST_TEAM } from "./testing/access.ts";
import { internalReadHeaders } from "./access.ts";
import { testDb } from "./testing/db.ts";

const CLIENT_ID = "abc123.access";
let env: Env;
let person: Record<string, string>;
let service: Record<string, string>;

beforeAll(async () => {
  ({ headers: person } = await accessFixture("nosa@kojeva.com"));
  ({ headers: service } = await accessFixture(undefined, CLIENT_ID));
});

beforeEach(async () => {
  env = {
    DB: await testDb(),
    META_APP_ID: "x",
    META_AD_ACCOUNT_ID: "act_1",
    META_GRAPH_VERSION: "v26.0",
    ACCESS_TEAM_DOMAIN: TEST_TEAM,
    ATRIA_CLIENT_ID: CLIENT_ID,
  };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO posts (id, media_type) VALUES ('p1', 'video')"),
    env.DB.prepare(
      "INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time, asset_id) VALUES ('111', 'p1', 'HxM-1', 's1', 'IH | Harris | KOJEVA 1', 'ACTIVE', '2026-10-01T00:00:00Z', 'v:1')",
    ),
    env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES ('111', '2026-10-10', 10000, 5, 20000)"),
  ]);
  await attribute(env.DB);
});

const call = (path: string, headers: Record<string, string>, init: RequestInit = {}) =>
  app.fetch(new Request(`https://hub.test${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }), env, {} as ExecutionContext);
const version = async () => (await env.DB.prepare("SELECT value FROM settings WHERE key = 'data_version'").first<{ value: string }>())!.value;

describe("read cache", () => {
  it("serves a repeat read from memory and recomputes after an edit", async () => {
    const first = await call("/api/rankings?range=all", person);
    expect(first.headers.get("X-Cache")).toBeNull();
    const again = await call("/api/rankings?range=all", person);
    expect(again.headers.get("X-Cache")).toBe("hit");
    expect(await again.json()).toEqual(await first.json());

    const before = await version();
    expect((await call("/api/posts/p1/assignment", person, { method: "PATCH", body: JSON.stringify({ podId: "dhia" }) })).status).toBe(200);
    expect(await version()).not.toBe(before);
    const after = await call("/api/rankings?range=all", person);
    expect(after.headers.get("X-Cache")).toBeNull();
    expect(((await after.json()) as { items: { assignment: { podId: string } }[] }).items[0]!.assignment.podId).toBe("dhia");
  });

  it("lets a fresh isolate reuse a result another one computed, until the data changes", async () => {
    const first = await call("/api/rankings?range=all", person);
    expect(first.headers.get("X-Cache")).toBeNull();
    forgetMemory(); // a new isolate: after a deploy, or another one serving a second viewer
    const again = await call("/api/rankings?range=all", person);
    expect(again.headers.get("X-Cache")).toBe("stored");
    expect(await again.json()).toEqual(await first.json());
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM snapshots").first<{ n: number }>())!.n).toBeGreaterThan(0);

    // An edit empties the stored responses, so nothing stale is served, but keeps the ad numbers
    // (concept results, test windows): a tag edit doesn't recompute them.
    const count = async (like: string) =>
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE key LIKE ?1").bind(like).first<{ n: number }>())!.n;
    expect(await count("stats:%")).toBeGreaterThan(0);
    expect((await call("/api/posts/p1/assignment", person, { method: "PATCH", body: JSON.stringify({ podId: "dhia" }) })).status).toBe(200);
    expect(await count("resp:%")).toBe(0);
    expect(await count("stats:%")).toBeGreaterThan(0);
    forgetMemory();
    const after = await call("/api/rankings?range=all", person);
    expect(after.headers.get("X-Cache")).toBeNull();
    expect(((await after.json()) as { items: { assignment: { podId: string } }[] }).items[0]!.assignment.podId).toBe("dhia");
  });

  it("regroups by the new pod right after a tag edit, without recomputing the ad numbers", async () => {
    const pods = async () => ((await (await call("/api/pods?range=all", person)).json()) as { rows: { podId: string | null; totals: { spendCents: number } }[] }).rows;
    const spendOf = (rows: Awaited<ReturnType<typeof pods>>, id: string) => rows.find((r) => r.podId === id)?.totals.spendCents ?? 0;
    expect(spendOf(await pods(), "harris")).toBe(10000);
    const stats = await env.DB.prepare("SELECT value FROM settings WHERE key = 'stats_version'").first<{ value: string }>();
    expect((await call("/api/posts/p1/assignment", person, { method: "PATCH", body: JSON.stringify({ podId: "dhia" }) })).status).toBe(200);
    const after = await pods();
    expect([spendOf(after, "harris"), spendOf(after, "dhia")]).toEqual([0, 10000]);
    // The edit kept the stats version: concept results and totals weren't recomputed.
    expect(await env.DB.prepare("SELECT value FROM settings WHERE key = 'stats_version'").first<{ value: string }>()).toEqual(stats);

    // "Rebuild summaries" in Settings recomputes them.
    expect((await call("/api/stats/rebuild", person, { method: "POST", body: "{}" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT value FROM settings WHERE key = 'stats_version'").first<{ value: string }>()).not.toEqual(stats);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM snapshots").first<{ n: number }>())!.n).toBe(0);
  });

  it("doesn't count an unchanged ingest push as a change", async () => {
    const body = JSON.stringify({ assets: [{ assetId: "v:1", status: "tagged", tags: { theme: ["Product Demo"] } }] });
    expect((await call("/api/ingest/atria", service, { method: "POST", body })).status).toBe(200);
    const v = await version();
    await call("/api/ingest/atria", service, { method: "POST", body });
    expect(await version()).toBe(v);
  });

  it("keeps the latest sync status current in a cached /meta", async () => {
    expect(((await (await call("/api/meta", person)).json()) as { lastSync: unknown }).lastSync).toBeNull();
    await env.DB.prepare("INSERT INTO sync_runs (source, started_at, finished_at, status, message) VALUES ('meta', 'x', 'y', 'ok', 'done')").run();
    expect(((await (await call("/api/meta", person)).json()) as { lastSync: { message: string } }).lastSync.message).toBe("done");
  });
});

describe("errors", () => {
  it("explains a D1 daily limit instead of failing silently", async () => {
    const broken = {
      prepare: () => {
        throw new Error("D1_ERROR: Exceeded maximum rows read for the day");
      },
    } as unknown as D1Database;
    const res = await app.fetch(new Request("https://hub.test/api/rankings", { headers: person }), { ...env, DB: broken }, {} as ExecutionContext);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/free daily limit.*00:00 UTC/);
  });
});

describe("large snapshots", () => {
  it("stores big results gzipped and reads them back unchanged", async () => {
    const db = await testDb();
    // About 2 MB of post-list-like JSON: over the size cap uncompressed, well under it gzipped.
    const rows = Array.from({ length: 4000 }, (_, i) => ({ post_id: `776862388850901_${i}`, tags: '{"theme":["Problem & Solution","Product Demo"],"persona":["Value-Focused Shopper"]}', thumb: `https://scontent.xx.fbcdn.net/v/t45/${"x".repeat(300)}` }));
    const text = JSON.stringify(rows);
    expect(text.length).toBeGreaterThan(900_000);
    await writeSnapshot(db, "memo:post-base", "v1", text);
    const raw = await db.prepare("SELECT body FROM snapshots WHERE key = 'memo:post-base'").first<{ body: string }>();
    expect(raw!.body.startsWith("gz:")).toBe(true);
    expect(raw!.body.length).toBeLessThan(900_000);
    expect(await readSnapshot(db, "memo:post-base", "v1")).toBe(text);
    // Small ones stay plain.
    await writeSnapshot(db, "memo:small", "v1", '{"a":1}');
    expect(await readSnapshot(db, "memo:small", "v1")).toBe('{"a":1}');
  });
});

describe("warm-up after a sync", () => {
  it("stores the dashboard's first reads one at a time, so visits read them instead of rebuilding them together", async () => {
    await bumpStats(env.DB);
    forgetMemory();
    expect(await warmDashboard(env, {} as ExecutionContext)).toBe(WARM_PATHS.length);
    // A fresh isolate (the next visitor) reads the stored result: no rebuild.
    forgetMemory();
    const res = await call("/api/rankings?range=month&sort=spend&limit=5", person);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("stored");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE key = 'stats:concept-numbers'").first<{ n: number }>()).toEqual({ n: 1 });
  });

  it("keeps its internal key to itself: a made-up one needs a sign-in, and it never writes", async () => {
    expect((await call("/api/rankings?range=month", { "X-Hub-Internal": "guess" })).status).toBe(401);
    // Even after the warm-up made its key, the header alone gets nowhere.
    await warmDashboard(env, {} as ExecutionContext);
    expect((await call("/api/rankings?range=month", { "X-Hub-Internal": "guess" })).status).toBe(401);
    expect((await call("/api/sync", { "X-Hub-Internal": "guess" }, { method: "POST", body: "{}" })).status).toBe(401);
    // The real key reads only.
    expect((await call("/api/sync", internalReadHeaders(), { method: "POST", body: "{}" })).status).toBe(401);
  });
});
