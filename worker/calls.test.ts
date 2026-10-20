import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CallEvidence, ConceptDetail, PodsResponse } from "../shared/api.ts";
import app from "./index.ts";
import type { Env } from "./env.ts";
import { attribute } from "./meta/sync.ts";
import { accessFixture, TEST_TEAM } from "./testing/access.ts";
import { testDb } from "./testing/db.ts";

let env: Env;
let buyer: Record<string, string>;
let buyerOther: Record<string, string>;
let editor: Record<string, string>;

beforeAll(async () => {
  ({ headers: buyer } = await accessFixture("adrian@kojeva.com"));
  ({ headers: buyerOther } = await accessFixture("Owner@Gmail.com"));
  ({ headers: editor } = await accessFixture("harris@kojeva.com"));
});

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  env = {
    DB: await testDb(),
    META_APP_ID: "x",
    META_AD_ACCOUNT_ID: "act_1",
    META_GRAPH_VERSION: "v26.0",
    ACCESS_TEAM_DOMAIN: TEST_TEAM,
    MEDIA_BUYER_EMAILS: "adrian@kojeva.com, owner@gmail.com",
  };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO posts (id, media_type) VALUES ('p_neg', 'image'), ('p_scale', 'image')"),
    env.DB.prepare(
      `INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time) VALUES
       ('a_neg', 'p_neg', 'Negative Marketing #2', 's_neg', 'Shameer | Static 3 | Negative Marketing #2', 'ACTIVE', '2026-10-10T00:00:00.000Z'),
       ('a_scale', 'p_scale', 'Scaling ad', 's_scale', 'ME | Scaling | Winners', 'ACTIVE', '2026-09-01T00:00:00.000Z')`,
    ),
  ]);
  // Negative Marketing #2: 6 days at $300 for 10 purchases ($480 revenue): 1.6 ROAS, $30 CPA. A miss.
  // The rest of the account (one scaling ad) does better once it runs.
  const rows: string[] = [];
  for (let d = 3; d <= 9; d++) rows.push(`('a_scale', '${day(d)}', 100000, 40, 130000)`);
  for (let d = 10; d <= 15; d++) rows.push(`('a_neg', '${day(d)}', 30000, 10, 48000)`, `('a_scale', '${day(d)}', 100000, 50, 150000)`);
  await env.DB.prepare(`INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES ${rows.join(", ")}`).run();
  await attribute(env.DB);
});

const call = (h: Record<string, string>, path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`https://hub.test${path}`, { ...init, headers: { ...h, "Content-Type": "application/json" } }), env, {} as ExecutionContext);
const conceptId = async () =>
  (await env.DB.prepare("SELECT concept_id FROM ads WHERE id = 'a_neg'").first<{ concept_id: string }>())!.concept_id;
const detail = async (id: string) => (await (await call(buyer, `/api/concepts/${encodeURIComponent(id)}`)).json()) as ConceptDetail;
const put = (body: unknown) => ({ method: "PUT", body: JSON.stringify(body) });

describe("winner by call", () => {
  it("flags a miss close to target on major spend as a candidate, with the account's evidence", async () => {
    const id = await conceptId();
    const k = (await detail(id)).concept;
    expect([k.status, k.candidate, k.call]).toEqual(["miss", "winner", null]);

    const e = (await (await call(editor, `/api/concepts/${encodeURIComponent(id)}/evidence`)).json()) as CallEvidence;
    expect([e.before.from, e.before.to, e.since.from, e.since.to]).toEqual([day(3), day(9), day(10), day(15)]);
    expect(e.before.account.spendCents).toBe(700000);
    expect(e.since.concept).toMatchObject({ spendCents: 180000, purchases: 60 });
    // The rest of the account went from 1.3 to 1.5 ROAS while it ran.
    expect(e.since.rest.revenueCents / e.since.rest.spendCents).toBeCloseTo(1.5);
    expect(e.before.rest.revenueCents / e.before.rest.spendCents).toBeCloseTo(1.3);
    // The agency ad set is a test too: 1,800 of 7,800 test dollars since launch.
    expect(e.shareOfTestSpend).toBeCloseTo(180 / 780);
  });

  it("lets only the media buyer make the call, which then counts as a hit", async () => {
    const id = await conceptId();
    const path = `/api/concepts/${encodeURIComponent(id)}/call`;
    expect((await call(editor, path, put({ kind: "winner", reason: "Took most of test spend and lifted the account" }))).status).toBe(403);
    expect((await call(buyer, path, put({ kind: "winner", reason: "short" }))).status).toBe(400);
    expect((await call(buyerOther, path, put({ kind: "super_winner", reason: "Took most of test spend and lifted the account" }))).status).toBe(200);

    const k = (await detail(id)).concept;
    expect(k.status).toBe("super_winner");
    expect(k.candidate).toBeNull();
    expect(k.call).toMatchObject({ kind: "super_winner", calledBy: "Owner@Gmail.com" });
    expect(k.call!.evidence.since.concept.spendCents).toBe(180000);

    const pods = (await (await call(buyer, "/api/pods?range=all")).json()) as PodsResponse;
    expect(pods.rows.find((p) => p.podId === "shameer")).toMatchObject({ hits: 1, hitRate: 1 });

    expect((await call(editor, path, { method: "DELETE" })).status).toBe(403);
    expect((await call(buyer, path, { method: "DELETE" })).status).toBe(200);
    expect((await detail(id)).concept.status).toBe("miss");
  });

  it("keeps the winner thresholds to the media buyer", async () => {
    const body = { method: "PUT", body: JSON.stringify({ targets: { winnerMinRoas: 1.6 } }) };
    expect((await call(editor, "/api/settings", body)).status).toBe(403);
    expect((await call(editor, "/api/settings", { method: "PUT", body: JSON.stringify({ targets: { targetCpa: 15 } }) })).status).toBe(200);
    expect((await call(buyer, "/api/settings", body)).status).toBe(200);
    // 1.6 ROAS no longer reaches a 1.65 threshold.
    await call(buyer, "/api/settings", { method: "PUT", body: JSON.stringify({ targets: { winnerMinRoas: 1.65 } }) });
    expect((await detail(await conceptId())).concept.candidate).toBeNull();
  });
});
