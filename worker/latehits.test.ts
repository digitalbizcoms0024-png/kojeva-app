import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "./index.ts";
import type { Env } from "./env.ts";
import type { ConceptsResponse, LaunchesResponse, PodsResponse } from "../shared/api.ts";
import { accessFixture, TEST_TEAM } from "./testing/access.ts";
import { testDb } from "./testing/db.ts";

let env: Env;
let person: Record<string, string>;

beforeAll(async () => {
  ({ headers: person } = await accessFixture("nosa@kojeva.com"));
});

/** One concept with one ad, spending $100 a day from Oct 1; `purchases(i)` per day i (0-based). */
async function concept(id: string, pod: string, days: number, purchases: (i: number) => number) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO concepts (id, adset_id, adset_name, label, pod_id) VALUES (?1, ?1, ?2, ?3, ?4)").bind(id, `IH | ${pod} | ${id}`, id, pod),
    env.DB.prepare("INSERT INTO posts (id, media_type) VALUES (?1, 'video')").bind(`p_${id}`),
    env.DB.prepare(
      "INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time, concept_id) VALUES (?1, ?2, ?1, ?3, ?4, 'ACTIVE', '2026-10-01T00:00:00Z', ?3)",
    ).bind(`a_${id}`, `p_${id}`, id, `IH | ${pod} | ${id}`),
    env.DB.prepare("INSERT INTO assignments (post_id, pod_id, pod_source) VALUES (?1, ?2, 'adset')").bind(`p_${id}`, pod),
    ...Array.from({ length: days }, (_, i) =>
      env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES (?1, ?2, 10000, ?3, ?4)").bind(
        `a_${id}`,
        `2026-10-${String(i + 1).padStart(2, "0")}`,
        purchases(i),
        purchases(i) * 2500,
      ),
    ),
  ]);
}

beforeEach(async () => {
  env = { DB: await testDb(), META_APP_ID: "x", META_AD_ACCOUNT_ID: "act_1", META_GRAPH_VERSION: "v26.0", ACCESS_TEAM_DOMAIN: TEST_TEAM };
  await concept("k_fast", "harris", 3, () => 10); // hit at day 3
  await concept("k_late", "harris", 12, (i) => (i < 3 ? 4 : 10)); // $25 CPA for 3 days, then $10
  await concept("k_flop", "harris", 12, () => 4); // keeps spending at $25 CPA
  await concept("k_stop", "dhia", 3, () => 4); // missed and stopped
});

const get = async <T,>(path: string) =>
  (await (await app.fetch(new Request(`https://hub.test${path}`, { headers: person }), env, {} as ExecutionContext)).json()) as T;

describe("late hits", () => {
  it("turns a day-3 miss that kept spending into a late hit, and labels running misses", async () => {
    const { rows } = await get<ConceptsResponse>("/api/concepts?range=all");
    const by = Object.fromEntries(rows.map((k) => [k.conceptId, k]));
    expect(by.k_fast!.status).toBe("hit");
    expect(by.k_late!.status).toBe("late_hit");
    expect(by.k_late!.lateWindow).toMatchObject({ from: "2026-10-01", to: "2026-10-07" });
    expect(by.k_flop).toMatchObject({ status: "miss", stillRunning: true, lateWindow: null });
    expect(by.k_stop).toMatchObject({ status: "miss", stillRunning: false });
  });

  it("counts late hits in the pod's hit rate and reports them separately", async () => {
    const { rows } = await get<PodsResponse>("/api/pods?range=all");
    const harris = rows.find((r) => r.podId === "harris")!;
    expect(harris).toMatchObject({ hits: 2, lateHits: 1, misses: 1 });
    expect(harris.hitRate).toBeCloseTo(2 / 3);
  });

  it("counts concepts testing now: every concept with an ad switched on", async () => {
    // A slow test: $5 a day since Oct 1, no ad at $100 by the latest day (Oct 12), still spending.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO concepts (id, adset_id, adset_name, label, pod_id) VALUES ('k_slow', 'k_slow', 'IH | shameer | slow', 'slow', 'shameer')"),
      env.DB.prepare("INSERT INTO posts (id, media_type) VALUES ('p_slow', 'image')"),
      env.DB.prepare(
        "INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time, concept_id) VALUES ('a_slow', 'p_slow', 'slow', 'k_slow', 'IH | shameer | slow', 'ACTIVE', '2026-10-01T00:00:00Z', 'k_slow')",
      ),
      env.DB.prepare("INSERT INTO assignments (post_id, pod_id, pod_source) VALUES ('p_slow', 'shameer', 'adset')"),
      ...Array.from({ length: 12 }, (_, i) =>
        env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents) VALUES ('a_slow', ?1, 500)").bind(`2026-10-${String(i + 1).padStart(2, "0")}`),
      ),
    ]);
    // Dhia's concept is switched off in Meta.
    await env.DB.prepare("UPDATE ads SET status = 'ADSET_PAUSED' WHERE id = 'a_k_stop'").run();
    const { rows } = await get<PodsResponse>("/api/pods?range=all");
    const by = Object.fromEntries(rows.map((r) => [r.podId, r]));
    expect(by.shameer).toMatchObject({ live: 1, testing: 0 });
    // Testing now = switched on, whatever the result: Harris's hit, late hit and miss all still have an ad on.
    expect(by.harris!.live).toBe(3);
    expect(by.dhia!.live).toBe(0);
  });
});

