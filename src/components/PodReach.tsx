import type { FrequencyTrendResponse, PodRow } from "../../shared/api.ts";
import { dailyFrequency, funnelBand, type FunnelBand, type Targets, type Totals } from "../../shared/metrics.ts";
import { qs, useApi } from "../api.ts";
import { money, shortDate } from "../format.ts";
import { Info } from "../glossary.tsx";
import { Empty, LoadError, PodChip, SectionTitle } from "./ui.tsx";

export const FUNNEL_LABEL: Record<FunnelBand, string> = { top: "Top of funnel", middle: "Middle of funnel", bottom: "Bottom of funnel" };

// Neutral shades, not the reserved good/warn/bad colors: a band isn't a verdict, and the label is always shown.
const FUNNEL_FILL: Record<FunnelBand | "unknown", string> = {
  top: "var(--ink)",
  middle: "color-mix(in srgb, var(--ink) 55%, transparent)",
  bottom: "color-mix(in srgb, var(--ink) 25%, transparent)",
  unknown: "var(--line)",
};

/** Average daily frequency with 2 decimals, or "—" without reach. */
export function freqText(f: number | null): string {
  return f == null ? "—" : f.toFixed(2);
}

/** An ad's or pod's average daily frequency and the funnel band it falls in (Settings → Targets). */
export function FrequencyValue({ totals, targets, short = false }: { totals: Totals; targets: Targets; short?: boolean }) {
  const f = dailyFrequency(totals);
  const band = funnelBand(f, targets);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <span className="num">{freqText(f)}</span>
      {band && <FunnelTag band={band} short={short} />}
    </span>
  );
}

export function FunnelTag({ band, short = false }: { band: FunnelBand; short?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-2 whitespace-nowrap" title={FUNNEL_LABEL[band]}>
      <span className="inline-block size-2" style={{ background: FUNNEL_FILL[band] }} aria-hidden />
      {short ? band[0]!.toUpperCase() + band.slice(1) : FUNNEL_LABEL[band]}
    </span>
  );
}

/**
 * Pods → Reach by pod (owner, Oct 29): which pod brings the most new eyeballs into the funnel, by the
 * average daily frequency of all its ads (lowest first), with how its spend splits by each ad's band,
 * and the last 8 weeks' trend.
 */
