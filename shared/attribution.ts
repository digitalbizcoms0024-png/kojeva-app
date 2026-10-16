// Decides which pod a post belongs to. See docs/NAMING.md → "How a post gets its pod".
import { parseAdName, suggestPodCode } from "./naming.ts";
import { PODS, type PodCode } from "./taxonomy.ts";

export type PodSource = "manual" | "name" | "adset";

export interface AttributionAd {
  name: string;
  adsetName: string | null;
  createdTime: string | null;
}

/** Strategist named in an ad set, as a separate word: "ABO | Harris | Oct" → HAR. */
export function podFromAdSetName(adsetName: string | null): PodCode | null {
  if (!adsetName) return null;
  const words = new Set(adsetName.toUpperCase().split(/[^A-Z]+/).filter(Boolean));
  const found = PODS.filter((p) => words.has(p.name.toUpperCase()));
  // Two strategists in one ad set name is ambiguous; leave it for a human.
  return found.length === 1 ? found[0]!.code : null;
}

/**
 * Pod for a post from its ads (all copies). The ad set of the earliest ad wins,
 * so a winner copied into an unnamed Scale ad set keeps the pod that made it.
 */
export function attributePod(
  ads: AttributionAd[],
  legacyPrefixMap: Record<string, PodCode> = {},
): { podCode: PodCode; source: Exclude<PodSource, "manual">; reason: string } | null {
  const ordered = [...ads].sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? ""));
  const origin = ordered[0];
  if (!origin) return null;

  const parsed = parseAdName(origin.name);
  if (parsed.podCode) return { podCode: parsed.podCode, source: "name", reason: "pod code in ad name" };

  // Prefer the original ad set; fall back to any copy's ad set if the original names nobody.
  for (const ad of ordered) {
    const code = podFromAdSetName(ad.adsetName);
    if (code) return { podCode: code, source: "adset", reason: `ad set "${ad.adsetName}"` };
  }

  const fromName = suggestPodCode(parsed, legacyPrefixMap);
  return fromName ? { podCode: fromName.podCode, source: "name", reason: fromName.reason } : null;
}
