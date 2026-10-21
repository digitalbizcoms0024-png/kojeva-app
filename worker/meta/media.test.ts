import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env.ts";
import { testDb } from "../testing/db.ts";
import { adMedia } from "./media.ts";

let env: Env;
beforeEach(async () => {
  env = { DB: await testDb(), META_APP_ID: "x", META_AD_ACCOUNT_ID: "act_1", META_GRAPH_VERSION: "v26.0", META_SYSTEM_TOKEN: "tok" } as Env;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO posts (id, media_type) VALUES ('p1', 'video')"),
    env.DB.prepare(
      `INSERT INTO ads (id, post_id, name, adset_id, adset_name, status, created_time) VALUES
       ('120238254147030075', 'p1', 'Video 153', 's1', 'Listicle', 'ACTIVE', '2026-05-01T00:00:00Z')`,
    ),
  ]);
});

const fake = (routes: Record<string, unknown>) => {
  const calls: string[] = [];
  const fetcher = (async (input: string) => {
    const path = new URL(input).pathname.replace("/v26.0/", "");
    calls.push(path);
    const body = routes[path];
    return body === undefined ? Response.json({ error: { message: "Unsupported get request", code: 100 } }, { status: 400 }) : Response.json(body);
  }) as unknown as typeof fetch;
  return { fetcher, calls };
};

describe("ad media", () => {
  it("returns the copy and a video file through the hub's Meta connection", async () => {
    const { fetcher, calls } = fake({
      "120238254147030075": { creative: { body: "My face in the morning…", title: "Depuff in 90 seconds", video_id: "1053927990294150", thumbnail_url: "https://x.fbcdn.net/t.jpg" } },
      "1053927990294150": { source: "https://video.fbcdn.net/v.mp4", length: 31.5 },
    });
    expect(await adMedia(env, env.DB, "120238254147030075", fetcher)).toEqual({
      adId: "120238254147030075",
      body: "My face in the morning…",
      title: "Depuff in 90 seconds",
      videoUrl: "https://video.fbcdn.net/v.mp4",
      videoSeconds: 31.5,
      videoError: null,
      imageUrl: "https://x.fbcdn.net/t.jpg",
    });
    expect(calls).toEqual(["120238254147030075", "1053927990294150"]);
  });

  it("still returns the copy and thumbnail when Meta hides the video, and refuses unknown ads", async () => {
    const { fetcher } = fake({
      "120238254147030075": { creative: { object_story_spec: { video_data: { message: "Real brush vs fake", video_id: "999", image_url: "https://x.fbcdn.net/p.jpg" } } } },
    });
    expect(await adMedia(env, env.DB, "120238254147030075", fetcher)).toMatchObject({ body: "Real brush vs fake", videoUrl: null, imageUrl: "https://x.fbcdn.net/p.jpg" });
    // The ad account's video library has it even when the video itself is hidden.
    const lib = fake({
      "120238254147030075": { creative: { video_id: "999", image_url: "https://www.facebook.com/ads/image/?d=x", thumbnail_url: "https://x.fbcdn.net/t.jpg" } },
      "act_1/advideos": { data: [{ id: "999", source: "https://video.fbcdn.net/999.mp4", length: 12 }] },
    });
    expect(await adMedia(env, env.DB, "120238254147030075", lib.fetcher)).toMatchObject({ videoUrl: "https://video.fbcdn.net/999.mp4", videoError: null, imageUrl: "https://x.fbcdn.net/t.jpg" });
    expect(await adMedia(env, env.DB, "nope", fetcher)).toMatchObject({ status: 404 });
  });
});
