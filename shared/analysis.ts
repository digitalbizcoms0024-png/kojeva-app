// Gemini creative analysis (owner, Nov 9): Gemini watches the video (or looks at the static) with its
// copy and returns tags from fixed lists plus a readout. Runs alongside Atria's tags and fills what
// Atria lacks. See docs/ATRIA.md → Gemini.

/** Tags with a fixed list of answers, so they group and compare (the categories in the owner's screenshots). */
export const TAG_OPTIONS = {
  assetType: ["UGC", "Static Image", "Animation", "Studio Video", "Podcast / Interview", "Screen Recording", "AI Generated", "Other"],
  visualFormat: ["Product Demo", "Talking Head", "Voiceover + B-roll", "Before / After", "Split Screen", "Skit / Drama", "Testimonial", "Listicle", "Text Only", "Static Image", "Animation", "Other"],
  adAngle: ["Problem/Solution", "Benefit-Led", "Comparison", "Social Proof", "Authority", "Transformation", "Scarcity / Urgency", "Curiosity", "Value / Price", "Other"],
  hookTactic: ["Relatable Scenario", "Problem Callout", "Bold Claim", "Question", "Curiosity Gap", "Pattern Interrupt", "Social Proof", "Before / After", "Demonstration", "Story Opener", "Offer / Deal", "Authority / Expert", "Other"],
  offer: ["No Offer", "Percent Off", "Dollar Off", "Free Shipping", "Bundle / BOGO", "Free Gift", "Guarantee / Risk-Free", "Limited-Time Sale", "Other"],
  funnelStage: ["TOF", "MOF", "BOF"],
  headlineTactic: ["Offer", "Benefit", "Urgency / Scarcity", "Social Proof", "Question", "Curiosity", "Problem", "Comparison", "None", "Other"],
  textHook: ["Benefit Statement", "Problem Statement", "Question", "Claim / Statistic", "Testimonial Quote", "Offer", "Curiosity", "None", "Other"],
  visualHook: ["Product Demonstration", "Before / After", "Face Close-up", "Text on Screen", "Unusual Visual", "Lifestyle Scene", "Product Shot", "Reaction", "Other"],
  theme: ["Problem/Solution", "Testimonial / Review", "Comparison", "Education", "Lifestyle", "Unboxing", "Founder Story", "Promotion / Sale", "Humor", "Drama / Story", "Other"],
  seasonality: ["Evergreen", "Black Friday / Cyber Monday", "Holiday", "New Year", "Valentine's", "Mother's Day", "Summer", "Other Seasonal"],
  emotion: ["Hope", "Curiosity", "Frustration", "Fear", "Insecurity", "Confidence", "Relief", "Joy", "Surprise", "Urgency", "Trust", "Other"],
  awarenessLevel: ["Unaware", "Problem Aware", "Solution Aware", "Product Aware", "Most Aware"],
} as const;

/** Tags Gemini words itself (a short phrase). */
export const FREE_TAGS = ["persona", "usp", "desire"] as const;

export type FixedTag = keyof typeof TAG_OPTIONS;
export type FreeTag = (typeof FREE_TAGS)[number];
export type TagKey = FixedTag | FreeTag;
export type CreativeTags = Partial<Record<TagKey, string>>;

/** Display order and labels (as in the owner's screenshots). */
export const TAG_LABELS: [TagKey, string][] = [
  ["assetType", "Asset type"],
  ["visualFormat", "Visual format"],
  ["adAngle", "Messaging angle"],
  ["hookTactic", "Hook tactic"],
  ["offer", "Offer type"],
  ["funnelStage", "Funnel stage"],
  ["headlineTactic", "Headline tactic"],
  ["textHook", "Text hook"],
  ["visualHook", "Visual hook"],
  ["theme", "Theme"],
  ["seasonality", "Seasonality"],
  ["persona", "Persona"],
  ["usp", "USP"],
  ["desire", "Desire"],
  ["emotion", "Emotion"],
  ["awarenessLevel", "Awareness level"],
];

export interface CreativeReadout {
  summary: string;
  hook: string;
  primaryMessage: string;
  /** Why it fits its awareness level ("Written for someone problem aware"). */
  awarenessNote: string;
  /** What Gemini saw, a few lines. */
  observations: string[];
  /** Spoken or on-screen words that prove the claims. */
  proof: string;
  ideas: string[];
  transcript: string;
}

export type AnalysisStatus = "analyzed" | "failed" | "no_media";

/** One creative's analysis, shared by every copy of it (keyed by asset). */
export interface CreativeAnalysis {
  assetId: string;
  status: AnalysisStatus;
  /** "video" (Gemini watched it) or "image". */
  media: "video" | "image" | null;
  model: string | null;
  /** Gemini's tags with hand edits applied (an edit always wins). */
  tags: CreativeTags;
  /** Which tags were set by hand. */
  manual: TagKey[];
  readout: CreativeReadout | null;
  error: string | null;
  analyzedAt: string | null;
}

/** Keeps a fixed tag to its list ("Other" for anything else) and trims free tags; drops empty ones. */
export function cleanTags(raw: Record<string, unknown>): CreativeTags {
  const out: CreativeTags = {};
  for (const [key, options] of Object.entries(TAG_OPTIONS) as [FixedTag, readonly string[]][]) {
    const v = typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
    if (!v) continue;
    out[key] = options.find((o) => o.toLowerCase() === v.toLowerCase()) ?? (options.includes("Other") ? "Other" : undefined);
    if (!out[key]) delete out[key];
  }
  for (const key of FREE_TAGS) {
    const v = typeof raw[key] === "string" ? (raw[key] as string).trim().slice(0, 120) : "";
    if (v) out[key] = v;
  }
  return out;
}
