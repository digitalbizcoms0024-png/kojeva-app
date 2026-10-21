import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "./index.ts";
import type { Env } from "./env.ts";
import type { MetaResponse, RankingsResponse } from "../shared/api.ts";
import { podFromAdSetName } from "../shared/attribution.ts";
import { attribute } from "./meta/sync.ts";
import { accessFixture, TEST_TEAM } from "./testing/access.ts";
import { testDb } from "./testing/db.ts";

let env: Env;
let person: Record<string, string>;

beforeAll(async () => {
  ({ headers: person } = await accessFixture("nosa@kojeva.com"));
});

// The real Trybe ad (Oct 2026) plus one for a pod added in a test.
beforeEach(async () => {
  env = { DB: await testDb(), META_APP_ID: "x", META_AD_ACCOUNT_ID: "act_1", META_GRAPH_VERSION: "v26.0", ACCESS_TEAM_DOMAIN: TEST_TEAM };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO posts (id, media_type) VALUES ('p1', 'video'), ('p2', 'video'), ('p3', 'image')"),
    env.DB.prepare(
      `INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time) VALUES
       ('1', 'p1', 'LarissaValladarez_KojevaLymphaticFaceBrush_20260929_trybe=4711077a', 's1', 'TRYBE | Larissa V | Jawline Angle', 'ACTIVE', '2026-09-29T00:00:00Z'),
       ('2', 'p2', 'Creator clip 4', 's2', 'GLOW | Ana R | Puffiness', 'ACTIVE', '2026-10-02T00:00:00Z'),
       ('3', 'p3', 'Static 9', 's3', 'IH | Harris | KOJEVA 3 | STATIC', 'ACTIVE', '2026-09-01T00:00:00Z')`,
    ),
    env.DB.prepare(
      "INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES ('1', '2026-10-10', 31800, 20, 60000), ('2', '2026-10-10', 9000, 3, 8000), ('3', '2026-10-10', 5000, 2, 6000)",
    ),
  ]);
  await attribute(env.DB);
});

const call = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`https://hub.test${path}`, { ...init, headers: { ...person, ...(init.headers ?? {}) } }), env, {} as ExecutionContext);
const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const podOf = async (postId: string) =>
  (await json<RankingsResponse>(call("/api/rankings?range=all"))).items.find((p) => p.postId === postId)?.assignment.podId ?? null;

describe("added pods", () => {
  it("credits Trybe's ad sets to the Trybe pod, beside the built-in pods and before the agency", async () => {
    expect(await podOf("p1")).toBe("trybe");
    const meta = await json<MetaResponse>(call("/api/meta"));
    expect(meta.pods.map((p) => p.id)).toEqual(["harris", "dhia", "shameer", "ali", "trybe", "agency"]);
    expect(meta.pods.find((p) => p.id === "trybe")).toMatchObject({ name: "Trybe", prefix: "TRYBE", slot: 0, kind: "pod" });
  });

  it("adds a pod by ad set prefix, re-credits its ads, and keeps hand-set pods", async () => {
    expect(await podOf("p2")).toBeNull();
    await call("/api/posts/p3/assignment", { method: "PATCH", body: JSON.stringify({ podId: "dhia" }) });
    const res = await call("/api/pods", { method: "POST", body: JSON.stringify({ name: "Glow Studio", prefix: "glow" }) });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "glow-studio", code: "GLO", slot: 1 });
    expect(await podOf("p2")).toBe("glow-studio");
    expect(await podOf("p3")).toBe("dhia");
    expect(podFromAdSetName("GLOW | Ana R | Puffiness")).toBe("GLO");
  });

  it("rejects clashes, agency codes and a full palette", async () => {
    const add = (name: string, prefix: string) => call("/api/pods", { method: "POST", body: JSON.stringify({ name, prefix }) });
    expect((await add("Trybe", "TRY2")).status).toBe(400); // name taken
    expect((await add("Other", "TRYBE")).status).toBe(400); // prefix taken
    expect((await add("Harris Two", "HARRIS")).status).toBe(400); // built-in pod's name
    expect((await add("Media", "ME")).status).toBe(400); // agency code
    expect((await add("A", "X")).status).toBe(400); // too short
    expect((await add("Glow", "GLOW")).status).toBe(201);
    expect((await add("Bloom", "BLOOM")).status).toBe(201);
    const full = await add("Spark", "SPARK");
    expect(full.status).toBe(400);
    expect(((await full.json()) as { error: string }).error).toMatch(/colors/);
  });

  it("removes an added pod and hands its ads back, but never a built-in pod", async () => {
    expect((await call("/api/pods/harris", { method: "DELETE" })).status).toBe(400);
    expect((await call("/api/pods/trybe", { method: "DELETE" })).status).toBe(200);
    expect(await podOf("p1")).toBeNull();
    expect((await json<MetaResponse>(call("/api/meta"))).pods.some((p) => p.id === "trybe")).toBe(false);
  });

  it("re-credits once by itself after a deploy changes the rules, not on every request", async () => {
    const addAd = (id: string) =>
      env.DB.batch([
        env.DB.prepare("INSERT INTO posts (id, media_type) VALUES (?1, 'video')").bind(`p${id}`),
        env.DB.prepare(
          "INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time) VALUES (?1, ?2, 'clip', 's9', 'TRYBE | Mia K | Puffy', 'ACTIVE', '2026-10-05T00:00:00Z')",
        ).bind(id, `p${id}`),
        env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES (?1, '2026-10-10', 1000, 1, 2000)").bind(id),
      ]);
    // First request after "deploy": no stored fingerprint, so everything is re-credited once.
    await addAd("8");
    expect(await podOf("p8")).toBe("trybe");
    // Same rules: a new ad waits for the next sync instead of re-crediting on every request.
    await addAd("9");
    await env.DB.prepare("UPDATE settings SET value = value WHERE key = 'data_version'").run();
    await call("/api/posts/p3/assignment", { method: "PATCH", body: JSON.stringify({ angle: "Scarcity" }) });
    expect(await podOf("p9")).toBeNull();
    // A changed rule set (simulated by a different stored fingerprint) re-credits again.
    await env.DB.prepare("UPDATE settings SET value = 'old' WHERE key = 'rules_fingerprint'").run();
    await call("/api/posts/p3/assignment", { method: "PATCH", body: JSON.stringify({ angle: "Comparison" }) });
    expect(await podOf("p9")).toBe("trybe");
  });
});
