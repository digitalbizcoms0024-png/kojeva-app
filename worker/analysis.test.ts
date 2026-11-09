import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CreativeAnalysis } from "../shared/analysis.ts";
import { analyzeAsset, analyzeNew } from "./analysis.ts";
import type { Env } from "./env.ts";
import app from "./index.ts";
import { accessFixture, TEST_TEAM } from "./testing/access.ts";
import { testDb } from "./testing/db.ts";

let env: Env;
let person: Record<string, string>;
beforeAll(async () => {
  ({ headers: person } = await accessFixture("nosa@kojeva.com"));
});
const VIDEO_SRC = "https://video.fbcdn.example/ad.mp4";

/** Answers Meta (video source, creative copy) and Gemini (upload, processing, answer, delete). */
function fakeApis(answer: object = goodAnswer(), calls: string[] = []) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
    if (url.host === "graph.facebook.com") {
      if (url.pathname.endsWith("/vid1")) return Response.json({ source: VIDEO_SRC, id: "vid1" });
      if (url.pathname.endsWith("/cr1")) return Response.json({ body: "Face-Sculpt in 90s: light strokes…" });
      return Response.json({ error: { message: "unexpected", code: 100 } }, { status: 400 });
    }
    if (url.href === VIDEO_SRC) return new Response(new Uint8Array(1024), { headers: { "content-type": "video/mp4", "content-length": "1024" } });
    if (url.pathname === "/upload/v1beta/files") return new Response("{}", { headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/session/1" } });
    if (url.pathname === "/upload/session/1") return Response.json({ file: { name: "files/abc", uri: "https://g/files/abc", state: "PROCESSING", mimeType: "video/mp4" } });
    if (url.pathname === "/v1beta/files/abc" && (init?.method ?? "GET") === "GET") return Response.json({ name: "files/abc", uri: "https://g/files/abc", state: "ACTIVE" });
    if (url.pathname === "/v1beta/files/abc") return Response.json({});
    if (url.pathname.endsWith(":generateContent")) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
    return Response.json({ error: { message: `unexpected ${url.href}` } }, { status: 404 });
  }) as typeof fetch;
}

function goodAnswer() {
  return {
    tags: {
      assetType: "UGC",
      visualFormat: "Product Demo",
      adAngle: "Problem/Solution",
      hookTactic: "Relatable Scenario",
      offer: "No Offer",
      funnelStage: "TOF",
      headlineTactic: "Offer",
      textHook: "Benefit Statement",
      visualHook: "Product Demonstration",
      theme: "Problem/Solution",
      seasonality: "Evergreen",
      emotion: "Something new", // not on the list: becomes Other
      awarenessLevel: "Problem Aware",
      persona: "Self-Conscious Morning Routiners",
      usp: "Dry Lymphatic Drainage Brush",
      desire: "Snatched Jawline De-Puffing",
    },
    readout: {
      summary: "A selfie-style UGC video…",
      hook: "me every morning because I want to have a snatched jawline",
      primaryMessage: "Define your jawline in 90 seconds.",
      awarenessNote: "Leads with a common pain point.",
      observations: ["A woman in a bathrobe uses a curved dry brush."],
      proof: "on-screen text",
      ideas: ["Split-screen before/after"],
      transcript: "me every morning…",
    },
  };
}

const req = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`https://hub.test${path}`, { ...init, headers: { ...person, ...((init.headers as Record<string, string>) ?? {}) } }), env, {} as ExecutionContext);
const noWait = async () => undefined;

beforeEach(async () => {
  env = {
    DB: await testDb(),
    META_APP_ID: "x",
    META_AD_ACCOUNT_ID: "act_1",
    META_GRAPH_VERSION: "v26.0",
    META_SYSTEM_TOKEN: "t",
    ACCESS_TEAM_DOMAIN: TEST_TEAM,
    GEMINI_API_KEY: "k",
  } as Env;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO posts (id, media_type) VALUES ('p1', 'video'), ('p2', 'video'), ('p3', 'video')"),
    env.DB.prepare(
      `INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, asset_id, creative_id) VALUES
       ('a1', 'p1', 'KOJEVA AI UGC 7', 's1', 'Harris | AI UGC | Concept 7', 'ACTIVE', 'v:vid1', 'cr1'),
       ('a2', 'p2', 'copy', 's2', 'Cost Cap | Scale', 'ACTIVE', 'v:vid1', 'cr1'),
       ('a3', 'p3', 'Post ID ad', 's3', 'Shameer | Native | X', 'ACTIVE', 'p:p3', NULL)`,
    ),
    env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, impressions, link_clicks, purchases, revenue_cents) VALUES ('a1', '2026-11-08', 9000, 1, 1, 1, 1), ('a3', '2026-11-08', 9000, 1, 1, 1, 1)"),
  ]);
});

