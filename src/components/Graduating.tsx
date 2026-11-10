import type { ConceptResult } from "../../shared/api.ts";
import { cpa, roas, TIER_LABELS, type Targets, type WinnerTier } from "../../shared/metrics.ts";
import { conceptHref } from "../drill.ts";
import { dollars, money, ratio } from "../format.ts";
import { Info } from "../glossary.tsx";
import { PodChip, SectionTitle, TierBadge } from "./ui.tsx";

const NEXT: Partial<Record<WinnerTier, WinnerTier>> = { kpi: "spend", spend: "breakthrough" };

/**
 * Winners on their way to the next tier (owner, Nov 10): spend across all copies against the next
 * tier's spend, and whether they're still near KPI since launch. Closest first, up to 6.
 */
export function Graduating({ concepts, targets, podIds }: { concepts: ConceptResult[]; targets: Targets; podIds: string[] }) {
  const rows = concepts
    .filter((k) => k.tier && NEXT[k.tier] && k.copies && podIds.includes(k.podId))
    .map((k) => {
      const next = NEXT[k.tier!]!;
      const goal = (next === "spend" ? targets.spendWinnerMinSpend : targets.breakthroughMinSpend) * 100;
      const r = roas(k.copies!);
      const c = cpa(k.copies!);
      const near = (r != null && r >= targets.tierHoldRoas) || (c != null && c <= targets.tierHoldCpa);
      return { k, next, goal, progress: Math.min(1, k.copies!.spendCents / goal), r, c, near };
    })
    .filter((x) => x.progress >= 0.25)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 6);
  if (!rows.length) return null;
  return (
    <section>
      <SectionTitle
        title={
          <span className="inline-flex items-center gap-1.5">
            Close to graduating <Info id="winnerTiers" />
          </span>
        }
        right="Spend across every copy since launch"
      />
      <ul className="flex flex-col divide-y divide-divider border-y border-divider">
        {rows.map(({ k, next, goal, progress, r, c, near }) => (
          <li key={k.conceptId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
            <span className="flex min-w-64 flex-1 items-center gap-2">
              <PodChip podId={k.podId} coPodId={k.coPodId} />
              <a href={conceptHref(k.conceptId)} className="font-semibold text-ink hover:underline">
                {k.label}
              </a>
            </span>
            <span className="num min-w-56 text-ink-2">
              {money(k.copies!.spendCents)} of {money(goal)} · ROAS {ratio(r)} · CPA {dollars(c)}
            </span>
            <span className="h-1.5 min-w-32 flex-1 bg-surface-2" role="img" aria-label={`${Math.round(progress * 100)}% of the way`}>
              <span className="block h-full bg-ink" style={{ width: `${progress * 100}%` }} />
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
              <TierBadge tier={k.tier!} short /> → {TIER_LABELS[next]}
              {!near && ` · needs ROAS ${targets.tierHoldRoas}+ or CPA $${targets.tierHoldCpa} or less`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
