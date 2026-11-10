import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "./index.ts";
import type { Env } from "./env.ts";
import type { RankingsResponse } from "../shared/api.ts";
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
       ('a1', 'p1', 'HxM-120', 's1', 'IH | Harris | KOJEVA 1', 'ACTIVE', '2026-10-01T00:00:00.000Z'),
       ('a2', 'p2', 'Video 30', 's2', 'Dhia | Static 26', 'ACTIVE', '2026-10-01T00:00:00.000Z')`,
    ),
    env.DB.prepare(
      `INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES
       ('a1', '2026-10-14', 50000, 40, 120000),
       ('a1', '2026-10-15', 50000, 40, 120000),
       ('a2', '2026-10-15', 20000, 10, 30000)`,
    ),
  ]);
  await attribute(env.DB);
});

const get = async (q: string) =>
  (await (
    await app.fetch(new Request(`https://hub.test/api/rankings?${q}`, { headers: person }), env, {} as ExecutionContext)
  ).json()) as RankingsResponse;

// The shared date ranges resolve against the latest synced day (Rankings as the example).
describe("date ranges", () => {
  it("reads month to date from the 1st of the latest synced day's month", async () => {
    await env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES ('a1', '2026-09-30', 99900, 1, 100)").run();
    const r = await get("range=mtd");
    expect([r.from, r.to, r.totals.spendCents]).toEqual(["2026-10-01", "2026-10-15", 120000]);
  });

  it("reads the last 14 days ending on the latest synced day", async () => {
    const r = await get("range=14d");
    expect([r.from, r.to]).toEqual(["2026-10-02", "2026-10-15"]);
  });
});
