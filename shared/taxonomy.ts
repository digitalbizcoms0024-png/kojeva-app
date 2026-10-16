// Controlled vocabularies for creative tags. Keys are what appears in ad names;
// values are display labels. Extend these as the team adds new angles/formats.

export const PODS = [
  { id: "harris", code: "HAR", name: "Harris", color: "#2a78d6" },
  { id: "dhia", code: "DHI", name: "Dhia", color: "#eb6834" },
  { id: "shameer", code: "SHA", name: "Shameer", color: "#1baf7a" },
  { id: "ali", code: "ALI", name: "Ali", color: "#eda100" },
] as const;

export type PodCode = (typeof PODS)[number]["code"];
export type PodId = (typeof PODS)[number]["id"];

export function podByCode(code: string) {
  return PODS.find((p) => p.code === code.toUpperCase()) ?? null;
}

export function podById(id: string) {
  return PODS.find((p) => p.id === id) ?? null;
}

export const ANGLES: Record<string, string> = {
  Depuff: "Depuffing",
  MatureFace: "Mature face",
  Comparison: "Comparison",
  SocialProof: "Social proof",
  Husband: "Husband reaction",
  Jawline: "Jawline",
};

export const FORMATS: Record<string, string> = {
  UGC: "UGC",
  Static: "Static",
  VSL: "VSL",
  Interview: "Interview",
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
