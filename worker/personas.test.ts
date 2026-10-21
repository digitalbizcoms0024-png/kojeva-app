import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "./index.ts";
import type { Env } from "./env.ts";
import type { AlertsResponse, CoverageResponse, MetaResponse, Persona } from "../shared/api.ts";
import { attribute } from "./meta/sync.ts";
import { accessFixture, TEST_TEAM } from "./testing/access.ts";
import { testDb } from "./testing/db.ts";

const CLIENT_ID = "abc123.access";
let env: Env;
let service: Record<string, string>;
let person: Record<string, string>;

beforeAll(async () => {
  ({ headers: service } = await accessFixture(undefined, CLIENT_ID));
  ({ headers: person } = await accessFixture("nosa@kojeva.com"));
});

const V1 = "v:101";
const V2 = "v:102";
const I3 = "i:abc103";

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
    env.DB.prepare("INSERT INTO posts (id, media_type) VALUES ('p1', 'video'), ('p2', 'video'), ('p3', 'image')"),
    env.DB.prepare(
      `INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time, asset_id) VALUES
       ('a1', 'p1', 'HxM-1', 's1', 'IH | Harris | KOJEVA 15 | FAKE BRUSH', 'ACTIVE', '2026-10-01T00:00:00.000Z', '${V1}'),
       ('a2', 'p2', 'HxM-2', 's2', 'IH | Harris | KOJEVA 16 | MORNING', 'ACTIVE', '2026-10-01T00:00:00.000Z', '${V2}'),
       ('a3', 'p3', 'Static 3', 's3', 'Dhia | Static 26 | Sale', 'ACTIVE', '2026-10-01T00:00:00.000Z', '${I3}')`,
    ),
    env.DB.prepare(
      `INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES
       ('a1', '2026-10-10', 70000, 50, 120000), ('a2', '2026-10-10', 10000, 5, 9000), ('a3', '2026-10-10', 20000, 10, 30000)`,
    ),
  ]);
  await attribute(env.DB);
  // Atria persona tags, as Atria returns them.
  await call(
    "/api/ingest/atria",
    service,
    post({
      assets: [
        { assetId: V1, status: "tagged", tags: { persona: ["Busy mom", "Existing customer"] } },
        { assetId: V2, status: "tagged", tags: { persona: ["Skincare skeptic"] } },
        { assetId: I3, status: "tagged", tags: { persona: ["Existing customer"], offer_type: ["Percentage Off"] } },
      ],
    }),
  );
});

