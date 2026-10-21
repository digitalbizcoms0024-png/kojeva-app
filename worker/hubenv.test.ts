import { describe, expect, it } from "vitest";
import app from "./index.ts";
import type { Env } from "./env.ts";
import { testDb } from "./testing/db.ts";

const get = async (host: string, HUB_ENV: string) =>
  app.fetch(new Request(`https://${host}/api/meta`), { DB: await testDb(), META_GRAPH_VERSION: "v26.0", HUB_ENV } as Env, {} as ExecutionContext);

describe("preview build", () => {
  it("refuses to serve the live address, and serves its own", async () => {
    const wrong = await get("kojeva-hub.digitalbizcoms0024.workers.dev", "preview");
    expect(wrong.status).toBe(503);
    expect(((await wrong.json()) as { error: string }).error).toMatch(/preview build is running on the live address/);
    expect((await get("kojeva-hub-preview.digitalbizcoms0024.workers.dev", "preview")).status).toBe(200);
    expect((await get("kojeva-hub.digitalbizcoms0024.workers.dev", "live")).status).toBe(200);
  });
});
