import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MetaResponse } from "../shared/api.ts";
import type { Targets } from "../shared/metrics.ts";
import { AWARENESS } from "../shared/taxonomy.ts";
import { PageHeader, SectionTitle } from "./components/ui.tsx";

/** One term the hub uses, in plain words. The numbers come from the current targets. */
interface Term {
  term: string;
  text: string;
  group: "Testing" | "Numbers" | "Creatives" | "Pages";
}

export type TermId =
  | "concept"
  | "qualifies"
  | "judged"
  | "testing"
  | "testingNow"
  | "sharedCredit"
  | "outboundCpc"
  | "costPerAtc"
  | "frequency"
  | "podScore"
  | "hit"
  | "miss"
  | "lateHit"
  | "hitCall"
  | "ineligible"
  | "hitRate"
  | "testSpend"
  | "spend"
  | "purchases"
  | "cpa"
  | "roas"
  | "ctr"
  | "colors"
  | "post"
  | "pod"
  | "agency"
  | "fatigue"
  | "persona"
  | "awareness"
  | "coverage"
  | "unplaced"
  | "rankMin"
  | "daysLive"
  | "scaling";

export function terms(t: Targets): Record<TermId, Term> {
  const amber = t.cpaWarnMax ?? t.targetCpa * 1.25;
  return {
    concept: {
      group: "Testing",
      term: "Concept",
      text: "One idea being tested: one testing ad set (\"IH | Harris | KOJEVA 3 | …\"), with all the ads in it. Scaling ad sets are never concepts, so a winner's copies don't count twice. Hit rate is counted per concept, not per ad.",
    },
    qualifies: {
      group: "Testing",
      term: "Qualifies",
      text: `A concept qualifies once any one of its ads has spent $${t.minTestSpend}. Concepts where no ad gets there aren't counted ("No ad at $${t.minTestSpend}").`,
    },
    judged: {
      group: "Testing",
      term: "Judging window",
      text: `A concept is judged on all its ads together, from its first day of spend to day ${t.testWindowDays} or the day it qualified, whichever is later.`,
    },
    testing: {
      group: "Testing",
      term: "Testing",
      text: "The judging window hasn't finished yet, so there's no result. Turning every ad in the ad set off ends the test: it's judged at once on everything it spent.",
    },
    podScore: {
      group: "Testing",
      term: "Pod score",
      text: `Out of 100: how the pod leaderboard ranks the in-house pods. Hit rate, up to ${t.scoreWeightHitRate} points: full points at ${t.scoreFullHitRate}% or above, a share below (${t.scoreFullHitRate / 2}% earns half)${t.scoreMinDecided > 0 ? `, and less for pods with fewer than ${t.scoreMinDecided} decided concepts (2 decided earns 2/${t.scoreMinDecided}), so a lucky hit on a few tests can't top the board` : ""}. Spend, up to ${t.scoreWeightSpend}: the pod's spend as a share of the biggest pod's. ROAS, up to ${t.scoreWeightRoas}: full points at the ${t.targetRoas} target or above, a share below, and less for pods that spent under $${t.scoreRoasMinSpend}. The bar under the score shows the three parts. Change them in Settings → Targets.`,
    },
    outboundCpc: {
      group: "Numbers",
      term: "Outbound CPC",
      text: "Spend ÷ outbound clicks: clicks on links that leave Meta (to the site), from Meta. Stored from Oct 29, 2026; earlier days show —.",
    },
    costPerAtc: {
      group: "Numbers",
      term: "Cost per add to cart",
      text: "Spend ÷ adds to cart reported by Meta for the ad (its default attribution). Stored from Oct 29, 2026; earlier days show —.",
    },
    frequency: {
      group: "Numbers",
      term: "Frequency",
      text: "About how many times each person saw the ad: impressions ÷ people reached. Reach is added up day by day, so someone reached on two days counts twice: an estimate (≈).",
    },
    sharedCredit: {
      group: "Pages",
      term: "Shared with a partner",
      text: 'An ad set naming a pod and a partner ("Shameer | Trybe | …") counts in full for both, shown as "Shameer + Trybe". Totals and share bars count its spend once.',
    },
    testingNow: {
      group: "Testing",
      term: "Testing now",
      text: "Testing ad sets that are switched on in Meta, whether or not they're getting spend right now and whatever their result so far. Counts concepts (testing ad sets), not ads. Turning every ad in one off removes it.",
    },
    hit: {
      group: "Testing",
      term: "Hit",
      text: `Over its judging window the concept had CPA ≤ $${t.targetCpa} ${t.hitRule === "both" ? "and" : "or"} ROAS ≥ ${t.targetRoas} (Meta).`,
    },
    miss: { group: "Testing", term: "Miss", text: "The judging window finished without reaching the hit target (including no purchases)." },
    lateHit: {
      group: "Testing",
      term: "Late hit",
      text:
        t.lateWindowDays > 0
          ? `A miss that kept spending and later reached target: from day ${t.lateWindowDays} on, its totals since launch or any ${t.lateWindowDays} days in a row hit target, on at least $${t.minTestSpend}. Counts as a hit.`
          : "Turned off in Settings → Targets.",
    },
    hitCall: {
      group: "Testing",
      term: "Hit (call)",
      text: "A miss the media buyer calls a hit (or super hit) because it takes major spend and lifts the account, even below target. Only the media buyer makes this call; it counts as a hit.",
    },
    ineligible: { group: "Testing", term: `No ad at $${t.minTestSpend}`, text: `No ad in the concept reached $${t.minTestSpend}, so it isn't counted either way.` },
    hitRate: {
      group: "Testing",
      term: "Hit rate",
      text: "Hits (late hits and called hits included) out of decided concepts (hits + misses). Concepts still testing or under the minimum aren't counted. A concept counts in the period it first spent.",
    },
    testSpend: { group: "Numbers", term: "Test spend / test CPA", text: "Spend and CPA over each concept's judging window only, not everything it spent later." },
    spend: { group: "Numbers", term: "Spend", text: "What Meta charged, summed over every copy of the ad in the selected dates." },
    purchases: { group: "Numbers", term: "Purchases", text: "Purchases Meta attributes to the ad (the Purchases column in Ads Manager, the account's default attribution)." },
    cpa: { group: "Numbers", term: "CPA", text: `Spend ÷ purchases (Meta). "—" when there were no purchases. Target $${t.targetCpa}.` },
    roas: { group: "Numbers", term: "ROAS", text: `Purchase value ÷ spend (Meta). Target ${t.targetRoas}.` },
    ctr: { group: "Numbers", term: "CTR", text: "Link clicks ÷ impressions." },
    colors: {
      group: "Numbers",
      term: "✓ ! ✕ colours",
      text: `CPA: ✓ green at $${t.targetCpa} or less, ! amber up to $${amber.toFixed(2)}, ✕ red above. ROAS: ✓ at ${t.targetRoas} or more, ! from ${(t.targetRoas * 0.8).toFixed(2)}, ✕ below.`,
    },
    post: {
      group: "Creatives",
      term: "Ad (post)",
      text: "Copies of the same ad across campaigns share one Facebook post, so the hub groups them and ranks the post: its numbers are all copies together.",
    },
    pod: { group: "Creatives", term: "Pod", text: "A creative team (Harris, Dhia, Shameer, Ali, …). An ad belongs to the pod named in its ad set, or the one set by hand in To review." },
    agency: { group: "Creatives", term: "Agency", text: "Agency ad sets (ME/QW/TV/YD) and anything launched before the pods started. Shown beside the pods, never counted in them." },
    fatigue: {
      group: "Creatives",
      term: "Fatigue",
      text: "An ad's last 3 days compared with its first week: frequency up 25%+, CTR down 25%+, or CPA up 30%+ past the amber limit. Two signals = Fatigued, one = Watch.",
    },
    persona: { group: "Creatives", term: "Persona", text: "Who the ad speaks to. The list is confirmed in Settings → Personas; Claude suggests one per ad, a hand-set one wins." },
    awareness: {
      group: "Creatives",
      term: "Awareness",
      text: `What the viewer already knows: ${Object.values(AWARENESS).join(" → ")}. Unaware hasn't noticed the problem; most aware knows Kojeva and only needs a reason to buy now.`,
    },
    coverage: { group: "Pages", term: "Coverage Map", text: "Spend on running ads, placed by persona × awareness, so you can see who the account is and isn't talking to." },
    unplaced: { group: "Pages", term: "Not on the map", text: "Running ads with $50+ spend in the period that have no persona or awareness level yet, waiting for Claude's nightly labels or a person in To review." },
    rankMin: {
      group: "Pages",
      term: "Ranking minimum",
      text: `Ranking by purchases, ROAS, CTR or CPA only includes ads that spent at least $${t.rankMinSpendPerDay} a day over the selected dates, so a lucky ad on a few dollars doesn't top the list. "Show them" adds the smaller ads back; ranking by spend shows every ad.`,
    },
    daysLive: {
      group: "Pages",
      term: "Days live",
      text: "Days from the ad's launch (or its first spend, if earlier) to the latest synced day, whether or not it's still running.",
    },
    scaling: {
      group: "Pages",
      term: "Scaling",
      text: "A copy of the ad is running outside testing ad sets: in a scaling or other campaign the media buyer moved it into.",
    },
  };
}

