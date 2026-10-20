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
  Static: "Static",
  VSL: "VSL",
  Video: "Video",
  Native: "Native ad / advertorial",
  Interview: "Interview",
  Podcast: "Podcast",
  Animation: "Animation",
  AIDrama: "AI drama ad",
  Carousel: "Carousel",
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