describe("turned off", () => {
  /** A concept with the given ads: [status, [spend $, purchases] per day from `start`]. */
  async function conceptWith(id: string, start: number, ads: [string, [number, number][]][]) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO concepts (id, adset_id, adset_name, label, pod_id) VALUES (?1, ?1, ?2, ?1, 'shameer')").bind(id, `Shameer | ${id}`),
      env.DB.prepare("INSERT INTO posts (id, media_type) VALUES (?1, 'image')").bind(`p_${id}`),
      env.DB.prepare("INSERT INTO assignments (post_id, pod_id, pod_source) VALUES (?1, 'shameer', 'adset')").bind(`p_${id}`),
      ...ads.flatMap(([status, days], n) => [
        env.DB.prepare(
          "INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time, concept_id) VALUES (?1, ?2, ?1, ?3, ?4, ?5, '2026-10-01T00:00:00Z', ?3)",
        ).bind(`a_${id}_${n}`, `p_${id}`, id, `Shameer | ${id}`, status),
        ...days.map(([spend, purchases], i) =>
          env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES (?1, ?2, ?3, ?4, ?5)").bind(
            `a_${id}_${n}`,
            `2026-10-${String(start + i).padStart(2, "0")}`,
            spend * 100,
            purchases,
            purchases * 2500,
          ),
        ),
      ]),
    ]);
  }

  it("judges a concept at once when every ad is off: before day 3, or with no ad at $100", async () => {
    // Launched Oct 11 (latest synced day Oct 12), ad set paused at $110: $11 CPA, a hit on day 2.
    await conceptWith("k_off_early", 11, [["ADSET_PAUSED", [[60, 5], [50, 5]]]]);
    // Two ads at $45 each (none at $100), both paused after a day: $90 for one sale, a miss.
    await conceptWith("k_off_small", 1, [["PAUSED", [[45, 1]]], ["CAMPAIGN_PAUSED", [[45, 0]]]]);
    // One ad paused, one still on: still testing, as before.
    await conceptWith("k_half_on", 11, [["PAUSED", [[30, 1]]], ["ACTIVE", [[30, 1]]]]);
    const { rows } = await get<ConceptsResponse>("/api/concepts?range=all");
    const by = Object.fromEntries(rows.map((k) => [k.conceptId, k]));
    expect(by.k_off_early).toMatchObject({ status: "hit", turnedOff: true, windowEnd: "2026-10-12" });
    expect(by.k_off_early!.window.spendCents).toBe(11000);
    expect(by.k_off_small).toMatchObject({ status: "miss", turnedOff: true, qualifiedOn: null });
    expect(by.k_half_on).toMatchObject({ status: "testing", turnedOff: false });
    // Results decided the usual way stay as they were.
    expect(by.k_fast).toMatchObject({ status: "hit", turnedOff: false });
    const pods = await get<PodsResponse>("/api/pods?range=all");
    expect(pods.rows.find((r) => r.podId === "shameer")).toMatchObject({ hits: 1, misses: 1, live: 1 });
  });
});

describe("launches per week", () => {
  it("counts concepts by the Monday–Sunday week of their first spend", async () => {
    // All four started Thu Oct 1 (week of Mon Sep 28); latest synced day is Mon Oct 12.
    const r = await get<LaunchesResponse>("/api/launches?weeks=3");
    expect(r.weeks).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"]);
    expect(r.rows.map((x) => [x.podId, x.counts])).toEqual([
      ["harris", [3, 0, 0]],
      ["dhia", [1, 0, 0]],
      ["shameer", [0, 0, 0]],
      ["ali", [0, 0, 0]],
      ["trybe", [0, 0, 0]],
      ["agency", [0, 0, 0]],
    ]);
  });
});
