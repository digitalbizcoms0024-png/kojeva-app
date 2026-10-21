// Meta's own ad preview (video with play/pause and sound, caption, headline), fetched when someone
// presses play. Read-only (ads_read); works for post-based ads whose media the token can't read.
import type { Env } from "../env.ts";
import { GraphError } from "./graph.ts";
import { clientFor, getToken } from "./sync.ts";

export const PREVIEW_FORMATS = [
  "MOBILE_FEED_STANDARD",
  "INSTAGRAM_STANDARD",
  "INSTAGRAM_REELS",
  "INSTAGRAM_STORY",
] as const;
export type PreviewFormat = (typeof PREVIEW_FORMATS)[number];

export interface AdPreview {
  adId: string;
  format: PreviewFormat;
  /** The preview iframe's address; Meta's links expire, so it's fetched fresh each time. */
  src: string;
  width: number;
  height: number;
}

/** Reads src/width/height from the iframe HTML Meta returns. */
export function parsePreviewIframe(
  html: string,
): { src: string; width: number; height: number } | null {
  const src = /src="([^"]+)"/.exec(html)?.[1];
  if (!src) return null;
  const num = (attr: string, fallback: number) =>
    Number(new RegExp(`${attr}="(\\d+)"`).exec(html)?.[1] ?? fallback);
  return {
    src: src.replace(/&amp;/g, "&"),
    width: num("width", 335),
    height: num("height", 450),
  };
}

/** The preview of one of the post's ads (an active one first). */
export async function adPreview(
  env: Env,
  db: D1Database,
  postId: string,
  format: PreviewFormat,
  fetcher?: typeof fetch,
): Promise<AdPreview | { error: string; status: 404 | 409 | 502 }> {
  const ad = await db
    .prepare(
      "SELECT id FROM ads WHERE post_id = ?1 ORDER BY status = 'ACTIVE' DESC, created_time, id LIMIT 1",
    )
    .bind(postId)
    .first<{ id: string }>();
  if (!ad) return { error: "No ad found for this post.", status: 404 };
  const token = await getToken(env, db);
  if (!token)
    return { error: "Connect Meta in Settings to play ads.", status: 409 };
  try {
    const res = await clientFor(env, token, fetcher).get<{
      data?: { body?: string }[];
    }>(`${ad.id}/previews`, { ad_format: format });
    const frame = parsePreviewIframe(res.data?.[0]?.body ?? "");
    if (!frame)
      return { error: "Meta returned no preview for this ad.", status: 502 };
    return { adId: ad.id, format, ...frame };
  } catch (e) {
    return {
      error:
        e instanceof GraphError || e instanceof Error ? e.message : String(e),
      status: 502,
    };
  }
}
