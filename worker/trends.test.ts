import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "./index.ts";
import type { Env } from "./env.ts";
import type { TrendsResponse } from "../shared/api.ts";
import { attribute } from "./meta/sync.ts";
import { accessFixture, TEST_TEAM } from "./testing/access.ts";
import { testDb } from "./testing/db.ts";

let env: Env;
let person: Record<string, string>;

beforeAll(async () => {
  ({ headers: person } = await accessFixture("nosa@kojeva.com"));
});

beforeEach(async () => {
  env = { DB: await testDb(), META_APP_ID: "x", META_AD_ACCOUNT_ID: "act_1", META_GRAPH_VERSION: "v26.0", ACCESS_TEAM_DOMAIN: TEST_TEAM };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO posts (id, media_type) VALUES ('p1', 'video'), ('p2', 'video')"),
    env.DB.prepare(
      `INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time) VALUES
       ('a1', 'p1', 'v1', 's1', 'IH | Harris | KOJEVA 1', 'ACTIVE', '2026-10-01T00:00:00.000Z'),
       ('a2', 'p2', 'v2', 's2', 'Dhia | Static 26', 'ACTIVE', '2026-10-01T00:00:00.000Z')`,
    ),
    // Mon Oct 12 – Thu Oct 15, plus Sun Oct 11 (previous week).
    env.DB.prepare(
      `INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES
       ('a1', '2026-10-11', 10000, 5, 20000), ('a1', '2026-10-12', 10000, 4, 18000),
       ('a1', '2026-10-15', 10000, 6, 24000), ('a2', '2026-10-15', 5000, 1, 3000)`,
    ),
    env.DB.prepare("INSERT INTO tw_daily (ad_id, date, orders_milli, revenue_cents) VALUES ('a1', '2026-10-15', 4500, 15000)"),
    env.DB.prepare("INSERT INTO tw_days (date, model, synced_at) VALUES ('2026-10-15', 'Clicks & Views', '2026-10-16T10:40:00Z')"),
  ]);
  await attribute(env.DB);
});

const get = async (q: string) =>
  (await (await app.fetch(new Request(`https://hub.test/api/trends?${q}`, { headers: person }), env, {} as ExecutionContext)).json()) as TrendsResponse;

describe("trends", () => {
  it("buckets by day, with Triple Whale only on synced days", async () => {
    const r = await get("range=week");
    expect(r.grain).toBe("day");
    expect(r.points.map((p) => [p.start, p.totals.spendCents, p.tw])).toEqual([
      ["2026-10-11", 10000, null],
      ["2026-10-12", 10000, null],
      ["2026-10-15", 15000, { purchases: 4.5, revenueCents: 15000 }],
    ]);
  });

  it("buckets by Monday-start week and narrows to one pod", async () => {
    const r = await get("range=week&grain=week&pod=harris");
    expect(r.points.map((p) => [p.start, p.totals.spendCents, p.totals.purchases])).toEqual([
      ["2026-10-05", 10000, 5],
      ["2026-10-12", 20000, 10],
    ]);
  });
});
