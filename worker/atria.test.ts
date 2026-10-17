import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "./index.ts";
import type { Env } from "./env.ts";
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

// Real Atria tags for two Kojeva creatives (Oct 2026).
const VIDEO_TAGS = {
  theme: ["Problem & Solution", "Product Demo", "Comparison"],
  core_desire: ["Health", "Aesthetics", "Security"],
  media_format: ["UGC Video"],
  visual_hook: ["Transformation Start", "Product Drop", "Direct Eye Contact"],
};
const IMAGE_TAGS = {
  theme: ["Scarcity", "Promotion/Discount", "Social proof"],
  core_desire: ["Belonging", "Security", "Saving"],
  offer_type: ["Percentage Off", "Limited Time", "Flash Sale"],
};

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
    env.DB.prepare("INSERT INTO posts (id, media_type) VALUES ('p1', 'video'), ('p2', 'image'), ('p3', 'video')"),
    env.DB.prepare(
      `INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time, asset_id) VALUES
       ('a1', 'p1', 'v1', 's1', 'IH | Harris | KOJEVA 15 | FAKE BRUSH', 'ACTIVE', '2026-10-01T00:00:00.000Z', 'v:1053927990294150'),
       ('a2', 'p2', 'i1', 's2', 'IH | Harris | KOJEVA 3 | STATIC | Scarcity', 'ACTIVE', '2026-10-01T00:00:00.000Z', 'i:b1679ce60dbda9e125c26e84d9f82e94'),
       ('a3', 'p3', 'v2', 's3', 'Dhia | Static 26 | More Women', 'ACTIVE', '2026-10-01T00:00:00.000Z', 'v:999')`,
    ),
    env.DB.prepare(
      `INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES
       ('a1', '2026-10-01', 30000, 25, 60000), ('a2', '2026-10-01', 20000, 10, 20000), ('a3', '2026-10-01', 10000, 5, 9000),
       ('a3', '2026-10-09', 100, 0, 0)`,
    ),
  ]);
  await attribute(env.DB);
});

