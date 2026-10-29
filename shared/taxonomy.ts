// Controlled vocabularies for creative tags. Keys are what appears in ad names;
// values are display labels. Extend these as the team adds new angles/formats.

export interface Group {
  id: string;
  code: string;
  name: string;
  color: string;
  /** Added pods only: the ad set name part that credits them ("TRYBE" in "TRYBE | Larissa V | …"). */
  prefix?: string | null;
  /** Added pods only: which of POD_SLOTS gives their color. */
  slot?: number | null;
  /** Added pods only: false for partners (Trybe), who can share an ad set with an in-house pod. Built-in pods are in-house. */
  inhouse?: boolean;
}

/** The four in-house pods, matched by strategist name in ad set names. */
export const PODS: readonly Group[] = [
  { id: "harris", code: "HAR", name: "Harris", color: "#2a78d6" },
  { id: "dhia", code: "DHI", name: "Dhia", color: "#854494" },
  { id: "shameer", code: "SHA", name: "Shameer", color: "#25afd2" },
  { id: "ali", code: "ALI", name: "Ali", color: "#d6809c" },
];

/**
 * Colors for pods added in Settings, in order (light / dark). Validated with the dataviz palette
 * checker after the four built-in pods, both modes (Oct 2026). Never generated: when all are taken,
 * no more pods can be added.
 */
export const POD_SLOTS = [
  { light: "#6250d6", dark: "#9085e9" }, // violet
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eb6834", dark: "#d95926" }, // orange
] as const;

/** The agency that produced ads before the in-house pods started. Not a pod, but ranked beside them. */
export const AGENCY: Group = { id: "agency", code: "AGY", name: "Agency", color: "#7d7979" };

let added: Group[] = [];

/**
 * Everyone ads can be credited to: the built-in pods, pods added in Settings, then the agency.
 * Updated in place by setAddedPods (the Worker loads them per data version, the app from /api/meta).
 */
export const GROUPS: Group[] = [...PODS, AGENCY];

export function setAddedPods(list: Group[]) {
  added = [...list].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  GROUPS.splice(0, GROUPS.length, ...PODS, ...added, AGENCY);
}

/** Every pod (built-in and added), without the agency. */
export function allPods(): Group[] {
  return [...PODS, ...added];
}

/** Whether a post or concept counts for a pod: its pod, or a partner credited beside it (owner, Oct 29). */
export function creditsPod(x: { podId: string | null; coPodId?: string | null }, podId: string | null): boolean {
  return x.podId === podId || (podId != null && x.coPodId === podId);
}

export type PodCode = string;
export type PodId = string;

export function podByCode(code: string) {
  return GROUPS.find((p) => p.code === code.toUpperCase()) ?? null;
}

export function podById(id: string) {
  return GROUPS.find((p) => p.id === id) ?? null;
}

export const ANGLES: Record<string, string> = {
  Depuff: "Depuffing",
  MatureFace: "Mature skin",
  Jawline: "Jawline & double chin",
  Comparison: "Comparison",
  FakeBrush: "Real vs fake brush",
  SocialProof: "Social proof & reviews",
  Husband: "Partner reaction",
  Scarcity: "Scarcity",
  ProblemAware: "Problem aware",
  Mechanism: "Mechanism (lymphatic)",
  Authority: "Authority / expert",
  Offer: "Offer & price",
  Routine: "Routine / how-to",
  BeforeAfter: "Before & after",
  Founder: "Founder story",
  Sinus: "Sinus & tension",
  EyeBags: "Eyes",
};

export const FORMATS: Record<string, string> = {
  UGC: "UGC",
  AIUGC: "AI UGC",
  AIVoiceover: "AI voiceover + B-roll",
  UGCMontage: "UGC montage",
  Song: "Song ad",
  PixarSong: "Pixar song ad",
  ProductDemo: "Product demo",
  MixedMedia: "Mixed media",
  Static: "Static",
  UGCStatic: "UGC static",
  VSL: "VSL",
  Video: "Video",
  Native: "Native ad / advertorial",
  Interview: "Interview",
  Podcast: "Podcast",
  Animation: "Animation",
  AIDrama: "AI drama ad",
  Carousel: "Carousel",
};

/**
 * What each format means, as the media buyer defined them (Oct 2026). Claude reads these when it
 * suggests a creative's format (nightly Atria task); they're shown in Needs Tagging too.
 */
export const FORMAT_DEFINITIONS: Record<string, string> = {
  UGC: "A real creator talking to camera, phone-style.",
  AIUGC: "An AI avatar talking to camera.",
  AIVoiceover: "An AI voice over stock, product or demo footage; no on-camera presenter.",
  UGCMontage: "A montage of several creators' or customers' clips (e.g. problem / fix), cut together.",
  AIDrama: "A scripted AI story or mini movie, with characters and dialogue.",
  Song: "Built around a song or jingle, over live footage.",
  PixarSong: "Pixar-style 3D animation built around a song.",
  Animation: "Animated without a song: 2D, 3D (Pixar-style), motion graphics or an explainer.",
  ProductDemo: "The product in use, with little or no talking.",
  MixedMedia: "Clips, text and graphics mixed, with no single presenter or voice driving it.",
  VSL: "A long, script-led video sales letter.",
  Interview: "Someone interviewed on camera (street interview, Q&A).",
  Podcast: "A podcast-style clip.",
  Video: "Any other video (fallback).",
  Static: "A designed image or graphic.",
  UGCStatic: "An image that looks native: phone photo, screenshot, notes, review.",
  Carousel: "A carousel of images or cards.",
  Native: "An advertorial or listicle-style ad that reads like an article.",
};

export const HOOKS: Record<string, string> = {
  Story: "Story",
  Curiosity: "Curiosity",
  Contrarian: "Contrarian",
  Problem: "Problem-led",
  Shock: "Shock",
  Benefit: "Direct benefit",
};

export const LANDING_PAGES: Record<string, string> = {
  PDP: "Product page",
  LIST: "Listicle",
  ADV: "Advertorial",
  HOME: "Homepage",
};

/** Eugene Schwartz's five awareness levels: how much the viewer knows when the ad starts. */
export const AWARENESS: Record<string, string> = {
  unaware: "Unaware",
  problem: "Problem aware",
  solution: "Solution aware",
  product: "Product aware",
  most: "Most aware",
};

export const CAMPAIGN_HINTS = ["CBO", "ABO"] as const;

/**
 * Motivation tags: what an ad leans on, several per ad (Oct 2026, from the behavioral research:
 * 964 category/competitor reviews and 21 Facebook comments). Labelled by Claude, editable by hand.
 */
export const MOTIVATIONS: Record<string, string> = {
  proof: "Proof needed",
  price: "Price / value",
  under_eye: "Under-eye puffiness",
  comfort: "Comfort",
  convenience: "Convenience",
  relaxation: "Self-care / relaxation",
  demo_led: "Demonstration-led discovery",
};