describe("Gemini creative analysis", () => {
  it("watches the video with its copy, keeps tags to the lists, and shares the result between copies", async () => {
    const calls: string[] = [];
    await analyzeAsset(env, env.DB, "v:vid1", "cr1", "editor@kojeva.com", fakeApis(goodAnswer(), calls), noWait);
    const r = (await (await req("/api/posts/p2/analysis")).json()) as { enabled: boolean; analysis: CreativeAnalysis };
    expect(r.enabled).toBe(true);
    expect(r.analysis).toMatchObject({ status: "analyzed", media: "video", manual: [] });
    expect(r.analysis.tags).toMatchObject({ funnelStage: "TOF", hookTactic: "Relatable Scenario", emotion: "Other", persona: "Self-Conscious Morning Routiners" });
    expect(r.analysis.readout?.hook).toContain("snatched jawline");
    // Read-only on Meta: only GETs there. The uploaded file is removed afterwards.
    expect(calls.filter((c) => c.includes("graph.facebook.com")).every((c) => c.startsWith("GET"))).toBe(true);
    expect(calls).toContain("DELETE generativelanguage.googleapis.com/v1beta/files/abc");
  });

  it("keeps hand edits through a re-analysis, and validates them", async () => {
    await analyzeAsset(env, env.DB, "v:vid1", "cr1", "e", fakeApis(), noWait);
    const patch = (tags: object) => req("/api/posts/p1/analysis", { method: "PATCH", body: JSON.stringify({ tags }), headers: { "content-type": "application/json" } });
    expect((await patch({ funnelStage: "Nope" })).status).toBe(400);
    const edited = (await (await patch({ funnelStage: "MOF", persona: "Busy moms" })).json()) as { analysis: CreativeAnalysis };
    expect(edited.analysis.tags.funnelStage).toBe("MOF");
    expect(edited.analysis.manual.sort()).toEqual(["funnelStage", "persona"]);
    await analyzeAsset(env, env.DB, "v:vid1", "cr1", "e", fakeApis(), noWait);
    const again = (await (await req("/api/posts/p1/analysis")).json()) as { analysis: CreativeAnalysis };
    expect(again.analysis.tags).toMatchObject({ funnelStage: "MOF", persona: "Busy moms", hookTactic: "Relatable Scenario" });
  });

  it("marks hidden Post ID ads as having no media, and records Gemini failures", async () => {
    await analyzeAsset(env, env.DB, "p:p3", null, "e", fakeApis(), noWait);
    const hidden = (await (await req("/api/posts/p3/analysis")).json()) as { analysis: CreativeAnalysis };
    expect(hidden.analysis.status).toBe("no_media");
    await analyzeAsset(env, env.DB, "v:vid1", "cr1", "e", fakeApis({ nonsense: true }), noWait);
    const bad = (await (await req("/api/posts/p1/analysis")).json()) as { analysis: CreativeAnalysis };
    expect(bad.analysis.status).toBe("analyzed"); // empty readout, but a valid answer
  });

  it("is off without a key", async () => {
    env.GEMINI_API_KEY = undefined;
    expect(((await (await req("/api/posts/p1/analysis")).json()) as { enabled: boolean }).enabled).toBe(false);
    expect((await req("/api/posts/p1/analyze", { method: "POST" })).status).toBe(409);
    expect(await analyzeNew(env, env.DB, fakeApis(), noWait)).toBe(0);
  });

  it("analyzes new creatives from $50 spent nightly, once each, within the cap", async () => {
    // vid1 ($90) is new; p:p3 is hidden and never queued.
    expect(await analyzeNew(env, env.DB, fakeApis(), noWait)).toBe(1);
    expect(await analyzeNew(env, env.DB, fakeApis(), noWait)).toBe(0);
    await env.DB.prepare("DELETE FROM creative_analyses").run();
    env.GEMINI_MIN_SPEND = "100";
    expect(await analyzeNew(env, env.DB, fakeApis(), noWait)).toBe(0);
  });
});
