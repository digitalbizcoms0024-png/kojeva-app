// Reads angle and format from free-text names (concept labels, ad set and ad names).
// A best guess: hand-set tags always win. Add keywords here as naming evolves.
import type { ANGLES, FORMATS } from "./taxonomy.ts";

type Angle = keyof typeof ANGLES;
type Format = keyof typeof FORMATS;

/** Most specific first: the first rule that matches wins. */
const ANGLE_RULES: [Angle, RegExp][] = [
  ["FakeBrush", /fake brush|real\.? vs\.? fake|anti-fake|\bdupe|fake twin/],
  ["Offer", /\boffer\b|\bprice\b|% off|percent off|discount|\bsale\b|warehouse|\$\d/],
  ["Scarcity", /scarcity|last chance|sell(ing)? out|sold out|limited/],
  ["Founder", /founder|yapper/],
  ["Husband", /husband|\bwife\b|partner|boyfriend|let him/],
  ["Sinus", /sinus|tension|headache/],
  ["EyeBags", /eye ?bags|hooded eyes|under[- ]eye|\beyes\b/],
  ["Jawline", /jawline|double chin|sculpt|\bneck\b/],
  ["MatureFace", /mature|over 50|menopause|aging|\bat 5\d\b|older women|wrinkle/],
  ["Depuff", /depuff|puffy|puffiness|swelling|bloat/],
  ["BeforeAfter", /before ?\/ ?after|before after|before and after|day 1 vs|half-face reveal|reveal/],
  ["Mechanism", /mechanism|lymphatic|drainage|under the skin|worms in your face/],
  ["Authority", /authority|doctor|nurse|esthetician|educator|expert|dermatolog|skin educator/],
  ["SocialProof", /social proof|review|testimonial|\bproof\b|viral|more women/],
  ["Comparison", /comparison|\bvs\.?\b|alternative|gua sha|compare/],
  ["Routine", /routine|ritual|how to|tutorial|one step|simple|wrong way/],
  ["ProblemAware", /problem|negative marketing|apology/],
];

const FORMAT_RULES: [Format, RegExp][] = [
  ["AIDrama", /\bai drama\b/],
  ["AIVoiceover", /voice ?over|\bb-? ?rolls?\b/],
  ["AIUGC", /\bai ugc\b/],
  ["UGCMontage", /\bmontage\b|compilation/],
  ["UGCStatic", /\bugc static\b/],
  ["Song", /\bsong\b|jingle/],
  ["ProductDemo", /product demo/],
  ["MixedMedia", /mixed media/],
  ["UGC", /\bugc\b/],
  ["VSL", /\bvsl\b/],
  ["Native", /native ad|advertorial|listicle/],
  ["Podcast", /podcast/],
  ["Interview", /interview/],
  ["Animation", /\banim|pixar/],
  ["Carousel", /carousel/],
  ["Static", /\bstatics?\b|^st _/],
  ["Video", /\bvideos?\b|greenscreen|green screen/],
];

const clean = (s: string) => s.toLowerCase().replace(/[_|]+/g, " ").replace(/\s+/g, " ");

function first<T>(rules: [T, RegExp][], texts: (string | null | undefined)[]): T | null {
  for (const t of texts) {
    if (!t) continue;
    const c = clean(t);
    for (const [value, re] of rules) if (re.test(c)) return value;
  }
  return null;
}

/**
 * Angle and format from the most specific text first: the concept label, then the ad set
 * name, then ad names. Static ads named "ST _ <angle> _ …" put their angle up front.
 */
export function classify(texts: { label?: string | null; adset?: string | null; ads?: (string | null)[] }) {
  const ordered = [texts.label, texts.adset, ...(texts.ads ?? [])];
  return {
    angle: first(ANGLE_RULES, ordered) as string | null,
    format: (first(FORMAT_RULES, [texts.label, texts.adset]) ?? first(FORMAT_RULES, texts.ads ?? [])) as string | null,
  };
}
