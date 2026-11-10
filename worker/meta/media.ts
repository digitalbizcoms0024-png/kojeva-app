// What an ad shows, for the nightly Claude task that labels creatives: its copy and a link to its
// video or image, read through the hub's own Meta connection (read-only, ads_read). This replaces
// fetching each ad from Atria, which costs Atria credits.
import type { Env } from "../env.ts";
import { GraphError } from "./graph.ts";
import { clientFor, getToken } from "./sync.ts";

export interface AdMedia {
  adId: string;
  /** Primary text and headline, when the creative carries them. */
  body: string | null;
  title: string | null;
  /** A downloadable video file (expires within hours), or null when Meta hides it from the token. */
  videoUrl: string | null;
  videoSeconds: number | null;
  /** Why there's no video link, when Meta refused it. */
  videoError: string | null;
  /** The full image for image ads, else Meta's thumbnail (a frame of the video, or the post's picture). */
  imageUrl: string | null;
}

type Creative = {
  body?: string;
  title?: string;
  image_url?: string;
  thumbnail_url?: string;
  video_id?: string;
  object_story_spec?: { video_data?: { message?: string; title?: string; video_id?: string; image_url?: string }; link_data?: { message?: string; name?: string; picture?: string } };
  asset_feed_spec?: { bodies?: { text?: string }[]; titles?: { text?: string }[]; videos?: { video_id?: string }[]; images?: { url?: string }[] };
};

const CREATIVE_FIELDS = "body,title,image_url,thumbnail_url,video_id,object_story_spec,asset_feed_spec";

/** The Page id in a post id ("776862388850901_122147…" → "776862388850901"), or null. */
export function pageOfPost(postId: string | null | undefined): string | null {
  const m = /^(\d+)_\d+$/.exec(postId ?? "");
  return m ? m[1]! : null;
}

/**
 * A downloadable link to a video (expires within hours), trying in turn: the video itself, the ad
 * account's video library, and the Page's own access. Page-owned videos (ads run from Page posts)
 * only come through the last, which needs the login to grant pages_show_list and
 * pages_read_engagement (Settings → reconnect Meta; owner, Nov 10). All read-only.
 */
export async function videoSource(
  env: Env,
  token: string,
  videoId: string,
  pageId: string | null,
  fetcher?: typeof fetch,
): Promise<{ url: string | null; seconds: number | null; error: string | null }> {
  const gc = clientFor(env, token, fetcher);
  const errors: string[] = [];
  const direct = await gc.get<{ source?: string; length?: number }>(videoId, { fields: "source,length" }).catch((e: Error) => {
    errors.push(e.message);
    return null;
  });
  if (direct?.source) return { url: direct.source, seconds: direct.length ?? null, error: null };
  const lib = await gc
    .get<{ data?: { id: string; source?: string; length?: number }[] }>(`${env.META_AD_ACCOUNT_ID}/advideos`, {
      fields: "source,length",
      filtering: JSON.stringify([{ field: "id", operator: "IN", value: [videoId] }]),
    })
    .catch((e: Error) => {
      errors.push(`library: ${e.message}`);
      return null;
    });
  const inLib = lib?.data?.find((x) => x.id === videoId && x.source);
  if (inLib?.source) return { url: inLib.source, seconds: inLib.length ?? null, error: null };
  // The Page's token (from the login's Pages) can read the Page's own videos.
  const pages = await gc.get<{ data?: { id: string; access_token?: string }[] }>("me/accounts", { fields: "id,access_token", limit: "100" }).catch((e: Error) => {
    errors.push(`pages: ${e.message}`);
    return null;
  });
  const list = (pages?.data ?? []).filter((p) => p.access_token).sort((a, b) => Number(b.id === pageId) - Number(a.id === pageId));
  for (const p of list) {
    const v = await clientFor(env, p.access_token!, fetcher)
      .get<{ source?: string; length?: number }>(videoId, { fields: "source,length" })
      .catch(() => null);
    if (v?.source) return { url: v.source, seconds: v.length ?? null, error: null };
  }
  const hint = list.length
    ? "None of the login's Pages could read it."
    : "Reconnect Meta in Settings and allow Page access (pages_read_engagement) so the hub can read the Page's videos.";
  return { url: null, seconds: null, error: `Meta returned no video file. ${hint}${errors.length ? ` (${errors.join(" | ")})` : ""}` };
}

export async function adMedia(env: Env, db: D1Database, adId: string, fetcher?: typeof fetch): Promise<AdMedia | { error: string; status: 404 | 409 | 502 }> {
  const known = await db.prepare("SELECT id FROM ads WHERE id = ?1").bind(adId).first<{ id: string }>();
  if (!known) return { error: "No such ad in the hub.", status: 404 };
  const token = await getToken(env, db);
  if (!token) return { error: "Meta isn't connected.", status: 409 };
  const gc = clientFor(env, token, fetcher);
  try {
    const ad = await gc.get<{ creative?: Creative }>(adId, { fields: `creative{${CREATIVE_FIELDS}}` });
    const c = ad.creative ?? {};
    const spec = c.object_story_spec;
    const feed = c.asset_feed_spec;
    const videoId = c.video_id ?? spec?.video_data?.video_id ?? feed?.videos?.[0]?.video_id ?? null;
    let videoUrl: string | null = null;
    let videoSeconds: number | null = null;
    let videoError: string | null = null;
    if (videoId) {
      const post = await db.prepare("SELECT post_id FROM ads WHERE id = ?1").bind(adId).first<{ post_id: string }>();
      const v = await videoSource(env, token, videoId, pageOfPost(post?.post_id), fetcher);
      videoUrl = v.url;
      videoSeconds = v.seconds;
      videoError = v.error;
    }
    return {
      adId,
      body: c.body ?? spec?.video_data?.message ?? spec?.link_data?.message ?? feed?.bodies?.[0]?.text ?? null,
      title: c.title ?? spec?.video_data?.title ?? spec?.link_data?.name ?? feed?.titles?.[0]?.text ?? null,
      videoUrl,
      videoSeconds,
      videoError,
      // fbcdn links download directly; facebook.com/ads/image ones need a session, so they come last.
      imageUrl: [c.image_url, spec?.link_data?.picture, feed?.images?.[0]?.url, spec?.video_data?.image_url, c.thumbnail_url].filter((u): u is string => !!u).sort((a, b) => Number(!/fbcdn\.net/.test(a)) - Number(!/fbcdn\.net/.test(b)))[0] ?? null,
    };
  } catch (e) {
    return { error: e instanceof GraphError || e instanceof Error ? e.message : String(e), status: 502 };
  }
}