export function PodReach({ rows, error, retry, targets, shown }: { rows: PodRow[] | undefined; error: Error | null; retry: () => void; targets: Targets; shown: string[] }) {
  const pods = (rows ?? [])
    .filter((r) => r.podId != null && shown.includes(r.podId) && r.totals.spendCents > 0)
    .map((r) => ({ row: r, freq: dailyFrequency(r.totals) }))
    .sort((a, b) => (a.freq ?? Infinity) - (b.freq ?? Infinity));
  const best = pods[0]?.freq != null ? pods[0].row.podId : null;
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        title={
          <>
            Reach by pod <Info id="dailyFrequency" />
          </>
        }
        className="mb-0"
      />
      <p className="max-w-[100ch] text-sm text-ink-3">
        Average daily frequency of all the pod's ads: impressions ÷ people reached, per ad per day. Lower means more new eyeballs. Up to{" "}
        {targets.freqTopMax.toFixed(2)} is top of funnel, up to {targets.freqMiddleMax.toFixed(2)} middle, above that bottom (Settings → Targets).
      </p>
      <LoadError error={error} retry={retry} what="the pods" loading={!rows} rows={4} />
      {rows && pods.length === 0 && <Empty>No pod ads spent in this period.</Empty>}
      {pods.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="kicker text-left">
              <tr className="border-b-2 border-divider">
                <th className="py-2 pr-3 font-normal">Pod</th>
                <th className="py-2 pr-3 text-right font-normal">Avg daily frequency</th>
                <th className="py-2 pr-3 font-normal">Funnel</th>
                <th className="w-[38%] py-2 pr-3 font-normal">Spend by each ad's band</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {pods.map(({ row, freq }) => {
                const band = funnelBand(freq, targets);
                return (
                  <tr key={row.podId} className={`border-b border-divider ${row.podId === best ? "bg-surface" : ""}`}>
                    <td className="py-2.5 pr-3">
                      <span className="flex flex-wrap items-center gap-2">
                        <PodChip podId={row.podId} />
                        {row.podId === best && <span className="text-xs font-bold text-ink">★ Most new eyeballs</span>}
                      </span>
                    </td>
                    <td className="num py-2.5 pr-3 text-right text-lg font-extrabold text-ink">{freqText(freq)}</td>
                    <td className="py-2.5 pr-3">{band ? <FunnelTag band={band} /> : <span className="text-ink-3">—</span>}</td>
                    <td className="py-2.5 pr-3">
                      <SpendBar split={row.funnelSpend} />
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <a className="link text-sm" href={`#/rankings?${qs({ pod: row.podId ?? "", sort: "freq" })}`}>
                        Its ads →
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
            {(["top", "middle", "bottom"] as const).map((b) => (
              <FunnelTag key={b} band={b} />
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2" style={{ background: FUNNEL_FILL.unknown }} aria-hidden /> No reach from Meta
            </span>
          </div>
        </div>
      )}
      <FrequencyTrend shown={pods.map((p) => p.row.podId!)} targets={targets} />
    </section>
  );
}

function SpendBar({ split }: { split: PodRow["funnelSpend"] }) {
  const total = split.top + split.middle + split.bottom + split.unknown;
  if (total <= 0) return <span className="text-ink-3">—</span>;
  const parts = (["top", "middle", "bottom", "unknown"] as const).filter((k) => split[k] > 0);
  const label = (k: (typeof parts)[number]) => (k === "unknown" ? "No reach" : FUNNEL_LABEL[k]);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-3 w-full overflow-hidden" role="img" aria-label={parts.map((k) => `${label(k)} ${Math.round((split[k] / total) * 100)}%`).join(", ")}>
        {parts.map((k) => (
          <span key={k} style={{ width: `${(split[k] / total) * 100}%`, background: FUNNEL_FILL[k] }} title={`${label(k)}: ${money(split[k], { compact: true })} (${Math.round((split[k] / total) * 100)}%)`} />
        ))}
      </div>
      <span className="text-xs text-ink-3">
        {parts
          .filter((k) => k !== "unknown")
          .map((k) => `${k[0]!.toUpperCase()}${k.slice(1)} ${Math.round((split[k] / total) * 100)}%`)
          .join(" · ")}
      </span>
    </div>
  );
}

/**
 * The last 8 weeks' average daily frequency as a table (owner, Oct 30: a table, not a chart): one row
 * per pod, one column per Monday-start week, each cell with its funnel band.
 */
function FrequencyTrend({ shown, targets }: { shown: string[]; targets: Targets }) {
  const { data, error, retry } = useApi<FrequencyTrendResponse>("/api/pods/frequency");
  if (error) return <LoadError error={error} retry={retry} what="the weekly frequency" />;
  if (!data) return <LoadError error={null} loading rows={4} />;
  const rows = shown
    .filter((id) => data.pods[id])
    .map((id) => ({ id, values: data.pods[id]!.map((p) => (p.reach > 0 ? p.reachImpressions / p.reach : null)) }));
  if (data.weeks.length === 0 || rows.length === 0) return null;
  const last = data.weeks.length - 1;
  return (
    <div className="mt-2">
      <h3 className="kicker mb-1">Avg daily frequency by week · last 8 weeks</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="kicker text-left">
            <tr className="border-b-2 border-divider">
              <th className="py-2 pr-3 font-normal">Pod</th>
              {data.weeks.map((w, i) => (
                <th key={w} className="py-2 pr-3 text-right font-normal whitespace-nowrap">
                  {i === last ? "This week" : shortDate(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-divider">
                <td className="py-2 pr-3">
                  <PodChip podId={r.id} />
                </td>
                {r.values.map((v, i) => {
                  const band = funnelBand(v, targets);
                  return (
                    <td key={data.weeks[i]} className="py-2 pr-3 text-right align-top">
                      <span className="num block font-semibold text-ink">{freqText(v)}</span>
                      {band && (
                        <span className="inline-flex justify-end">
                          <FunnelTag band={band} short />
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-ink-3">Weeks start Monday; this week runs to the last synced day. — = the pod's ads didn't run that week.</p>
    </div>
  );
}
