// Controlled vocabularies for creative tags. Keys are what appears in ad names;
// values are display labels. Extend these as the team adds new angles/formats.

export const PODS = [
  { id: "harris", code: "HAR", name: "Harris", color: "#2a78d6" },
  { id: "dhia", code: "DHI", name: "Dhia", color: "#eb6834" },
  { id: "shameer", code: "SHA", name: "Shameer", color: "#1baf7a" },
  { id: "ali", code: "ALI", name: "Ali", color: "#eda100" },
] as const;

/** The agency that produced ads before the in-house pods started. Not a pod, but ranked beside them. */
export const AGENCY = { id: "agency", code: "AGY", name: "Agency", color: "#8a847c" } as const;

/** Everyone ads can be credited to: the 4 pods, then the agency. */
export const GROUPS = [...PODS, AGENCY] as const;

export type PodCode = (typeof GROUPS)[number]["code"];
export type PodId = (typeof GROUPS)[number]["id"];

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

export const CAMPAIGN_HINTS = ["CBO", "ABO"] as const;
