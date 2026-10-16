import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "./index.ts";
import type { Env } from "./env.ts";
import { attribute } from "./meta/sync.ts";
import { accessFixture, TEST_TEAM } from "./testing/access.ts";
import { testDb } from "./testing/db.ts";

let env: Env;
let headers: Record<string, string>;

beforeAll(async () => {
  ({ headers } = await accessFixture());
});
afterEach(() => vi.clearAllMocks());

beforeEach(async () => {
  env = {
    DB: await testDb(),
    META_APP_ID: "x",
    META_AD_ACCOUNT_ID: "act_1",
    META_GRAPH_VERSION: "v26.0",
    ACCESS_TEAM_DOMAIN: TEST_TEAM,
  };
  const posts: [string, string, string, string][] = [
    // post, ad, ad name, ad set
    ["p_harris", "a1", "HxM-1-ANIMSONG", "IH | Harris | KOJEVA 1 | ANIMSONG-HxM1"],
    ["p_agency", "a2", "V457 | CBO", "ME | R2-S12 | Statics"],
    ["p_unknown1", "a3", "Video 612", "Top Spenders From ABO"],
    ["p_unknown2", "a4", "Video 613", "Top Spenders From ABO"],
  ];
  await env.DB.batch(
    posts.flatMap(([post, ad, name, adset]) => [
      env.DB.prepare("INSERT INTO posts (id, media_type) VALUES (?1, 'video')").bind(post),
      env.DB.prepare(
        "INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time) VALUES (?1, ?2, ?3, ?4, ?5, 'ACTIVE', '2026-10-05T00:00:00.000Z')",
      ).bind(ad, post, name, `as_${ad}`, adset),
    ]),
  );
  // Pods started Oct 1, so the untraceable Oct 5 posts are unassigned, not agency.
  await env.DB.prepare(
    `UPDATE settings SET value = '{"agencyPrefixes":["ME","QW","TV","YD"],"podsStartDate":"2026-10-01T00:00:00.000Z"}' WHERE key = 'attribution'`,
  ).run();
  await attribute(env.DB);
});

