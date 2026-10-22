// Decides which pod (or the agency) a post belongs to.
// See docs/NAMING.md → "How a post gets its pod".
import { parseAdName, suggestPodCode } from "./naming.ts";
import { AGENCY, allPods, type PodCode } from "./taxonomy.ts";

export type PodSource = "manual" | "name" | "adset" | "era";

export interface AttributionAd {
  name: string;
  adsetName: string | null;
  createdTime: string | null;
}

export interface AttributionSettings {
  /** First segment of agency ad set names, e.g. "ME" in "ME | R2-S12 | Statics". */
  agencyPrefixes: string[];
  /** When the pods started. Untraceable posts created earlier are the agency's. */
  podsStartDate: string | null;
}

export const DEFAULT_ATTRIBUTION: AttributionSettings = {
  agencyPrefixes: ["ME", "QW", "TV", "YD"],
  podsStartDate: null,
};

/**
 * Pod named in an ad set: a built-in strategist as a separate word ("IH | Harris | KOJEVA 3" → HAR),
 * or an added pod's prefix as one of the "|" parts ("TRYBE | Larissa V | Jawline Angle" → Trybe).
 * A part matches its prefix ignoring case, spaces and punctuation ("Pod 0" → POD0), or by its first
 * word ("Caicos Pod" → CAICOS).
 */
export function podFromAdSetName(adsetName: string | null): PodCode | null {
  if (!adsetName) return null;
  const words = new Set(adsetName.toUpperCase().split(/[^A-Z]+/).filter(Boolean));
  const parts = new Set(
    adsetName
      .split("|")
      .flatMap((s) => {
        const up = s.trim().toUpperCase();
        return [up.replace(/[^A-Z0-9]/g, ""), up.split(/[^A-Z0-9]+/).filter(Boolean)[0] ?? ""];
      })
      .filter(Boolean),
  );
  const found = allPods().filter((p) => (p.prefix ? parts.has(p.prefix.toUpperCase()) : words.has(p.name.toUpperCase())));
  // Two strategists in one ad set name is ambiguous; leave it for a human.
  return found.length === 1 ? found[0]!.code : null;
}

/** "QW  | 12 ROUND 3 | …" → true when "QW" is an agency prefix. */
export function isAgencyAdSet(adsetName: string | null, prefixes: string[]): boolean {
  const first = adsetName?.split("|")[0]?.trim().toUpperCase();
  return Boolean(first && prefixes.some((p) => p.toUpperCase() === first));
}

/** The earliest ad in an ad set that names a strategist: when the pods started. */
export function detectPodsStart(ads: AttributionAd[]): string | null {
  let first: string | null = null;
  for (const a of ads)
    if (a.createdTime && podFromAdSetName(a.adsetName) && (!first || a.createdTime < first)) first = a.createdTime;
  return first;
}

/**
 * Pod for a post from its ads (all copies). First match wins:
 * pod code in a standard ad name → strategist in an ad set → agency ad set prefix →
 * strategist in the ad name → configured legacy prefix → created before pods started (agency).
 * Ad sets are checked earliest ad first, so a winner copied into an unnamed Scale ad set
 * keeps the pod that made it.
 */
export function attributePod(
  ads: AttributionAd[],
  legacyPrefixMap: Record<string, PodCode> = {},
  settings: AttributionSettings = DEFAULT_ATTRIBUTION,
): { podCode: PodCode; source: Exclude<PodSource, "manual">; reason: string } | null {
  const ordered = [...ads].sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? ""));
  const origin = ordered[0];
  if (!origin) return null;

  const parsed = parseAdName(origin.name);
  if (parsed.podCode) return { podCode: parsed.podCode, source: "name", reason: "pod code in ad name" };

  for (const ad of ordered) {
    const code = podFromAdSetName(ad.adsetName);
    if (code) return { podCode: code, source: "adset", reason: `ad set "${ad.adsetName}"` };
  }
  for (const ad of ordered) {
    if (isAgencyAdSet(ad.adsetName, settings.agencyPrefixes))
      return { podCode: AGENCY.code, source: "adset", reason: `agency ad set "${ad.adsetName}"` };
  }

  const fromName = suggestPodCode(parsed, legacyPrefixMap);
  if (fromName) return { podCode: fromName.podCode, source: "name", reason: fromName.reason };

  if (settings.podsStartDate && origin.createdTime && origin.createdTime < settings.podsStartDate)
    return { podCode: AGENCY.code, source: "era", reason: "launched before the pods started" };
  return null;
}
