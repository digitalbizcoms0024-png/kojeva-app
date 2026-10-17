import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "./index.ts";
import type { Env } from "./env.ts";
import { attribute } from "./meta/sync.ts";
import { accessFixture, TEST_TEAM } from "./testing/access.ts";
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
      "INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time) VALUES ('111', 'p1', 'HxM-1', 's1', 'IH | Harris | KOJEVA 1', 'ACTIVE', '2026-10-01T00:00:00Z')",
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

  it("doesn't count an unchanged ingest push as a change", async () => {
    const body = JSON.stringify({ model: "Clicks & Views", days: [{ date: "2026-10-10", ads: [{ adId: "111", orders: 2, revenue: 40 }] }] });
    await call("/api/ingest/tw", service, { method: "POST", body });
    const v = await version();
    await call("/api/ingest/tw", service, { method: "POST", body });
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
