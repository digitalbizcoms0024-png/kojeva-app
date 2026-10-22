// Pure mapping from Graph API objects to our rows. See docs/METRICS.md.

export interface GraphAd {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  created_time?: string;
  adset?: { id: string; name?: string };
  campaign?: { id: string; name?: string };
  creative?: {
    id: string;
    effective_object_story_id?: string;
    thumbnail_url?: string;
    image_url?: string;
    object_type?: string;
    video_id?: string;
    image_hash?: string;
    /** Ads with an image per placement (Feed vs Stories/Reels) list them here, with rules saying which goes where. */
    asset_feed_spec?: {
      images?: { hash: string; adlabels?: { name?: string; id?: string }[] }[];
      asset_customization_rules?: {
        customization_spec?: { publisher_platforms?: string[]; facebook_positions?: string[]; instagram_positions?: string[] };
        image_label?: { name?: string; id?: string };
        priority?: number;
      }[];
    };
  };
}

interface GraphAction {
  action_type: string;
  value: string;
  /** Per-window values when action_attribution_windows is requested, e.g. "7d_click", "incrementality". */
  [window: string]: string | undefined;
}

export interface GraphInsight {
  ad_id: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  inline_link_clicks?: string;
  actions?: GraphAction[];
  action_values?: GraphAction[];
}

/**
 * Purchase action types in order of preference. "omni_purchase" is what Ads Manager's
 * Purchases column shows; the others cover accounts where it isn't reported.
 */
export const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"] as const;

