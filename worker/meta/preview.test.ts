import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env.ts";
import { testDb } from "../testing/db.ts";
import { adPreview, parsePreviewIframe } from "./preview.ts";

// The iframe Meta returned for V457 | CBO (a "Post ID" ad whose media ads_read can't see), Oct 2026.
const BODY =
  '<iframe src="https://business.facebook.com/ads/api/preview_iframe.php?d=AQKI9F&amp;t=AQIbz7" width="335" height="450" scrolling="yes" style="border: none;" allow="autoplay"></iframe>';

let env: Env;
beforeEach(async () => {
  env = {
    DB: await testDb(),
    META_APP_ID: "x",
    META_AD_ACCOUNT_ID: "act_1",
    META_GRAPH_VERSION: "v26.0",
    META_SYSTEM_TOKEN: "tok",
  } as Env;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO posts (id, media_type) VALUES ('776862388850901_1516733839978074', 'video')",
    ),
    env.DB.prepare(
      `INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time) VALUES
       ('120243384591870075', '776862388850901_1516733839978074', 'V457 | CBO', 's1', 'Half-Face Reveal', 'PAUSED', '2026-05-01T00:00:00Z'),
       ('120243645145570075', '776862388850901_1516733839978074', 'V457 – Copy', 's2', 'Cost Cap | Scale', 'ACTIVE', '2026-05-02T00:00:00Z')`,
    ),
  ]);
});

describe("ad preview", () => {
  it("reads the iframe Meta returns", () => {
    expect(parsePreviewIframe(BODY)).toEqual({
      src: "https://business.facebook.com/ads/api/preview_iframe.php?d=AQKI9F&t=AQIbz7",
      width: 335,
      height: 450,
    });
    expect(parsePreviewIframe("<p>nothing</p>")).toBeNull();
  });

  it("asks Meta for an active copy's preview in the requested placement", async () => {
    const calls: URL[] = [];
    const fetcher = (async (input: string) => {
      calls.push(new URL(input));
      return Response.json({ data: [{ body: BODY }] });
    }) as unknown as typeof fetch;
    const res = await adPreview(
      env,
      env.DB,
      "776862388850901_1516733839978074",
      "INSTAGRAM_REELS",
      fetcher,
    );
    expect(res).toMatchObject({
      adId: "120243645145570075",
      format: "INSTAGRAM_REELS",
      width: 335,
      height: 450,
    });
    expect(calls[0]!.pathname).toBe("/v26.0/120243645145570075/previews");
    expect(calls[0]!.searchParams.get("ad_format")).toBe("INSTAGRAM_REELS");
  });

  it("explains what's missing instead of failing", async () => {
    expect(
      await adPreview(env, env.DB, "nope", "MOBILE_FEED_STANDARD"),
    ).toMatchObject({ status: 404 });
    expect(
      await adPreview(
        { ...env, META_SYSTEM_TOKEN: undefined, TOKEN_KEY: undefined } as Env,
        env.DB,
        "776862388850901_1516733839978074",
        "MOBILE_FEED_STANDARD",
      ),
    ).toMatchObject({
      status: 409,
    });
    const failing = (async () =>
      Response.json(
        { error: { message: "(#100) Ad not found", code: 100 } },
        { status: 400 },
      )) as unknown as typeof fetch;
    expect(
      await adPreview(
        env,
        env.DB,
        "776862388850901_1516733839978074",
        "MOBILE_FEED_STANDARD",
        failing,
      ),
    ).toMatchObject({ status: 502 });
  });
});