/** Targets for the ⓘ buttons, set once by the app from /api/meta. */
let current: Targets | null = null;
export function setGlossaryTargets(t: Targets) {
  current = t;
}

/**
 * A small ⓘ next to a term: hover (or tap) shows what it means. The note is drawn over the page
 * (fixed, in a portal), so tables that scroll sideways don't cut it off.
 */
export function Info({ id, className = "" }: { id: TermId; className?: string }) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  const open = pinned || hover;
  useEffect(() => {
    if (!open || !button.current) return;
    const place = () => {
      const r = button.current!.getBoundingClientRect();
      // Centred under the ⓘ, kept 8px inside the screen (the note is 256px wide).
      setAt({ x: Math.min(Math.max(8, r.left + r.width / 2 - 128), window.innerWidth - 264), y: r.bottom + 6 });
    };
    place();
    const close = (e: MouseEvent) => !button.current?.contains(e.target as Node) && !note.current?.contains(e.target as Node) && setPinned(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);
  if (!current) return null;
  const t = terms(current)[id];
  return (
    <span className={`inline-block align-middle normal-case tracking-normal ${className}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        ref={button}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setPinned((o) => !o);
        }}
        className="grid size-4 place-items-center rounded-full border border-ink-3 text-[10px] leading-none font-bold text-ink-3 hover:border-ink hover:text-ink"
        aria-label={`What is ${t.term}?`}
        aria-expanded={open}
      >
        i
      </button>
      {open &&
        at &&
        createPortal(
          <span
            ref={note}
            role="tooltip"
            style={{ left: at.x, top: at.y }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            className="fixed z-[70] block w-64 border border-divider bg-page p-3 text-left text-xs font-normal tracking-normal text-ink-2 normal-case shadow-lg"
          >
            <b className="mb-0.5 block text-ink">{t.term}</b>
            {t.text}{" "}
            <a href="#/glossary" className="link" onClick={() => setPinned(false)}>
              Glossary
            </a>
          </span>,
          document.body,
        )}
    </span>
  );
}

const GROUPS: Term["group"][] = ["Testing", "Numbers", "Creatives", "Pages"];

/** Every term in one place, grouped, with the current targets filled in. */
export function GlossaryPage({ meta }: { meta: MetaResponse }) {
  const all = Object.values(terms(meta.targets));
  return (
    <div>
      <PageHeader title="Glossary" subtitle="What the hub's words mean. Numbers are the current targets from Settings → Targets." />
      <div className="flex max-w-[860px] flex-col gap-10 px-4 py-8 md:px-8">
        {GROUPS.map((g) => (
          <section key={g}>
            <SectionTitle title={g} />
            <dl>
              {all
                .filter((x) => x.group === g)
                .map((x) => (
                  <div key={x.term} className="grid gap-1 border-b border-divider py-3 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6">
                    <dt className="font-bold text-ink">{x.term}</dt>
                    <dd className="text-sm text-ink-2">{x.text}</dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
