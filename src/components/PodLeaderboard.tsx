import { Info } from "../glossary.tsx";
import type { LaunchesResponse, MetaResponse, PodRow, PodsResponse } from "../../shared/api.ts";
import { cpa, podScores, roas, type PodScore, type Targets } from "../../shared/metrics.ts";
import { useApi } from "../api.ts";
import { shiftDay } from "./HeaderControls.tsx";
import { Sparkline } from "./Sparkline.tsx";
import { CpaValue, Icon, LoadError, RoasValue, SectionTitle } from "./ui.tsx";
import { money, pct, shortDate } from "../format.ts";
import { openDrill } from "../drill.ts";

/**
 * The pod leaderboard, on the Dashboard and at the top of the Pods page: the pods ranked by pod score
 * (hit rate, spend, ROAS; weights in Settings → Targets), then spend. In-house pods only: never
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
  const launches = useApi<LaunchesResponse>("/api/launches?weeks=1");
  const tg = meta.targets;
  const sparkDays = meta.latestDate ? Array.from({ length: 7 }, (_, i) => shiftDay(meta.latestDate!, i - 6)) : [];
  const inhouse = new Set(meta.pods.filter((p) => p.inhouse).map((p) => p.id));
  const podRows = (data?.rows ?? []).filter((r) => r.kind === "pod" && r.podId != null && inhouse.has(r.podId));
  const scores = podScores(podRows, tg);
  const ranked = podRows
    .map((r, i) => ({ ...r, score: scores[i]! }))
    .sort((a, b) => b.score.score - a.score.score || b.totals.spendCents - a.totals.spendCents);
  return (
    <section>
      <SectionTitle
        title="Pod leaderboard"
        right={
          data &&
          `Ranked by pod score (hit rate ${tg.scoreWeightHitRate} · spend ${tg.scoreWeightSpend} · ROAS ${tg.scoreWeightRoas}) · ${data.from === "2000-01-01" ? "All time" : `${shortDate(data.from)} – ${shortDate(data.to)}`} · Meta`
        }
      />
      <LoadError error={error} retry={retry} what="the pods" loading={!data} rows={6} />
      <Leaderboard rows={ranked} targets={tg} sparkDays={sparkDays} launches={launches.data} range={range} />
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
  launches,
  range,
}: {
  rows: (PodRow & { score: PodScore })[];
  targets: Targets;
  sparkDays: string[];
  launches: LaunchesResponse | null;
  range: string;
}) {
  const line = (r: PodRow & { score: PodScore }, rank: number) => {
    const decided = r.hits + r.misses;
    const week = launches?.rows.find((l) => l.podId === r.podId)?.counts[0] ?? null;
    // The leader: first place with a score above 0.
    const top = rank === 1 && r.score.score > 0;
    const s = r.score;
    return (
      <tr key={r.podId} className={`border-b border-divider ${top ? "bg-accent-soft" : ""}`}>
        <td className={`num w-8 py-3 align-middle font-bold ${top ? "pl-1 text-accent-ink" : "text-ink-3"}`}>
          {top ? (
            <span className="inline-flex items-center gap-0.5" title="Top pod by score">
              <Icon name="trophy" size={15} />
              <span className="sr-only">1</span>
            </span>
          ) : (
            rank
          )}
        </td>
        <td className="py-3 pr-3">
          <a href="#/pods" className="inline-flex items-center gap-2 font-bold text-ink hover:underline">
            <span className="size-2.5 shrink-0" style={{ background: `var(--pod-${r.podId})` }} aria-hidden />
            {r.name}
          </a>
          {top && <span className="kicker ml-2 text-accent-ink">Top pod</span>}
          <div className="text-xs text-ink-3">
            {`${week ?? 0} ${week === 1 ? "concept" : "concepts"} this week${r.live ? ` · ${r.live} testing now` : ""}`}
          </div>
        </td>
        <td className="py-3 pr-3 text-right">
          <div className="num text-xl leading-none font-extrabold text-ink">{Math.round(s.score)}</div>
          <ScoreBar score={s} targets={targets} />
        </td>
        <td className="py-3 pr-3 text-right">
          <div className="num text-lg leading-none font-bold text-ink">{pct(r.hitRate, 0)}</div>
          <div className="num text-xs text-ink-3">
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
        <td className="hidden w-36 py-3 pr-3 md:table-cell">
          <Sparkline values={r.spark} days={sparkDays} color={`var(--pod-${r.podId})`} label={r.name} />
        </td>
        <td className="num py-3 pr-3 text-right text-ink">{money(r.totals.spendCents, { compact: true })}</td>
        <td className="hidden py-3 pr-3 text-right sm:table-cell">
          <CpaValue value={cpa(r.totals)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
        </td>
        <td className="hidden py-3 text-right sm:table-cell">
          <RoasValue value={roas(r.totals)} target={targets.targetRoas} />
        </td>
      </tr>
    );
  };
  if (!rows.length) return null;
  return (
    <>
      <table className="w-full text-sm">
        <thead className="kicker text-left">
          <tr className="border-b border-divider">
            <th className="py-2 font-normal">#</th>
            <th className="py-2 font-normal">Pod</th>
            <th className="py-2 pr-3 text-right font-normal">
              Score <Info id="podScore" />
            </th>
            <th className="py-2 pr-3 text-right font-normal">
              Hit rate <Info id="hitRate" />
            </th>
            <th className="hidden py-2 pr-3 font-normal md:table-cell">Spend, last 7 days</th>
            <th className="py-2 pr-3 text-right font-normal">Spend</th>
            <th className="hidden py-2 pr-3 text-right font-normal sm:table-cell">CPA</th>
            <th className="hidden py-2 text-right font-normal sm:table-cell">ROAS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => line(r, i + 1))}
        </tbody>
      </table>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
        <span>Score out of 100, made of:</span>
        {SCORE_PARTS.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-3" style={{ background: p.color }} aria-hidden />
            {p.label} (up to {targets[p.weight]})
          </span>
        ))}
      </p>
    </>
  );
}

/** The score's three parts, in the bar's order, in neutral shades (pod and status colors are reserved). */
const SCORE_PARTS = [
  { key: "hitRate", label: "Hit rate", weight: "scoreWeightHitRate", color: "var(--ink)" },
  { key: "spend", label: "Spend", weight: "scoreWeightSpend", color: "var(--ink-3)" },
  { key: "roas", label: "ROAS", weight: "scoreWeightRoas", color: "var(--chart-bar)" },
] as const;

/** A 100-point bar under the score: each part's points as a segment, the rest left empty. */
function ScoreBar({ score, targets }: { score: PodScore; targets: Targets }) {
  const tip = SCORE_PARTS.map((p) => `${p.label} ${Math.round(score[p.key])} of ${targets[p.weight]}`).join(" · ");
  return (
    <div className="mt-1.5 ml-auto flex h-1.5 w-24 bg-surface-2" title={tip} role="img" aria-label={tip}>
      {SCORE_PARTS.map((p) => (
        <span key={p.key} className="h-full" style={{ width: `${score[p.key]}%`, background: p.color }} />
      ))}
    </div>
  );
}