export function pickAction(list: GraphAction[] | undefined): number {
  for (const type of PURCHASE_TYPES) {
    const hit = list?.find((a) => a.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

const cents = (v: string | undefined) => Math.round((Number(v) || 0) * 100);

export interface DailyRow {
  adId: string;
  date: string;
  spendCents: number;
  impressions: number;
  /** People reached that day; null when Meta didn't report it. */
  reach: number | null;
  linkClicks: number;
  purchases: number;
  revenueCents: number;
}

export function insightToDaily(r: GraphInsight): DailyRow {
  return {
    adId: r.ad_id,
    date: r.date_start,
    spendCents: cents(r.spend),
    impressions: Number(r.impressions) || 0,
    reach: r.reach == null || r.reach === "" ? null : Number(r.reach) || 0,
    linkClicks: Number(r.inline_link_clicks) || 0,
    purchases: Math.round(pickAction(r.actions)),
    revenueCents: Math.round(pickAction(r.action_values) * 100),
  };
}

/**
 * Copies of an ad share a post. Ads without one (e.g. some dynamic creatives) fall
 * back to their creative, then to themselves, so they still rank as one entry.
 */
export function postIdFor(ad: Pick<GraphAd, "id" | "creative">): string {
  if (ad.creative?.effective_object_story_id) return ad.creative.effective_object_story_id;
  if (ad.creative?.id) return `creative:${ad.creative.id}`;
  return `ad:${ad.id}`;
}

export function mediaTypeFor(ad: Pick<GraphAd, "creative">): string {
  const t = ad.creative?.object_type?.toUpperCase();
  if (t === "VIDEO") return "video";
  if (t === "PHOTO" || (t !== "VIDEO" && ad.creative?.image_url)) return "image";
  return "video";
}

/** The creative asset Atria tags: "v:<video id>" or "i:<image hash>". */
export function assetIdFor(ad: Pick<GraphAd, "creative">): string | null {
  if (ad.creative?.video_id) return `v:${ad.creative.video_id}`;
  if (ad.creative?.image_hash) return `i:${ad.creative.image_hash}`;
  return null;
}

/**
 * Meta hides a creative's media when the token can't see the Page post it promotes (object_type
 * PRIVACY_CHECK_FAIL, e.g. "Post ID" ads with ads_read only); its thumbnail is then the Page's logo.
 */
export function mediaHidden(ad: Pick<GraphAd, "creative">): boolean {
  return ad.creative?.object_type?.toUpperCase() === "PRIVACY_CHECK_FAIL";
}

/** Full-size image for image ads, else Meta's 64px creative thumbnail; null when it would be the Page logo. */
export function thumbnailFor(ad: Pick<GraphAd, "creative">): string | null {
  if (mediaHidden(ad)) return null;
  return ad.creative?.image_url ?? ad.creative?.thumbnail_url ?? null;
}

/**
 * For an ad with several images (one per placement), the hash of the one shown in the Facebook feed:
 * the image its customization rules give to facebook_positions "feed" (else Instagram "stream").
 * Null when the ad has fewer than two images or no rule says; the caller then goes by shape.
 */
export function feedImageHash(ad: Pick<GraphAd, "creative">): string | null {
  const spec = ad.creative?.asset_feed_spec;
  const images = spec?.images ?? [];
  if (images.length < 2) return null;
  const rules = [...(spec?.asset_customization_rules ?? [])].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const labelFor = (test: (s: NonNullable<(typeof rules)[number]["customization_spec"]>) => boolean) =>
    rules.find((r) => r.customization_spec && test(r.customization_spec))?.image_label;
  const label = labelFor((s) => s.facebook_positions?.includes("feed") ?? false) ?? labelFor((s) => s.instagram_positions?.includes("stream") ?? false);
  if (!label) return null;
  const match = images.find((i) => i.adlabels?.some((l) => (label.id && l.id === label.id) || (label.name && l.name === label.name)));
  return match?.hash ?? null;
}

/** The image best suited to the feed by shape: closest to 4:5 (height ÷ width 1.25), never a 9:16 one if another exists. */
export function feedShaped(images: { hash: string; url: string; width?: number; height?: number }[]): { hash: string; url: string } | null {
  const ratio = (i: (typeof images)[number]) => (i.width && i.height ? i.height / i.width : 1.25);
  return [...images].sort((a, b) => Math.abs(ratio(a) - 1.25) - Math.abs(ratio(b) - 1.25))[0] ?? null;
}

/** Meta's creative thumbnails are 64×64 ("p64x64" in the URL): fine as a fallback, blurry on a card. */
export function isTinyThumbnail(url: string | null): boolean {
  return url != null && /[_.-][ps]64x64/.test(url);
}

/** The best cover among a video's frames: the preferred one, else the widest. */
export function pickVideoCover(frames: { uri: string; is_preferred?: boolean; width?: number }[] | undefined): string | null {
  if (!frames?.length) return null;
  return (frames.find((f) => f.is_preferred) ?? [...frames].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]!).uri;
}

/** "2026-10-08T14:03:11-0400" → "2026-10-08T18:03:11.000Z" (sortable). */
export function isoTime(t: string | undefined): string | null {
  if (!t) return null;
  const d = new Date(t.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The windows requested in the attribution comparison pull. */
export const COMPARE_WINDOWS = ["7d_click", "incrementality"] as const;

/** First purchase action type present, read under one attribution window; null if Meta didn't report that window. */
export function pickWindow(list: GraphAction[] | undefined, window: string): number | null {
  for (const type of PURCHASE_TYPES) {
    const hit = list?.find((a) => a.action_type === type);
    if (hit) return hit[window] == null ? null : Number(hit[window]) || 0;
  }
  return list ? 0 : null;
}

export interface WindowRow {
  adId: string;
  date: string;
  purchases7dc: number | null;
  revenue7dcCents: number | null;
  purchasesIncMilli: number | null;
  revenueIncCents: number | null;
}

export function insightToWindows(r: GraphInsight): WindowRow {
  const p7 = pickWindow(r.actions, "7d_click");
  const v7 = pickWindow(r.action_values, "7d_click");
  const pi = pickWindow(r.actions, "incrementality");
  const vi = pickWindow(r.action_values, "incrementality");
  return {
    adId: r.ad_id,
    date: r.date_start,
    purchases7dc: p7 == null ? null : Math.round(p7),
    revenue7dcCents: v7 == null ? null : Math.round(v7 * 100),
    purchasesIncMilli: pi == null ? null : Math.round(pi * 1000),
    revenueIncCents: vi == null ? null : Math.round(vi * 100),
  };
}