const call = (path: string, headers: Record<string, string>, init: RequestInit = {}) =>
  app.fetch(new Request(`https://hub.test${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }), env, {} as ExecutionContext);
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

describe("Atria ingest", () => {
  it("lists assets needing tags, highest spend first", async () => {
    const res = await call("/api/ingest/atria/pending", service);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { assets: unknown[] }).assets).toEqual([
      { assetId: "v:1053927990294150", videoId: "1053927990294150", imageHash: null, spendCents: 30000 },
      { assetId: "i:b1679ce60dbda9e125c26e84d9f82e94", videoId: null, imageHash: "b1679ce60dbda9e125c26e84d9f82e94", spendCents: 20000 },
      { assetId: "v:999", videoId: "999", imageHash: null, spendCents: 10100 },
    ]);
  });

  it("only lets the service token in, and keeps the service token out of edits", async () => {
    expect((await call("/api/ingest/atria/pending", person)).status).toBe(403);
    expect((await call("/api/ingest/atria/pending", {})).status).toBe(401);
    expect((await call("/api/ingest/atria/pending", service)).status).toBe(200);
    const edit = await call(
      "/api/posts/p1/assignment",
      { ...service, "Content-Type": "application/json" },
      { method: "PATCH", body: JSON.stringify({ podId: "ali" }) },
    );
    expect(edit.status).toBe(403);
    expect((await call("/api/ingest/atria/pending", service)).status).toBe(200);
    expect(
      (await app.fetch(new Request("https://hub.test/api/ingest/atria/pending", { headers: service }), { ...env, ATRIA_CLIENT_ID: "" }, {} as ExecutionContext))
        .status,
    ).toBe(403);
  });

  it("stores tags, stops asking for them, and shows them on posts, concepts and insights", async () => {
    const res = await call(
      "/api/ingest/atria",
      service,
      post({
        assets: [
          { assetId: "v:1053927990294150", status: "tagged", tags: VIDEO_TAGS },
          { assetId: "i:b1679ce60dbda9e125c26e84d9f82e94", status: "tagged", tags: IMAGE_TAGS },
          { assetId: "v:999", status: "not_tagged_yet" },
        ],
      }),
    );
    expect(await res.json()).toEqual({ ok: true, received: 3, tagged: 2 });

    // Tagged and recently-checked assets aren't requested again.
    const pending = (await (await call("/api/ingest/atria/pending", service)).json()) as { assets: unknown[] };
    expect(pending.assets).toEqual([]);

    const rankings = (await (await call("/api/rankings?range=all", person)).json()) as { items: { postId: string; atria: Record<string, string[]> | null }[] };
    expect(rankings.items.find((p) => p.postId === "p1")!.atria).toMatchObject({ theme: VIDEO_TAGS.theme, media_format: ["UGC Video"] });
    expect(rankings.items.find((p) => p.postId === "p3")!.atria).toBeNull();

    const insights = (await (await call("/api/insights?range=all&dimension=atria_theme", person)).json()) as {
      rows: { value: string | null; concepts: number }[];
    };
    const byTheme = Object.fromEntries(insights.rows.map((r) => [r.value ?? "none", r.concepts]));
    expect(byTheme).toMatchObject({ Comparison: 1, Scarcity: 1, "Product Demo": 1, none: 1 });

    const drill = (await (await call("/api/concepts?range=all&atria_desire=Security", person)).json()) as { rows: unknown[] };
    expect(drill.rows).toHaveLength(2);
  });

  it("rejects malformed tags", async () => {
    for (const assets of [
      [{ assetId: "x:1", status: "tagged", tags: {} }],
      [{ assetId: "v:1", status: "tagged", tags: { theme: "Scarcity" } }],
      [{ assetId: "v:1", status: "maybe" }],
      [],
    ])
      expect((await call("/api/ingest/atria", service, post({ assets }))).status).toBe(400);
  });

  describe("awareness and belief labels", () => {
    const VIDEO = "v:1053927990294150";
    const IMAGE = "i:b1679ce60dbda9e125c26e84d9f82e94";
    const tagBoth = () =>
      call(
        "/api/ingest/atria",
        service,
        post({
          assets: [
            { assetId: VIDEO, status: "tagged", tags: VIDEO_TAGS },
            { assetId: IMAGE, status: "tagged", tags: IMAGE_TAGS },
          ],
        }),
      );
    const LABELS = {
      labels: [
        {
          assetId: VIDEO,
          awareness: "problem",
          belief: "Puffiness isn't fat, it's fluid that can drain",
          beliefGroup: "Puffiness is fluid, not fat",
          offer: false,
        },
        { assetId: IMAGE, awareness: "most", belief: "This deal won't come back", beliefGroup: "Now is the time to buy", offer: true },
      ],
    };

    it("lists tagged assets that need labels, with their tags and the groups already in use", async () => {
      await tagBoth();
      const res = (await (await call("/api/ingest/atria/unlabeled", service)).json()) as {
        awarenessLevels: string[];
        beliefGroups: unknown[];
        assets: { assetId: string; tags: Record<string, string[]> }[];
      };
      expect(res.awarenessLevels).toEqual(["unaware", "problem", "solution", "product", "most"]);
      expect(res.beliefGroups).toEqual([]);
      expect(res.assets.map((a) => a.assetId).sort()).toEqual([IMAGE, VIDEO].sort());
      expect(res.assets.find((a) => a.assetId === VIDEO)!.tags.visual_hook).toEqual(VIDEO_TAGS.visual_hook);
      expect((await call("/api/ingest/atria/unlabeled", person)).status).toBe(403);
    });

    it("stores labels, writes nothing on an unchanged re-send, and groups Insights by them", async () => {
      await tagBoth();
      expect(await (await call("/api/ingest/atria/labels", service, post(LABELS))).json()).toEqual({ ok: true, received: 2, written: 2, unknown: 0 });
      expect(await (await call("/api/ingest/atria/labels", service, post(LABELS))).json()).toMatchObject({ written: 0 });
      const left = (await (await call("/api/ingest/atria/unlabeled", service)).json()) as { assets: unknown[]; beliefGroups: { name: string }[] };
      expect(left.assets).toEqual([]);
      expect(left.beliefGroups.map((g) => g.name).sort()).toEqual(["Now is the time to buy", "Puffiness is fluid, not fat"]);

      const rows = async (dimension: string) =>
        Object.fromEntries(
          (
            (await (await call(`/api/insights?range=all&dimension=${dimension}`, person)).json()) as { rows: { value: string | null; concepts: number }[] }
          ).rows.map((r) => [r.value ?? "none", r.concepts]),
        );
      expect(await rows("awareness")).toMatchObject({ problem: 1, most: 1, none: 1 });
      expect(await rows("belief")).toMatchObject({ "Puffiness is fluid, not fat": 1, "Now is the time to buy": 1, none: 1 });
      expect(await rows("atria_hook")).toMatchObject({ "Transformation Start": 1, none: 2 });
      const drill = (await (await call("/api/concepts?range=all&awareness=problem", person)).json()) as { rows: { beliefs: string[] }[] };
      expect(drill.rows).toHaveLength(1);
      expect(drill.rows[0]!.beliefs).toEqual(["Puffiness isn't fat, it's fluid that can drain"]);
    });

    it("lets a hand-set awareness and belief group win over Claude's", async () => {
      await tagBoth();
      await call("/api/ingest/atria/labels", service, post(LABELS));
      const res = await call("/api/posts/p1/assignment", person, {
        method: "PATCH",
        body: JSON.stringify({ awareness: "solution", beliefGroup: "Real gua sha beats fakes" }),
      });
      expect(res.status).toBe(200);
      const concepts = (await (await call("/api/concepts?range=all&awareness=solution", person)).json()) as {
        rows: { awareness: string; awarenessSource: string; beliefGroups: string[] }[];
      };
      expect(concepts.rows).toEqual([
        expect.objectContaining({ awareness: "solution", awarenessSource: "manual", beliefGroups: ["Real gua sha beats fakes"] }),
      ]);
      expect((await call("/api/posts/p1/assignment", person, { method: "PATCH", body: JSON.stringify({ awareness: "very" }) })).status).toBe(400);
    });

    it("rejects malformed labels", async () => {
      await tagBoth();
      for (const labels of [
        [{ assetId: VIDEO, awareness: "kinda", belief: "x", beliefGroup: "y" }],
        [{ assetId: VIDEO, awareness: "most", belief: "", beliefGroup: "y" }],
        [{ assetId: "x:1", awareness: "most", belief: "x", beliefGroup: "y" }],
        [],
      ])
        expect((await call("/api/ingest/atria/labels", service, post({ labels }))).status).toBe(400);
    });
  });
});
