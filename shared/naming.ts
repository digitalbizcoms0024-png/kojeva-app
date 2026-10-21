// Ad-name parsing and generation. See docs/NAMING.md for the convention and
// for how each legacy pattern is interpreted.
import {
  ANGLES,
  CAMPAIGN_HINTS,
  FORMATS,
  HOOKS,
  LANDING_PAGES,
  PODS,
  podByCode,
  type PodCode,
} from "./taxonomy.ts";

export type Convention = "standard" | "legacy" | "unparsed";

export interface ParsedName {
  raw: string;
  convention: Convention;
  podCode: PodCode | null;
  /** Team prefix found on legacy names, e.g. "HxM". Mapped to a pod via settings. */
  legacyPrefix: string | null;
  /** Normalised creative identifier, e.g. "V153", "B15", "HxM-120". */
  creativeId: string | null;
  iteration: number | null;
  angle: string | null;
  format: string | null;
  hook: string | null;
  landingPage: string | null;
  campaignHint: (typeof CAMPAIGN_HINTS)[number] | null;
  isCopy: boolean;
  /** Pod whose strategist is named in the ad name, e.g. "…VSL_HARRIS-h2". */
  strategistHint: PodCode | null;
  /** Free text left over after known tokens were removed. */
  title: string | null;
}

const COPY_SUFFIX = /\s*-\s*Copy(?:\s+\d+)?\s*$/i;
const COPY_PREFIX = /^Copy of\s+/i;
// Marks ads launched from an existing post; carries no creative information.
const POST_ID_SUFFIX = /\s*\|\s*Post ID\s*$/i;
const STANDARD = /^(HAR|DHI|SHA|ALI)-([A-Z]?\d+)(?:-i(\d+))?((?:\s*\|\s*[^|]*)*)$/i;
const EMPTY = "-";

function empty(raw: string): ParsedName {
  return {
    raw,
    convention: "unparsed",
    podCode: null,
    legacyPrefix: null,
    creativeId: null,
    iteration: null,
    angle: null,
    format: null,
    hook: null,
    landingPage: null,
    campaignHint: null,
    isCopy: false,
    strategistHint: null,
    title: null,
  };
}

function lookup(vocab: Record<string, string>, token: string): string | null {
  const key = Object.keys(vocab).find((k) => k.toLowerCase() === token.toLowerCase());
  return key ?? null;
}

/** Records known vocabulary tokens found in text; returns the unrecognised remainder. */
function absorbTokens(text: string, out: ParsedName): string {
  const leftover: string[] = [];
  for (const token of text.split(/[\s_|-]+/).filter(Boolean)) {
    const hint = CAMPAIGN_HINTS.find((h) => h === token.toUpperCase());
    const strategist = PODS.find((p) => p.name.toUpperCase() === token.toUpperCase());
    let key: string | null;
    if (strategist && !out.strategistHint) out.strategistHint = strategist.code;
    else if (hint && !out.campaignHint) out.campaignHint = hint;
    else if (!out.landingPage && (key = lookup(LANDING_PAGES, token))) out.landingPage = key;
    else if (!out.format && (key = lookup(FORMATS, token))) out.format = key;
    else if (!out.hook && (key = lookup(HOOKS, token))) out.hook = key;
    else if (!out.angle && (key = lookup(ANGLES, token))) out.angle = key;
    else leftover.push(token);
  }
  return leftover.join(" ").replace(/^[-\s]+|[-\s]+$/g, "");
}

