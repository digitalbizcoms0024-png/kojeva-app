// The summaries (results kept per sync and reused across edits, worker/cache.ts) must match a
// from-scratch recomputation number for number, on the sample data and after edits.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ConceptsResponse } from "../shared/api.ts";
import app from "./index.ts";
import { bumpStats, forgetMemory } from "./cache.ts";
import type { Env } from "./env.ts";
import { accessFixture, TEST_TEAM } from "./testing/access.ts";
import { testDb } from "./testing/db.ts";

let env: Env;
let person: Record<string, string>;

beforeAll(async () => {
  ({ headers: person } = await accessFixture("nosa@kojeva.com"));
  env = {
    DB: await testDb(
      readFileSync(join(import.meta.dirname, "../seed/sample.sql"), "utf8"),
    ),
    META_APP_ID: "x",
    META_AD_ACCOUNT_ID: "act_1",
    META_GRAPH_VERSION: "v26.0",
    ACCESS_TEAM_DOMAIN: TEST_TEAM,
  };
});

const call = (path: string, init: RequestInit = {}) =>
  app.fetch(
    new Request(`https://hub.test${path}`, {
      ...init,
      headers: { ...person, "Content-Type": "application/json" },
    }),
    env,
    {} as ExecutionContext,
  );

const PAGES = [
  "/api/meta",
  "/api/rankings?range=all",
  "/api/rankings?range=week&sort=cpa",
  "/api/pods?range=all",
  "/api/pods?range=month",
  "/api/concepts?range=all",
  "/api/alerts",
  "/api/trends?range=all",
  "/api/trends?range=month",
  "/api/coverage?range=month",
  "/api/insights?range=all&dimension=angle",
  "/api/launches?weeks=8",
];

async function everyPage(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const p of PAGES) {
    const res = await call(p);
    expect(res.status, p).toBe(200);
    out[p] = await res.json();
  }
  return out;
}

/** The same pages computed from nothing: a fresh isolate after the summaries were dropped. */
async function fromScratch() {
  await bumpStats(env.DB);
  forgetMemory();
  return everyPage();
}

describe("summaries", () => {
  it("match a from-scratch recomputation, before and after tag edits", async () => {
    const warm = await everyPage();
    expect(await fromScratch()).toEqual(warm);

    // Edits change labels only: the ad numbers are reused, the pages must still be exact.
    const concepts = (
      (await (await call("/api/concepts?range=all")).json()) as ConceptsResponse
    ).rows;
    const posts = (
      (await (await call("/api/rankings?range=all")).json()) as {
        items: { postId: string; assignment: { podId: string | null } }[];
      }
    ).items;
    const moved = posts.find((p) => p.assignment.podId === "harris")!;
    expect(
      (
        await call(`/api/posts/${moved.postId}/assignment`, {
          method: "PATCH",
          body: JSON.stringify({ podId: "ali", angle: "Comparison" }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`/api/posts/${posts[1]!.postId}/assignment`, {
          method: "PATCH",
          body: JSON.stringify({ podId: null }),
        })
      ).status,
    ).toBe(200);
    const edited = await everyPage();
    expect(edited["/api/pods?range=all"]).not.toEqual(
      warm["/api/pods?range=all"],
    );
    expect(await fromScratch()).toEqual(edited);

    // A concept card too.
    const id = concepts[0]!.conceptId;
    const card = await (
      await call(`/api/concepts/${encodeURIComponent(id)}`)
    ).json();
    forgetMemory();
    await bumpStats(env.DB);
    expect(
      await (await call(`/api/concepts/${encodeURIComponent(id)}`)).json(),
    ).toEqual(card);
  });
});
