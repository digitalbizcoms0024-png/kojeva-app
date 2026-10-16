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
  };
}

interface GraphAction {
  action_type: string;
  value: string;
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

export function thumbnailFor(ad: Pick<GraphAd, "creative">): string | null {
  return ad.creative?.image_url ?? ad.creative?.thumbnail_url ?? null;
}

/** "2026-10-08T14:03:11-0400" → "2026-10-08T18:03:11.000Z" (sortable). */
export function isoTime(t: string | undefined): string | null {
  if (!t) return null;
  const d = new Date(t.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
