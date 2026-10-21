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
      // Page-owned videos can be hidden from an ads_read token; the ad account's video library
      // often still has them. Neither is an error for this route.
      const direct = await gc.get<{ source?: string; length?: number }>(videoId, { fields: "source,length" }).catch((e: Error) => {
        videoError = e.message;
        return null;
      });
      let v = direct?.source ? direct : null;
      if (!v) {
        const lib = await gc
          .get<{ data?: { id: string; source?: string; length?: number }[] }>(`${env.META_AD_ACCOUNT_ID}/advideos`, {
            fields: "source,length",
            filtering: JSON.stringify([{ field: "id", operator: "IN", value: [videoId] }]),
          })
          .catch((e: Error) => {
            videoError = `${videoError ?? ""} | library: ${e.message}`;
            return null;
          });
        v = lib?.data?.find((x) => x.id === videoId && x.source) ?? null;
      }
      videoUrl = v?.source ?? null;
      videoSeconds = v?.length ?? null;
      if (videoUrl) videoError = null;
      else videoError ??= "Meta returned no video file.";
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
