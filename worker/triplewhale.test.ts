import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "./index.ts";
import type { Env } from "./env.ts";
import type { PostDetail, RankingsResponse } from "../shared/api.ts";
import { attribute } from "./meta/sync.ts";
import { accessFixture, TEST_TEAM } from "./testing/access.ts";
import { testDb } from "./testing/db.ts";

const CLIENT_ID = "abc123.access";
const MODEL = "Clicks & Views";
let env: Env;
let service: Record<string, string>;
let person: Record<string, string>;

beforeAll(async () => {
  ({ headers: service } = await accessFixture(undefined, CLIENT_ID));
  ({ headers: person } = await accessFixture("nosa@kojeva.com"));
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
  // Two copies of one post (ad IDs as Triple Whale reports them), and a second post.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO posts (id, media_type) VALUES ('p1', 'video'), ('p2', 'video')"),
    env.DB.prepare(
      `INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time) VALUES
       ('120250145707460075', 'p1', 'Copy of KoJeva Matthew 35v1', 's1', 'IH | Harris | KOJEVA 35', 'ACTIVE', '2026-10-01T00:00:00.000Z'),
       ('120250145707460076', 'p1', 'Copy of KoJeva Matthew 35v1 - Copy', 's2', 'CBO | Scale', 'ACTIVE', '2026-10-02T00:00:00.000Z'),
       ('120250145707460099', 'p2', 'Video 30', 's3', 'Dhia | Static 26', 'ACTIVE', '2026-10-01T00:00:00.000Z')`,
    ),
    env.DB.prepare(
      `INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES
       ('120250145707460075', '2026-10-14', 50000, 20, 60000), ('120250145707460076', '2026-10-14', 50000, 20, 60000),
       ('120250145707460075', '2026-10-15', 40000, 10, 30000), ('120250145707460099', '2026-10-15', 20000, 5, 9000)`,
    ),
  ]);
  await attribute(env.DB);
});

const call = (path: string, headers: Record<string, string>, init: RequestInit = {}) =>
  app.fetch(new Request(`https://hub.test${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }), env, {} as ExecutionContext);
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

/** One day for post p1's first ad and post p2, from a Triple Whale per-ad query (fractional orders). */
const OCT15 = {
  date: "2026-10-15",
  ads: [
    { adId: "120250145707460075", orders: 12.5, revenue: 410.2 },
    { adId: "120250145707460099", orders: 3.25, revenue: 95 },
  ],
};

describe("Triple Whale ingest", () => {
  it("only lets the sync service token in", async () => {
    expect((await call("/api/ingest/tw/pending", person)).status).toBe(403);
    expect((await call("/api/ingest/tw", person, post({ model: MODEL, days: [OCT15] }))).status).toBe(403);
    expect((await call("/api/ingest/tw/pending", service)).status).toBe(200);
  });

  it("lists days with Meta data that still need Triple Whale, newest first", async () => {
    const res = (await (await call("/api/ingest/tw/pending", service)).json()) as { model: string; dates: string[] };
    expect(res).toEqual({ model: MODEL, dates: ["2026-10-15", "2026-10-14"] });
  });

  it("stores a day, shows it beside Meta's numbers, and writes nothing on an unchanged re-send", async () => {
    let res = (await (await call("/api/ingest/tw", service, post({ model: MODEL, days: [OCT15] }))).json()) as Record<string, number>;
    expect(res).toMatchObject({ days: 1, rows: 2, written: 2, removed: 0, writes: 3 });

    const r = (await (await call("/api/rankings?range=all", person)).json()) as RankingsResponse;
    expect(r.twCoverage).toMatchObject({ days: 2, covered: 1, model: MODEL });
    const p1 = r.items.find((p) => p.postId === "p1")!;
    expect(p1.tw).toEqual({ purchases: 12.5, revenueCents: 41020 });
    expect(p1.totals.purchases).toBe(50); // Meta's own number is untouched
    expect(r.tw).toEqual({ purchases: 15.75, revenueCents: 50520 });

    res = (await (await call("/api/ingest/tw", service, post({ model: MODEL, days: [OCT15] }))).json()) as Record<string, number>;
    expect(res).toMatchObject({ written: 0, removed: 0, writes: 0 });
  });

  it("treats each day as complete: an ad that dropped out is removed", async () => {
    await call("/api/ingest/tw", service, post({ model: MODEL, days: [OCT15] }));
    const res = (await (
      await call("/api/ingest/tw", service, post({ model: MODEL, days: [{ date: "2026-10-15", ads: [OCT15.ads[0]] }] }))
    ).json()) as Record<string, number>;
    expect(res).toMatchObject({ written: 0, removed: 1 });
    const d = (await (await call("/api/posts/p2?range=all", person)).json()) as PostDetail;
    expect(d.tw).toEqual({ purchases: 0, revenueCents: 0 });
  });

  it("leaves Triple Whale unknown (null), not zero, before any day is synced", async () => {
    const r = (await (await call("/api/rankings?range=all", person)).json()) as RankingsResponse;
    expect(r.tw).toBeNull();
    expect(r.items.every((p) => p.tw === null)).toBe(true);
  });

  it("skips rows Triple Whale couldn't tie to an ad", async () => {
    const day = { date: "2026-10-15", ads: [...OCT15.ads, { adId: "(not set)", orders: 1.5, revenue: 41.4 }, { adId: "{{ad.id}}", orders: 1, revenue: 22.9 }] };
    const res = (await (await call("/api/ingest/tw", service, post({ model: MODEL, days: [day] }))).json()) as Record<string, number>;
    expect(res).toMatchObject({ rows: 2, skipped: 2, written: 2 });
  });

  it("rejects the wrong model and malformed rows", async () => {
    for (const body of [
      { model: "Triple Attribution", days: [OCT15] },
      { model: MODEL, days: [{ date: "Oct 15", ads: [] }] },
      { model: MODEL, days: [{ date: "2026-10-15", ads: [{ adId: "1", orders: -1, revenue: 1 }] }] },
      { model: MODEL, days: [OCT15, OCT15] },
    ])
      expect((await call("/api/ingest/tw", service, post(body))).status).toBe(400);
  });
});
