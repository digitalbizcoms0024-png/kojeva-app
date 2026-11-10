import { Info } from "../glossary.tsx";
import type { MetaResponse, PodRow, PodsResponse } from "../../shared/api.ts";
import { cpa, podScores, roas, TIER_LABELS, type PodScore, type Targets, type WinnerTier } from "../../shared/metrics.ts";
import { shiftDay } from "./HeaderControls.tsx";
import { Sparkline } from "./Sparkline.tsx";
import { CpaValue, Icon, LoadError, RoasValue, SectionTitle } from "./ui.tsx";
import { money, pct, shortDate } from "../format.ts";
import { openDrill } from "../drill.ts";

/**
 * The pod leaderboard, on the Dashboard and at the top of the Pods page: the pods ranked by pod score
 * (winners by tier, spend, ROAS; weights in Settings → Targets), then spend. In-house pods only: never
 * Agency, nor partners like Trybe (owner, Oct 28). The score is measured among the pods shown.
 */
export function PodLeaderboard({
  data,
  error,
  retry,
  meta,
  range,
}: {
  data: PodsResponse | null;
  error: Error | null;
  retry: () => void;
  meta: MetaResponse;
  range: string;
}) {
  const tg = meta.targets;
  const sparkDays = meta.latestDate ? Array.from({ length: 7 }, (_, i) => shiftDay(meta.latestDate!, i - 6)) : [];
  const inhouse = new Set(meta.pods.filter((p) => p.inhouse).map((p) => p.id));
  const podRows = (data?.rows ?? []).filter((r) => r.kind === "pod" && r.podId != null && inhouse.has(r.podId));
  const scores = podScores(
    podRows.map((r) => ({ ...r, decided: r.hits + r.misses })),
    tg,
  );
  const ranked = podRows
    .map((r, i) => ({ ...r, score: scores[i]! }))
    .sort((a, b) => b.score.score - a.score.score || b.totals.spendCents - a.totals.spendCents);
  return (
    <section>
      <SectionTitle
        title="Pod leaderboard"
        right={
          data &&
          `Ranked by pod score (winners ${tg.scoreWeightHitRate} · spend ${tg.scoreWeightSpend} · ROAS ${tg.scoreWeightRoas}) · ${data.from === "2000-01-01" ? "All time" : `${shortDate(data.from)} – ${shortDate(data.to)}`} · Meta`
        }
      />
      <LoadError error={error} retry={retry} what="the pods" loading={!data} rows={6} />
      <Leaderboard rows={ranked} targets={tg} sparkDays={sparkDays} range={range} />
    </section>
  );
}

/**
 * The pods ranked by pod score as one compact table (it replaced a card per pod, which made an empty
 * pod as tall as a busy one). Pods only: Agency isn't shown here (owner, Oct 28).
 */
