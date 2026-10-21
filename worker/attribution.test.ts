import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "./index.ts";
import type { Env } from "./env.ts";
import type { AttributionResponse } from "../shared/api.ts";
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
      `INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents, purchases_7dc, revenue_7dc_cents, purchases_inc_milli, revenue_inc_cents) VALUES
       ('a1', '2026-10-14', 50000, 40, 120000, 34, 100000, 12500, 37000),
       ('a1', '2026-10-15', 50000, 40, 120000, NULL, NULL, NULL, NULL),
       ('a2', '2026-10-15', 20000, 10, 30000, 9, 27000, 2000, 6000)`,
    ),
  ]);
  await attribute(env.DB);
});

const get = async (q: string) =>
  (await (
    await app.fetch(new Request(`https://hub.test/api/attribution?${q}`, { headers: person }), env, {} as ExecutionContext)
  ).json()) as AttributionResponse;

describe("attribution comparison", () => {
  it("sums standard, 7-day click and incremental on the same spend, with coverage", async () => {
    const r = await get("range=all&level=pod");
    expect(r.total).toMatchObject({
      spendCents: 120000,
      standard: { purchases: 90, revenueCents: 270000 },
      click7: { purchases: 43, revenueCents: 127000 },
      incremental: { purchases: 14.5, revenueCents: 43000 },
      coveredSpendCents: 70000,
    });
    expect(r.rows.map((x) => [x.label, x.spendCents])).toEqual([
      ["Harris", 100000],
      ["Dhia", 20000],
    ]);
  });

  it("groups by post with names, and leaves windows null where Meta sent nothing", async () => {
    const r = await get("range=custom&from=2026-10-15&to=2026-10-15&level=post");
    const hxm = r.rows.find((x) => x.key === "p1")!;
    expect(hxm).toMatchObject({ label: "HxM-120", click7: null, incremental: null, coveredSpendCents: 0 });
    expect(r.rows.find((x) => x.key === "p2")!.incremental).toEqual({ purchases: 2, revenueCents: 6000 });
  });

  it("keeps a group that has a zero-spend ad-day", async () => {
    // Paused or capped ads leave zero-spend days; the group must still show by its total.
    await env.DB.prepare(
      "INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES ('a1', '2026-10-01', 0, 0, 0), ('a2', '2026-10-01', 0, 0, 0)",
    ).run();
    const r = await get("range=all&level=pod");
    expect(r.rows.map((x) => [x.label, x.spendCents])).toEqual([
      ["Harris", 100000],
      ["Dhia", 20000],
    ]);
  });

  it("reads month to date from the 1st of the latest synced day's month", async () => {
    await env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES ('a1', '2026-09-30', 99900, 1, 100)").run();
    const r = await get("range=mtd&level=pod");
    expect([r.from, r.to, r.total.spendCents]).toEqual(["2026-10-01", "2026-10-15", 120000]);
  });

  it("reads the last 14 days ending on the latest synced day", async () => {
    const r = await get("range=14d&level=pod");
    expect([r.from, r.to]).toEqual(["2026-10-02", "2026-10-15"]);
  });

  it("narrows the post level to one post", async () => {
    const r = await get("range=all&level=post&post=p2");
    expect(r.rows.map((x) => x.key)).toEqual(["p2"]);
    expect(r.total.spendCents).toBe(120000);
  });
});
