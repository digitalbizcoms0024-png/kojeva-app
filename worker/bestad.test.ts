import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "./index.ts";
import type { Env } from "./env.ts";
import type { ConceptsResponse, PodsResponse } from "../shared/api.ts";
import { bestStatus } from "../shared/metrics.ts";
import { accessFixture, TEST_TEAM } from "./testing/access.ts";
import { testDb } from "./testing/db.ts";

let env: Env;
let person: Record<string, string>;

beforeAll(async () => {
  ({ headers: person } = await accessFixture("nosa@kojeva.com"));
});

// Harris "KOJEVA 3 | STATIC | Scarcity" (Sep 2026, Meta): the "Almost Sold Out" ad hit on its own
// first days (CPA ~$12.60 to the day it reached $100), but "Get It or Regret It" pulled the
// concept's days 1–3 to CPA ~$17, a miss on the combined numbers.
const DAYS: [string, [number, number, number], [number, number, number]][] = [
  // date, [sold-out spend $, purchases, revenue $], [regret spend $, purchases, revenue $]
  ["2026-09-18", [52.04, 4, 117.11], [54.77, 3, 111.87]],
  ["2026-09-19", [11.08, 0, 0], [79.24, 4, 114.29]],
  ["2026-09-20", [17.01, 4, 109.92], [94.36, 3, 79.83]],
  ["2026-09-21", [83.64, 5, 176.97], [19.64, 2, 112.0]],
  ["2026-09-22", [101.66, 3, 62.45], [0.15, 1, 35.0]],
];

beforeEach(async () => {
  env = { DB: await testDb(), META_APP_ID: "x", META_AD_ACCOUNT_ID: "act_1", META_GRAPH_VERSION: "v26.0", ACCESS_TEAM_DOMAIN: TEST_TEAM };
  const ad = (id: string, name: string) =>
    env.DB.prepare(
      "INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time, concept_id) VALUES (?1, ?1, ?2, 's3', 'IH | Harris | KOJEVA 3 | STATIC | Scarcity', 'PAUSED', '2026-09-17T00:00:00Z', 'k3')",
    ).bind(id, name);
  await env.DB.batch([
    // The combined numbers hit on ROAS under the default "either" rule; "both" isolates the best-ad case.
    env.DB.prepare("UPDATE settings SET value = json_set(value, '$.hitRule', 'both') WHERE key = 'targets'"),
    env.DB.prepare(
      "INSERT INTO concepts (id, adset_id, adset_name, label, pod_id) VALUES ('k3', 's3', 'IH | Harris | KOJEVA 3 | STATIC | Scarcity', 'KOJEVA 3', 'harris')",
    ),
    env.DB.prepare("INSERT INTO posts (id, media_type) VALUES ('sold', 'image'), ('regret', 'image')"),
    ad("sold", "ST _ Scarcity _ Almost Sold Out _ V1"),
    ad("regret", "ST _ Scarcity _ Get It or Regret It _ V1"),
    env.DB.prepare("INSERT INTO assignments (post_id, pod_id, pod_source) VALUES ('sold', 'harris', 'adset'), ('regret', 'harris', 'adset')"),
    ...DAYS.flatMap(([date, a, b]) =>
      (
        [
          ["sold", a],
          ["regret", b],
        ] as const
      ).map(([id, [spend, purchases, revenue]]) =>
        env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES (?1, ?2, ?3, ?4, ?5)").bind(
          id,
          date,
          Math.round(spend * 100),
          purchases,
          Math.round(revenue * 100),
        ),
      ),
    ),
  ]);
});

const get = async <T>(path: string) =>
  (await (await app.fetch(new Request(`https://hub.test${path}`, { headers: person }), env, {} as ExecutionContext)).json()) as T;

describe("best ad decides", () => {
  it("makes a concept a hit when one ad hits on its own numbers, and says which ad", async () => {
    const { rows } = await get<ConceptsResponse>("/api/concepts?range=all");
    const k = rows.find((r) => r.conceptId === "k3")!;
    // The concept's combined days 1–3 miss on CPA…
    expect(k.window.purchases).toBe(18);
    expect(k.window.spendCents / 100 / k.window.purchases).toBeGreaterThan(14);
    // …but "Almost Sold Out" hit from its first spend to the day it reached $100 (Sep 21).
    expect(k.status).toBe("hit");
    expect(k.decidedBy).toMatchObject({ adId: "sold", name: "ST _ Scarcity _ Almost Sold Out _ V1", from: "2026-09-18", to: "2026-09-21", status: "hit" });
    expect(k.decidedBy!.totals).toMatchObject({ spendCents: 16377, purchases: 13 });

    const harris = (await get<PodsResponse>("/api/pods?range=all")).rows.find((r) => r.podId === "harris")!;
    expect(harris).toMatchObject({ hits: 1, misses: 0 });
  });

  it("uses Kojeva's either rule once migrations have run", async () => {
    const fresh = await testDb();
    const meta = (await (
      await app.fetch(new Request("https://hub.test/api/meta", { headers: person }), { ...env, DB: fresh }, {} as ExecutionContext)
    ).json()) as { targets: { hitRule: string } };
    expect(meta.targets.hitRule).toBe("either");
  });

  it("ranks results hit > late hit > testing > miss > ineligible", () => {
    expect(bestStatus(["miss", "late_hit", "hit"])).toBe("hit");
    expect(bestStatus(["miss", "late_hit"])).toBe("late_hit");
    expect(bestStatus(["miss", "testing"])).toBe("testing");
    expect(bestStatus(["ineligible", "miss"])).toBe("miss");
    expect(bestStatus([])).toBe("ineligible");
  });
});