const call = (path: string, headers: Record<string, string>, init: RequestInit = {}) =>
  app.fetch(new Request(`https://hub.test${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }), env, {} as ExecutionContext);
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const personas = async () => (await json<MetaResponse>(call("/api/meta", person))).personas;
const label = (assetId: string, extra: object) => ({ assetId, awareness: "product", belief: "It works", beliefGroup: "It works", motivations: [], format: null, ...extra });

/** Drafts two personas through the service route, then confirms them as a person. */
async function confirmTwo() {
  await call(
    "/api/ingest/atria/personas",
    service,
    post({
      personas: [
        { name: "Loyal Lisa", description: "Bought before" },
        { name: "Skeptical Sam", description: "Tried everything" },
      ],
    }),
  );
  expect((await call("/api/personas/confirm", person, { method: "POST" })).status).toBe(200);
  const list = await personas();
  return { lisa: list.find((p) => p.name === "Loyal Lisa")!.id, sam: list.find((p) => p.name === "Skeptical Sam")!.id };
}

describe("personas", () => {
  it("lets Claude replace an unconfirmed draft list, but not a confirmed one", async () => {
    const drafts = (names: string[], replaceDrafts?: boolean) =>
      call("/api/ingest/atria/personas", service, post({ personas: names.map((name) => ({ name, description: `${name}, from the research` })), replaceDrafts }));
    await drafts(["Deal-hunting Dana", "Morning-puffy Maya", "Skeptical Sophie"]);
    expect(await json(drafts(["The Morning De-Puffer", "The Frustrated Facial-Tool User"], true))).toMatchObject({ added: 2, as: "draft" });
    expect((await personas()).map((p) => [p.name, p.status])).toEqual([
      ["The Morning De-Puffer", "draft"],
      ["The Frustrated Facial-Tool User", "draft"],
    ]);
    expect((await call("/api/personas/confirm", person, { method: "POST" })).status).toBe(200);
    expect((await drafts(["Someone else"], true)).status).toBe(409);
    expect((await personas()).map((p) => p.name)).toEqual(["The Morning De-Puffer", "The Frustrated Facial-Tool User"]);
  });

  it("gives Claude Atria's persona tags to draft from, keeps the first list as drafts and later ones as suggestions", async () => {
    const input = await json<{ state: string; atriaPersonas: { tag: string; assets: number; spendCents: number }[] }>(
      call("/api/ingest/atria/personas", service),
    );
    expect(input.state).toBe("empty");
    expect(input.atriaPersonas.slice(0, 2)).toEqual([
      { tag: "Existing customer", assets: 2, spendCents: 90000 },
      { tag: "Busy mom", assets: 1, spendCents: 70000 },
    ]);

    expect(await json(call("/api/ingest/atria/personas", service, post({ personas: [{ name: "Loyal Lisa", description: "Bought before" }] })))).toMatchObject({
      added: 1,
      as: "draft",
    });
    expect((await personas()).map((p) => [p.name, p.status])).toEqual([["Loyal Lisa", "draft"]]);
    // Claude can't add to the draft list once it exists, only suggest; duplicates are skipped.
    const r = await json(
      call("/api/ingest/atria/personas", service, post({ personas: [{ name: "loyal lisa" }, { name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }] })),
    );
    expect(r).toMatchObject({ added: 3, as: "suggested" });
    expect((await personas()).filter((p) => p.status === "suggested")).toHaveLength(3);
    expect((await call("/api/ingest/atria/personas", person)).status).toBe(403);
    expect((await call("/api/personas/confirm", service, { method: "POST" })).status).toBe(403);
  });

  it("only takes persona labels after the list is confirmed, then asks for them once and writes nothing on a re-send", async () => {
    await call("/api/ingest/atria/personas", service, post({ personas: [{ name: "Loyal Lisa" }] }));
    const lisaDraft = (await personas())[0]!.id;
    expect((await call("/api/ingest/atria/labels", service, post({ labels: [label(V1, { personaId: lisaDraft })] }))).status).toBe(400);
    expect(await json(call("/api/ingest/atria/labels", service, post({ labels: [label(V1, { offer: false })] })))).toMatchObject({ written: 1 });
    expect((await json<{ assets: unknown[] }>(call("/api/ingest/atria/unlabeled", service))).assets).toHaveLength(2);

    await call("/api/personas/confirm", person, { method: "POST" });
    const un = await json<{ personasConfirmed: boolean; personas: { id: string }[]; assets: { assetId: string }[] }>(
      call("/api/ingest/atria/unlabeled", service),
    );
    expect(un.personasConfirmed).toBe(true);
    expect(un.personas.map((p) => p.id)).toEqual([lisaDraft]);
    expect(un.assets.map((a) => a.assetId).sort()).toEqual([V1, V2, I3].sort());

    const labels = {
      labels: [
        label(V1, { offer: false, personaId: lisaDraft }),
        label(V2, { offer: false, personaId: null }),
        label(I3, { offer: true, personaId: lisaDraft }),
      ],
    };
    expect(await json(call("/api/ingest/atria/labels", service, post(labels)))).toMatchObject({ written: 3 });
    expect(await json(call("/api/ingest/atria/labels", service, post(labels)))).toMatchObject({ written: 0 });
    expect((await json<{ assets: unknown[] }>(call("/api/ingest/atria/unlabeled", service))).assets).toEqual([]);
    expect((await call("/api/ingest/atria/labels", service, post({ labels: [label(V1, { personaId: "pe_nope" })] }))).status).toBe(400);
  });

  it("re-asks about unplaced ads when a persona is added, merges personas, and dismisses suggestions for good", async () => {
    const { lisa, sam } = await confirmTwo();
    await call(
      "/api/ingest/atria/labels",
      service,
      post({
        labels: [label(V1, { offer: false, personaId: lisa }), label(V2, { offer: false, personaId: null }), label(I3, { offer: true, personaId: sam })],
      }),
    );

    expect((await call("/api/personas", person, post({ name: "Gift Giver", description: "Buys for others" }))).status).toBe(201);
    expect((await json<{ assets: { assetId: string }[] }>(call("/api/ingest/atria/unlabeled", service))).assets.map((a) => a.assetId)).toEqual([V2]);

    expect((await call(`/api/personas/${sam}?into=${lisa}`, person, { method: "DELETE" })).status).toBe(200);
    const map = await json<CoverageResponse>(call("/api/coverage?range=all", person));
    expect(
      map.posts
        .filter((p) => p.personaId === lisa)
        .map((p) => p.postId)
        .sort(),
    ).toEqual(["p1", "p3"]);

    await call("/api/ingest/atria/personas", service, post({ personas: [{ name: "Night owl" }] }));
    const idea = (await personas()).find((p) => p.name === "Night owl") as Persona;
    expect(idea.status).toBe("suggested");
    await call(`/api/personas/${idea.id}`, person, { method: "DELETE" });
    expect((await personas()).some((p) => p.name === "Night owl")).toBe(false);
    expect(await json(call("/api/ingest/atria/personas", service, post({ personas: [{ name: "Night owl" }] })))).toMatchObject({ added: 0 });
  });

  it("approves a suggestion and validates names", async () => {
    await confirmTwo();
    await call("/api/ingest/atria/personas", service, post({ personas: [{ name: "Night owl", description: "Shops at 2am" }] }));
    const idea = (await personas()).find((p) => p.name === "Night owl")!;
    const patch = (id: string, body: object) => call(`/api/personas/${id}`, person, { method: "PATCH", body: JSON.stringify(body) });
    expect((await patch(idea.id, { status: "active", name: "Night Owl Nina" })).status).toBe(200);
    expect((await personas()).find((p) => p.id === idea.id)).toMatchObject({ status: "active", name: "Night Owl Nina" });
    expect((await patch(idea.id, { name: "Loyal Lisa" })).status).toBe(400);
    expect((await patch(idea.id, { name: "" })).status).toBe(400);
    expect((await call("/api/personas", person, post({ name: "x".repeat(61) }))).status).toBe(400);
  });
});

describe("coverage map", () => {
  it("places running ads by persona × awareness with spend share, offer share and the hand-set values winning", async () => {
    const { lisa, sam } = await confirmTwo();
    await call(
      "/api/ingest/atria/labels",
      service,
      post({
        labels: [label(V1, { offer: true, personaId: lisa }), label(V2, { offer: false, personaId: sam, awareness: "unaware" }), label(I3, { offer: true })],
      }),
    );
    let map = await json<CoverageResponse>(call("/api/coverage?range=all", person));
    expect(map.defined).toBe(10);
    expect(map.filled).toBe(2);
    expect(map.unplaced).toBe(1); // p3 has no persona
    expect(map.unplacedWhy).toEqual({ waiting: 0, none: 1 }); // labelled, fits no persona
    expect(map.posts.find((p) => p.postId === "p3")?.why).toBe("none");
    expect(map.top).toEqual({ personaId: lisa, awareness: "product", share: 0.7, offerShare: 1 });
    const cell = map.cells.find((c) => c.personaId === sam && c.awareness === "unaware")!;
    expect(cell).toMatchObject({ ads: 1, offerSpendCents: 0, offerKnownSpendCents: 10000, concepts: 1 });

    // A person places p3 by hand: Sam, most aware, no offer.
    const patch = await call("/api/posts/p3/assignment", person, {
      method: "PATCH",
      body: JSON.stringify({ personaId: sam, awareness: "most", offer: false }),
    });
    expect(patch.status).toBe(200);
    map = await json<CoverageResponse>(call("/api/coverage?range=all", person));
    expect(map.unplaced).toBe(0);
    expect(map.posts.find((p) => p.postId === "p3")).toMatchObject({ personaId: sam, awareness: "most", offer: false });
    expect((await call("/api/posts/p3/assignment", person, { method: "PATCH", body: JSON.stringify({ personaId: "pe_nope" }) })).status).toBe(400);

    // Pod filter and the concept track record follow the same placement.
    const harris = await json<CoverageResponse>(call("/api/coverage?range=all&pod=harris", person));
    expect(harris.posts.map((p) => p.postId).sort()).toEqual(["p1", "p2"]);
    const insights = await json<{ rows: { value: string | null; concepts: number }[] }>(call("/api/insights?range=all&dimension=persona", person));
    expect(Object.fromEntries(insights.rows.map((r) => [r.value ?? "none", r.concepts]))).toEqual({ [lisa]: 1, [sam]: 2 });
  });

  it("raises a dashboard alert when most of the week's spend sits in one cell", async () => {
    const { lisa } = await confirmTwo();
    await call("/api/ingest/atria/labels", service, post({ labels: [label(V1, { offer: true, personaId: lisa })] }));
    const alerts = await json<AlertsResponse>(call("/api/alerts", person));
    expect(alerts.alerts.find((a) => a.id === "concentration")).toMatchObject({
      title: "70% of spend sits in one cell: Loyal Lisa × Product aware",
      href: "#/coverage",
    });
  });

  it("shows an empty grid until personas are confirmed", async () => {
    const map = await json<CoverageResponse>(call("/api/coverage?range=all", person));
    expect(map).toMatchObject({ personas: [], defined: 0, filled: 0, unplaced: 3, top: null });
    expect(map.unplacedWhy.none).toBe(0);
    expect((await json<AlertsResponse>(call("/api/alerts", person))).alerts.some((a) => a.id === "concentration")).toBe(false);
  });
});
