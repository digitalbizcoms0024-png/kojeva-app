// Concepts: what hit rate is measured on. One testing ad set = one concept, except
// older ad sets that combined several ("IH | Dhia | STATIC | Batch 3 & 5"), which are
// split by matching each ad's name to a part. See docs/METRICS.md → Hit rate.
import { DEFAULT_ATTRIBUTION, isAgencyAdSet, podFromAdSetName, type AttributionSettings } from "./attribution.ts";
import { AGENCY, type PodCode } from "./taxonomy.ts";

export interface ConceptAd {
  id: string;
  name: string;
  adsetId: string | null;
  adsetName: string | null;
}

export interface Concept {
  id: string;
  adsetId: string;
  adsetName: string;
  label: string;
  podCode: PodCode;
  adIds: string[];
}

const SEP = /\s*(?:&|\+)\s*/;

/** The ad set name minus team prefix and strategist: "IH | Harris | KOJEVA 3 | STATIC | Scarcity" → "KOJEVA 3 | STATIC | Scarcity". */
export function conceptLabel(adsetName: string): string {
  const segs = adsetName.split("|").map((s) => s.trim()).filter(Boolean);
  let i = 0;
  if (segs[i] && /^[A-Z]{2}$/i.test(segs[i]!)) i++; // IH / ME / QW / TV / YD
  if (segs[i] && podFromAdSetName(segs[i]!)) i++;
  return segs.slice(i).join(" | ") || adsetName.trim();
}

/** "Batch 3 & 5" → ["Batch 3", "Batch 5"]; "Depuffing + Jawline" → ["Depuffing", "Jawline"]. */
export function splitParts(segment: string): string[] {
  const raw = segment.split(SEP).map((s) => s.trim()).filter(Boolean);
  if (raw.length < 2) return [segment.trim()];
  const prefix = /^(.*?\D)\s*#?\s*\d+$/.exec(raw[0]!)?.[1]?.trim();
  return raw.map((p, i) => (i > 0 && prefix && /^#?\d+$/.test(p) ? `${prefix} ${p.replace("#", "")}` : p));
}

const norm = (s: string) => s.toLowerCase().replace(/[_|]+/g, " ").replace(/\s+/g, " ").trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matchesPart(part: string, text: string): boolean {
  const t = norm(text);
  const num = /^(.*?)\s*#?\s*(\d+)$/.exec(part);
  if (num) {
    const word = num[1]!.trim().toLowerCase();
    // "batch 3b", "batch5", "batch 6 | 1" all belong to Batch 3 / 5 / 6.
    if (word && new RegExp(`${escape(word)}\\s*#?\\s*0*${num[2]}(?!\\d)`).test(t)) return true;
    return !word && new RegExp(`(?<!\\d)${num[2]}(?!\\d)`).test(t);
  }
  return new RegExp(`(?<![a-z])${escape(norm(part))}(?![a-z])`).test(t);
}

/** Splits "ST _ Depuffing _ Bye Puffy Jawline _ V1" into its concept segment and the rest. */
function describe(adName: string): { segment: string | null; text: string } {
  const m = /^ST\s*_\s*([^_]+?)\s*_\s*(.*)$/i.exec(adName);
  return m ? { segment: m[1]!, text: m[2]! } : { segment: null, text: adName };
}

/** Index of the part an ad belongs to, or null if its name doesn't say. */
export function partFor(adName: string, parts: string[]): number | null {
  return matchPart(adName, parts).index;
}

function matchPart(adName: string, parts: string[]): { index: number | null; direct: boolean } {
  const { segment, text } = describe(adName);
  const inText = parts.map((p, i) => (matchesPart(p, text) ? i : -1)).filter((i) => i >= 0);
  if (inText.length === 1) return { index: inText[0]!, direct: true };
  if (segment) {
    const bySeg = parts.map((p, i) => (norm(p) === norm(segment) ? i : -1)).filter((i) => i >= 0);
    if (bySeg.length === 1) return { index: bySeg[0]!, direct: true };
  }
  return { index: inText[0] ?? null, direct: false };
}

function testingPod(adsetName: string, settings: AttributionSettings): PodCode | null {
  return podFromAdSetName(adsetName) ?? (isAgencyAdSet(adsetName, settings.agencyPrefixes) ? AGENCY.code : null);
}

/** Concepts from every testing ad set (in-house strategist or agency). Scaling ad sets aren't concepts. */
export function buildConcepts(ads: ConceptAd[], settings: AttributionSettings = DEFAULT_ATTRIBUTION): Concept[] {
  const byAdset = new Map<string, ConceptAd[]>();
  for (const ad of ads) {
    if (!ad.adsetId || !ad.adsetName || !testingPod(ad.adsetName, settings)) continue;
    byAdset.set(ad.adsetId, [...(byAdset.get(ad.adsetId) ?? []), ad]);
  }

  const out: Concept[] = [];
  for (const [adsetId, list] of byAdset) {
    const adsetName = list[0]!.adsetName!;
    const podCode = testingPod(adsetName, settings)!;
    const label = conceptLabel(adsetName);
    const segs = label.split("|").map((s) => s.trim());
    const combinedAt = segs.findIndex((s) => SEP.test(s) && splitParts(s).length > 1);
    if (combinedAt < 0) {
      out.push({ id: adsetId, adsetId, adsetName, label, podCode, adIds: list.map((a) => a.id) });
      continue;
    }

    const parts = splitParts(segs[combinedAt]!);
    const buckets = parts.map(() => [] as string[]);
    const direct = new Set<number>();
    const unmatched: string[] = [];
    for (const ad of list) {
      const m = matchPart(ad.name, parts);
      if (m.index == null) unmatched.push(ad.id);
      else buckets[m.index]!.push(ad.id);
      if (m.direct && m.index != null) direct.add(m.index);
    }
    // Split only numbered batches ("Batch 3 & 5"), or when ad names clearly name two parts.
    // "AI Voiceover + Brolls" is one concept whose name happens to contain a "+".
    const numbered = parts.every((p) => /\d+$/.test(p));
    if (!(numbered && direct.size >= 1) && direct.size < 2) {
      out.push({ id: adsetId, adsetId, adsetName, label, podCode, adIds: list.map((a) => a.id) });
      continue;
    }
    // One part with no ads left and ads nobody claimed: they're that part's ("Did you know" → Batch 9).
    const empty = buckets.map((b, i) => (b.length ? -1 : i)).filter((i) => i >= 0);
    if (unmatched.length && empty.length === 1) buckets[empty[0]!]!.push(...unmatched.splice(0));

    const partLabel = (p: string) => segs.map((s, i) => (i === combinedAt ? p : s)).join(" | ");
    parts.forEach((p, i) => {
      if (buckets[i]!.length) out.push({ id: `${adsetId}#${i}`, adsetId, adsetName, label: partLabel(p), podCode, adIds: buckets[i]! });
    });
    if (unmatched.length)
      out.push({ id: `${adsetId}#rest`, adsetId, adsetName, label: `${label} (unsplit)`, podCode, adIds: unmatched });
  }
  return out;
}