export function parseAdName(raw: string): ParsedName {
  const out = empty(raw);
  let name = raw.trim();
  for (let changed = true; changed; ) {
    changed = false;
    for (const re of [COPY_SUFFIX, COPY_PREFIX, POST_ID_SUFFIX]) {
      if (re.test(name)) {
        if (re !== POST_ID_SUFFIX) out.isCopy = true;
        name = name.replace(re, "").trim();
        changed = true;
      }
    }
  }

  const std = STANDARD.exec(name);
  if (std) {
    const [, pod, id, iter, rest] = std;
    out.convention = "standard";
    out.podCode = podByCode(pod!)!.code;
    out.creativeId = id!.toUpperCase();
    out.iteration = iter ? Number(iter) : null;
    const segs = (rest ?? "")
      .split("|")
      .slice(1)
      .map((s) => s.trim());
    const field = (i: number) => (segs[i] && segs[i] !== EMPTY ? segs[i]! : null);
    out.angle = field(0);
    out.format = field(1);
    out.hook = field(2);
    out.landingPage = field(3);
    const extra = segs.slice(4).filter((s) => s && s !== EMPTY);
    if (extra.length) absorbTokens(extra.join(" "), out);
    return out;
  }

  let m: RegExpExecArray | null;
  let rest = "";
  if ((m = /^(?:video|v)\s*(\d+)\b(.*)$/i.exec(name))) {
    out.creativeId = `V${m[1]}`;
    rest = m[2]!;
  } else if ((m = /^batch\s*(\d+)(?:-(\d+))?\b(.*)$/i.exec(name))) {
    out.creativeId = `B${m[1]}`;
    out.iteration = m[2] ? Number(m[2]) : null;
    rest = m[3]!;
  } else if ((m = /^(\d+)v(\d+)\b(.*)$/i.exec(name))) {
    out.creativeId = m[1]!;
    out.iteration = Number(m[2]);
    rest = m[3]!;
  } else if ((m = /^(\d+)-(\d+)\b(.*)$/.exec(name))) {
    out.creativeId = m[1]!;
    out.iteration = Number(m[2]);
    rest = m[3]!;
  } else if ((m = /^([A-Za-z]{2,8})[-\s]?(\d+)(?:\.(\d+))?(?=[-\s_|]|$)(.*)$/.exec(name))) {
    out.legacyPrefix = m[1]!;
    out.creativeId = `${m[1]}-${m[2]}`;
    out.iteration = m[3] ? Number(m[3]) : null;
    rest = m[4]!;
  } else {
    // No recognisable ID, but tags and a strategist name may still be in there.
    absorbTokens(name, out);
    out.title = name || null;
    return out;
  }

  out.convention = "legacy";
  const text = rest.replace(/^[\s\-|]+|[\s\-|]+$/g, "");
  // Keep the original wording as the title unless it was nothing but tags.
  out.title = absorbTokens(text, out) ? text : null;
  return out;
}

export interface NameFields {
  podCode: PodCode;
  creativeId: string;
  iteration?: number | null;
  angle?: string | null;
  format?: string | null;
  hook?: string | null;
  landingPage?: string | null;
}

export function validateNameFields(f: NameFields): string[] {
  const errors: string[] = [];
  if (!/^[A-Z]?\d+$/i.test(f.creativeId)) errors.push("Creative ID must look like V612 or 612.");
  if (f.iteration != null && (!Number.isInteger(f.iteration) || f.iteration < 1))
    errors.push("Iteration must be a whole number of 1 or more.");
  for (const [k, v] of Object.entries(f)) {
    if (typeof v === "string" && v.includes("|")) errors.push(`${k} cannot contain "|".`);
  }
  return errors;
}

/** Builds a standard name, e.g. "HAR-V612-i2 | Depuff | UGC | Story | PDP". */
export function buildAdName(f: NameFields): string {
  const head = `${f.podCode}-${f.creativeId.toUpperCase()}${f.iteration ? `-i${f.iteration}` : ""}`;
  const segs = [f.angle, f.format, f.hook, f.landingPage].map((s) => s?.trim() || EMPTY);
  return [head, ...segs].join(" | ");
}

/** Suggests a pod for a parsed name. Standard names are authoritative; legacy
 *  prefixes are only mapped when the team has configured that prefix. */
export function suggestPodCode(
  parsed: ParsedName,
  legacyPrefixMap: Record<string, PodCode>,
): { podCode: PodCode; reason: string } | null {
  if (parsed.podCode) return { podCode: parsed.podCode, reason: "from ad name" };
  if (parsed.strategistHint)
    return { podCode: parsed.strategistHint, reason: `${podByCode(parsed.strategistHint)!.name} named in ad name` };
  if (parsed.legacyPrefix) {
    const key = Object.keys(legacyPrefixMap).find(
      (k) => k.toLowerCase() === parsed.legacyPrefix!.toLowerCase(),
    );
    if (key) return { podCode: legacyPrefixMap[key]!, reason: `from ${parsed.legacyPrefix} prefix` };
  }
  return null;
}