const call = (path: string, init: RequestInit = {}, e: Env = env) =>
  app.fetch(new Request(`https://hub.test${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }), e, {} as ExecutionContext);
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
const pod = async (post: string) =>
  env.DB.prepare("SELECT pod_id, pod_source, editor_id, angle, tags_source, updated_by FROM assignments WHERE post_id = ?1")
    .bind(post)
    .first<Record<string, string | null>>();

describe("tagging", () => {
  it("sets a pod by hand, and a later re-attribution keeps it", async () => {
    expect((await pod("p_unknown1"))!.pod_id).toBeNull();
    const res = await call("/api/posts/p_unknown1/assignment", json("PATCH", { podId: "shameer", angle: "Depuff" }));
    expect(res.status).toBe(200);
    expect(await pod("p_unknown1")).toMatchObject({
      pod_id: "shameer",
      pod_source: "manual",
      angle: "Depuff",
      tags_source: "manual",
      updated_by: "nosa@kojeva.com",
    });
    await attribute(env.DB);
    expect(await pod("p_unknown1")).toMatchObject({ pod_id: "shameer", pod_source: "manual", angle: "Depuff" });
  });

  it("resets a post back to automatic", async () => {
    await call("/api/posts/p_harris/assignment", json("PATCH", { podId: "dhia" }));
    expect((await pod("p_harris"))!.pod_id).toBe("dhia");
    await call("/api/posts/p_harris/assignment", json("PATCH", { reset: ["pod"] }));
    expect(await pod("p_harris")).toMatchObject({ pod_id: "harris", pod_source: "adset" });
  });

  it("assigns many posts at once", async () => {
    const res = await call("/api/assignments/bulk", json("POST", { postIds: ["p_unknown1", "p_unknown2"], patch: { podId: "ali" } }));
    expect(await res.json()).toEqual({ ok: true, updated: 2 });
    expect((await pod("p_unknown1"))!.pod_id).toBe("ali");
    expect((await pod("p_unknown2"))!.pod_id).toBe("ali");
  });

  it("rejects values outside the vocabularies", async () => {
    expect((await call("/api/posts/p_harris/assignment", json("PATCH", { angle: "Nope" }))).status).toBe(400);
    expect((await call("/api/posts/p_harris/assignment", json("PATCH", { podId: "bob" }))).status).toBe(400);
    expect((await call("/api/posts/missing/assignment", json("PATCH", { podId: "ali" }))).status).toBe(404);
  });
});

describe("guards", () => {
  it("refuses edits without Cloudflare Access", async () => {
    const open = { ...env, ACCESS_TEAM_DOMAIN: "" };
    expect((await call("/api/posts/p_harris/assignment", json("PATCH", { podId: "ali" }), open)).status).toBe(403);
    expect((await call("/api/settings", json("PUT", { targets: { targetCpa: 15 } }), open)).status).toBe(403);
  });

  it("refuses edits with a missing or forged sign-in", async () => {
    const bare = new Request("https://hub.test/api/posts/p_harris/assignment", json("PATCH", { podId: "ali" }));
    expect((await app.fetch(bare, env, {} as ExecutionContext)).status).toBe(401);
  });

  it("still answers 404 for unknown API paths", async () => {
    expect((await call("/api/nope")).status).toBe(404);
  });
});

describe("settings", () => {
  it("saves targets and shows them back", async () => {
    expect((await call("/api/settings", json("PUT", { targets: { targetCpa: 15, hitRule: "either" } }))).status).toBe(200);
    const meta = (await (await call("/api/meta")).json()) as { targets: Record<string, unknown>; canEdit: boolean };
    expect(meta.targets).toMatchObject({ targetCpa: 15, targetRoas: 1.7, hitRule: "either", minTestSpend: 100 });
    expect(meta.canEdit).toBe(true);
  });

  it("validates targets", async () => {
    for (const targets of [{ targetCpa: -1 }, { testWindowDays: 2.5 }, { hitRule: "sometimes" }])
      expect((await call("/api/settings", json("PUT", { targets }))).status).toBe(400);
  });

  it("re-credits posts when the agency codes change", async () => {
    expect((await pod("p_agency"))!.pod_id).toBe("agency");
    await call("/api/settings", json("PUT", { attribution: { agencyPrefixes: ["qw", "TV"] } }));
    expect((await pod("p_agency"))!.pod_id).toBeNull();
    const meta = (await (await call("/api/meta")).json()) as { attribution: { agencyPrefixes: string[] } };
    expect(meta.attribution.agencyPrefixes).toEqual(["QW", "TV"]);
  });

  it("re-credits posts when the pods start date changes", async () => {
    expect((await pod("p_unknown1"))!.pod_id).toBeNull();
    await call("/api/settings", json("PUT", { attribution: { podsStartDate: "2026-10-10" } }));
    expect(await pod("p_unknown1")).toMatchObject({ pod_id: "agency", pod_source: "era" });
  });
});

describe("editors", () => {
  it("adds an editor, assigns them, and clears assignments on delete", async () => {
    const res = await call("/api/editors", json("POST", { name: "Tolu", podId: "harris" }));
    expect(res.status).toBe(201);
    const editor = (await res.json()) as { id: string };
    await call("/api/posts/p_harris/assignment", json("PATCH", { editorId: editor.id }));
    expect((await pod("p_harris"))!.editor_id).toBe(editor.id);
    const meta = (await (await call("/api/meta")).json()) as { editors: { name: string }[] };
    expect(meta.editors.map((e) => e.name)).toEqual(["Tolu"]);
    await call(`/api/editors/${editor.id}`, { method: "DELETE" });
    expect((await pod("p_harris"))!.editor_id).toBeNull();
  });
});