function Leaderboard({
  rows,
  targets,
  sparkDays,
  range,
}: {
  rows: (PodRow & { score: PodScore })[];
  targets: Targets;
  sparkDays: string[];
  range: string;
}) {
  // Scaled winners first (bold, with their icon), then KPI winners. Each opens those concepts.
  const winners = (r: PodRow & { score: PodScore }, inline = false) =>
    r.hits ? (
      <span className={inline ? "flex flex-wrap gap-x-2 text-xs" : "flex flex-col items-start gap-0.5"}>
        {TIER_ORDER.filter((x) => r.tiers[x] > 0).map((x) => {
          const label = `${r.tiers[x]} ${TIER_LABELS[x]}${r.tiers[x] === 1 ? "" : "s"}`;
          return (
            <button
              key={x}
              type="button"
              className={`inline-flex items-center gap-1 whitespace-nowrap hover:underline ${x === "kpi" ? "text-ink-2" : "font-bold text-ink"}`}
              title={`See ${r.name}'s ${label}`}
              onClick={() => openDrill({ title: `${r.name} · ${TIER_LABELS[x]}s`, range, filter: { pod: r.podId!, result: x } })}
            >
              {x !== "kpi" && <Icon name={x === "spend" ? "trend" : "star"} size={13} />}
              {label}
            </button>
          );
        })}
      </span>
    ) : inline ? null : (
      <span className="text-ink-3">—</span>
    );

  // Text left, numbers right (tabular figures) so every column lines up row to row (owner, Nov 10).
  const line = (r: PodRow & { score: PodScore }, rank: number) => {
    const decided = r.hits + r.misses;
    // The leader: first place with a score above 0, marked by the trophy alone.
    const top = rank === 1 && r.score.score > 0;
    const s = r.score;
    return (
      <tr key={r.podId} className="border-b border-divider last:border-b-0">
        <td className="num w-8 py-3.5 pl-1 align-middle font-bold text-ink-3">
          {top ? (
            <span className="inline-flex text-accent-ink" title="Top pod by score">
              <Icon name="trophy" size={16} />
              <span className="sr-only">1</span>
            </span>
          ) : (
            rank
          )}
        </td>
        <td className="py-3.5 pr-4">
          <a href="#/pods" className="inline-flex items-center gap-2.5 font-bold text-ink hover:underline">
            <span className="size-2.5 shrink-0" style={{ background: `var(--pod-${r.podId})` }} aria-hidden />
            {r.name}
          </a>
          {r.live > 0 && <div className="pl-5 text-xs whitespace-nowrap text-ink-3">{r.live} testing now</div>}
          <div className="mt-1 pl-5 sm:hidden">{winners(r, true)}</div>
        </td>
        <td className="py-3.5 pr-4 sm:pr-6">
          <div className="flex items-center gap-3.5">
            <span className="num w-8 text-right text-xl leading-none font-extrabold text-ink">{Math.round(s.score)}</span>
            <ScoreBar score={s} targets={targets} />
          </div>
        </td>
        <td className="hidden py-3.5 pr-6 sm:table-cell">{winners(r)}</td>
        <td className="py-3.5 pr-4 text-right">
          <div className="num text-lg leading-none font-bold text-ink">{pct(r.hitRate, 0)}</div>
          <div className="num mt-0.5 text-xs text-ink-3">
            {decided ? (
              // The pod's hits in a side card, like a concept group (switch to misses there).
              <button
                type="button"
                className="hover:text-ink hover:underline"
                title={`See ${r.name}'s ${r.hits} ${r.hits === 1 ? "hit" : "hits"}`}
                onClick={() => openDrill({ title: `${r.name} · hits`, range, filter: { pod: r.podId!, result: "hits" } })}
              >
                {`${r.hits}/${decided}${r.lateHits ? ` · ${r.lateHits} late` : ""}`}
              </button>
            ) : (
              "none decided"
            )}
          </div>
        </td>
        <td className="hidden w-40 py-3.5 pr-4 pl-8 md:table-cell">
          <Sparkline values={r.spark} days={sparkDays} color={`var(--pod-${r.podId})`} label={r.name} />
        </td>
        <td className="num hidden py-3.5 pr-4 text-right text-ink sm:table-cell">{money(r.totals.spendCents, { compact: true })}</td>
        <td className="num hidden py-3.5 pr-4 text-right sm:table-cell">
          <CpaValue value={cpa(r.totals)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
        </td>
        <td className="num hidden py-3.5 text-right sm:table-cell">
          <RoasValue value={roas(r.totals)} target={targets.targetRoas} />
        </td>
      </tr>
    );
  };
  if (!rows.length) return null;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="kicker text-left">
            <tr className="border-b border-divider">
              <th className="py-2.5 pl-1 font-normal">#</th>
              <th className="py-2.5 pr-4 font-normal">Pod</th>
              <th className="py-2.5 pr-4 font-normal whitespace-nowrap sm:w-56 sm:pr-6">
                Score <Info id="podScore" />
              </th>
              <th className="hidden w-48 py-2.5 pr-6 font-normal sm:table-cell">
                Winners <Info id="winnerTiers" />
              </th>
              <th className="w-28 py-2.5 pr-4 text-right font-normal whitespace-nowrap">
                Hit rate <Info id="hitRate" />
              </th>
              <th className="hidden py-2.5 pr-4 pl-8 font-normal whitespace-nowrap md:table-cell">Spend, last 7 days</th>
              <th className="hidden py-2.5 pr-4 text-right font-normal sm:table-cell">Spend</th>
              <th className="hidden py-2.5 pr-4 text-right font-normal sm:table-cell">CPA</th>
              <th className="hidden py-2.5 text-right font-normal sm:table-cell">ROAS</th>
            </tr>
          </thead>
          <tbody>{rows.map((r, i) => line(r, i + 1))}</tbody>
        </table>
      </div>
      <p className="mt-0 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-divider pt-3 text-xs text-ink-2">
        <span>Score out of 100:</span>
        {SCORE_PARTS.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3.5" style={{ background: p.color }} aria-hidden />
            {p.label} (up to {targets[p.weight]}
            {p.key === "roas" ? `, full at ${targets.targetRoas}+` : p.key === "spend" ? ", vs the top spender" : ""})
          </span>
        ))}
      </p>
    </>
  );
}

/** Tiers from highest, on the leaderboard. */
const TIER_ORDER: WinnerTier[] = ["breakthrough", "spend", "kpi"];

/** The score's three parts, in the bar's order, in neutral shades (pod and status colors are reserved). */
const SCORE_PARTS = [
  { key: "hitRate", label: "Winners", weight: "scoreWeightHitRate", color: "var(--ink)" },
  { key: "spend", label: "Spend", weight: "scoreWeightSpend", color: "var(--ink-3)" },
  { key: "roas", label: "ROAS", weight: "scoreWeightRoas", color: "var(--chart-bar)" },
] as const;

/** A 100-point bar beside the score: each part's points as a segment (2px apart), the rest left empty. */
function ScoreBar({ score, targets }: { score: PodScore; targets: Targets }) {
  const tip = SCORE_PARTS.map((p) => `${p.label} ${Math.round(score[p.key])} of ${targets[p.weight]}`).join(" · ");
  return (
    <div className="hidden h-2 w-36 gap-0.5 bg-surface-2 sm:flex" title={tip} role="img" aria-label={tip}>
      {SCORE_PARTS.map((p) =>
        score[p.key] > 0.5 ? <span key={p.key} className="h-full" style={{ width: `${score[p.key]}%`, background: p.color }} /> : null,
      )}
    </div>
  );
}
