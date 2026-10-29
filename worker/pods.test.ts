import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "./index.ts";
import type { Env } from "./env.ts";
import type { ConceptsResponse, MetaResponse, PodsResponse, RankingsResponse } from "../shared/api.ts";
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

  it("matches a prefix ignoring spaces and case, or as a part's first word; in-house pods are ticked in Settings", async () => {
    // Trybe (added before the tick existed) is a partner; a new pod defaults to in-house.
    const pod0 = await call("/api/pods", { method: "POST", body: JSON.stringify({ name: "Pod 0", prefix: "POD0" }), headers: { "content-type": "application/json" } });
    expect(pod0.status).toBe(201);
    await call("/api/pods", { method: "POST", body: JSON.stringify({ name: "Caicos", prefix: "CAICOS" }), headers: { "content-type": "application/json" } });
    expect(podFromAdSetName("Pod 0 | Andrei | Depuff Static")).toBe(podFromAdSetName("POD0 | Andrei | x"));
    expect(podFromAdSetName("pod-0 | Reika | Hook test")).not.toBeNull();
    expect(podFromAdSetName("Caicos Pod | Jawline Hook | Static")).not.toBeNull();
    expect(podFromAdSetName("Caicos | Jawline Hook")).toBe(podFromAdSetName("Caicos Pod | Jawline Hook | Static"));
    const meta = await json<MetaResponse>(call("/api/meta"));
    const inhouse = (id: string) => meta.pods.find((p) => p.id === id)?.inhouse;
    expect([inhouse("harris"), inhouse("pod-0"), inhouse("caicos"), inhouse("trybe"), inhouse("agency")]).toEqual([true, true, true, false, false]);

    // The In-house view follows the tick: Trybe's ad joins once it's ticked.
    const inhouseIds = async () => (await json<RankingsResponse>(call("/api/rankings?range=all&pod=inhouse"))).items.map((p) => p.postId).sort();
    expect(await inhouseIds()).toEqual(["p3"]);
    await call("/api/pods/trybe", { method: "PATCH", body: JSON.stringify({ inhouse: true }), headers: { "content-type": "application/json" } });
    expect(await inhouseIds()).toEqual(["p1", "p3"]);
  });

  it("stores a pod's strategists for a per-strategist hit rate, and checks them", async () => {
    const patch = (body: unknown) => call("/api/pods/trybe", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    expect((await patch({ members: ["Andrei", " Reika ", "andrei", "Adrian"] })).status).toBe(200);
    const meta = await json<MetaResponse>(call("/api/meta"));
    expect(meta.pods.find((p) => p.id === "trybe")?.members).toEqual(["Andrei", "Reika", "Adrian"]);
    expect((await patch({ members: ["A"] })).status).toBe(400);
    expect((await patch({ members: [] })).status).toBe(200);
    expect((await json<MetaResponse>(call("/api/meta"))).pods.find((p) => p.id === "trybe")?.members).toEqual([]);
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

  it("credits an ad set naming a pod and a partner to both, and counts its spend once in totals", async () => {
    // The first such ad set (scheduled Oct 29): Shameer's concept made with Trybe.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO posts (id, media_type) VALUES ('p4', 'video')"),
      env.DB.prepare(
        "INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time) VALUES ('4', 'p4', 'Shameer | Trybe | 1', 's4', 'Shameer | Trybe | UGC | 60 Sec Video Demo', 'ACTIVE', '2026-10-09T00:00:00Z')",
      ),
      env.DB.prepare("INSERT INTO ad_daily (ad_id, date, spend_cents, purchases, revenue_cents) VALUES ('4', '2026-10-10', 12000, 10, 30000)"),
    ]);
    await attribute(env.DB);
    const p4 = (await json<RankingsResponse>(call("/api/rankings?range=all"))).items.find((p) => p.postId === "p4")!;
    expect(p4.assignment).toMatchObject({ podId: "shameer", coPodId: "trybe", podSource: "adset" });
    const ids = async (pod: string) => (await json<RankingsResponse>(call(`/api/rankings?range=all&pod=${pod}`))).items.map((p) => p.postId).sort();
    expect(await ids("shameer")).toEqual(["p4"]);
    expect(await ids("trybe")).toEqual(["p1", "p4"]);

    const concept = (await json<ConceptsResponse>(call("/api/concepts?range=all"))).rows.find((k) => k.adsetName.startsWith("Shameer | Trybe"))!;
    expect(concept).toMatchObject({ podId: "shameer", coPodId: "trybe", label: "UGC | 60 Sec Video Demo" });

    const rows = (await json<PodsResponse>(call("/api/pods?range=all"))).rows;
    const shameer = rows.find((r) => r.podId === "shameer")!;
    const trybe = rows.find((r) => r.podId === "trybe")!;
    expect(shameer).toMatchObject({ concepts: 1, live: 1, sharedCents: 0 });
    expect(shameer.totals.spendCents).toBe(12000);
    expect(trybe).toMatchObject({ concepts: 2, live: 2, sharedCents: 12000 });
    expect(trybe.totals.spendCents).toBe(31800 + 12000);
    // Every row added up, minus shared spend, is the account's spend.
    const sum = rows.reduce((n, r) => n + r.totals.spendCents - r.sharedCents, 0);
    expect(sum).toBe(31800 + 9000 + 5000 + 12000);

    // A re-sync with nothing changed writes nothing.
    await attribute(env.DB);
    const again = (await json<RankingsResponse>(call("/api/rankings?range=all"))).items.find((p) => p.postId === "p4")!;
    expect(again.assignment.coPodId).toBe("trybe");

    // Removing Trybe leaves Shameer's credit.
    await call("/api/pods/trybe", { method: "DELETE" });
    const after = (await json<RankingsResponse>(call("/api/rankings?range=all"))).items.find((p) => p.postId === "p4")!;
    expect(after.assignment).toMatchObject({ podId: "shameer", coPodId: null });
  });

  it("sets or clears the partner by hand from To review", async () => {
    const patch = (body: unknown) => call("/api/posts/p3/assignment", { method: "PATCH", body: JSON.stringify(body) });
    expect((await patch({ coPodId: "harris" })).status).toBe(400); // in-house: not a partner
    expect((await patch({ coPodId: "trybe" })).status).toBe(200);
    const p3 = async () => (await json<RankingsResponse>(call("/api/rankings?range=all"))).items.find((p) => p.postId === "p3")!.assignment;
    expect(await p3()).toMatchObject({ podId: "harris", coPodId: "trybe", podSource: "manual" });
    await attribute(env.DB);
    expect((await p3()).coPodId).toBe("trybe"); // hand-set: a sync keeps it
    expect((await patch({ coPodId: null })).status).toBe(200);
    expect((await p3()).coPodId).toBeNull();
  });
});
