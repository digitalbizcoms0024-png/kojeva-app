import { useState } from "react";
import type { FrequencyTrendResponse, PodRow } from "../../shared/api.ts";
import { dailyFrequency, funnelBand, type FunnelBand, type Targets, type Totals } from "../../shared/metrics.ts";
import { podById } from "../../shared/taxonomy.ts";
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

const W = 640;
const H = 200;
const PAD = { l: 40, r: 12, t: 12, b: 22 };

/** The last 8 weeks' average daily frequency, one line per pod, one y-axis, with the band lines. */
function FrequencyTrend({ shown, targets }: { shown: string[]; targets: Targets }) {
  const { data, error, retry } = useApi<FrequencyTrendResponse>("/api/pods/frequency");
  const [hover, setHover] = useState<number | null>(null);
  if (error) return <LoadError error={error} retry={retry} what="the frequency trend" />;
  if (!data) return <LoadError error={null} loading rows={4} />;
  const n = data.weeks.length;
  const lines = shown
    .filter((id) => data.pods[id])
    .map((id) => ({ id, values: data.pods[id]!.map((p) => (p.reach > 0 ? p.reachImpressions / p.reach : null)) }));
  if (n === 0 || lines.length === 0) return null;
  const vals = lines.flatMap((l) => l.values.filter((v): v is number => v != null));
  const lo = Math.min(1, ...vals);
  const hi = Math.max(targets.freqMiddleMax + 0.1, ...vals);
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v: number) => PAD.t + innerH - ((v - lo) / (hi - lo)) * innerH;
  const path = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v == null) pen = false;
      else {
        d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      }
    });
    return d;
  };
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / innerW) * (n - 1)))));
  };
  return (
    <div className="mt-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="kicker">Avg daily frequency by week · last 8 weeks</span>
        <span className="flex flex-wrap gap-3 text-xs text-ink-3">
          {lines.map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1">
              <span className="inline-block h-0.5 w-4" style={{ background: `var(--pod-${l.id})` }} aria-hidden />
              {podById(l.id)?.name ?? l.id}
            </span>
          ))}
        </span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[900px]" role="img" aria-label="Average daily frequency by week per pod" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {[targets.freqTopMax, targets.freqMiddleMax].map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="3 3" />
              <text x={PAD.l + 4} y={y(v) - 3} fontSize={10} fill="var(--ink-3)" stroke="var(--page)" strokeWidth={3} paintOrder="stroke">
                {v === targets.freqTopMax ? `top ≤ ${v.toFixed(2)}` : `middle ≤ ${v.toFixed(2)}`}
              </text>
            </g>
          ))}
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)">
                {v.toFixed(2)}
              </text>
            </g>
          ))}
          {data.weeks.map((w, i) => (
            <text key={w} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={10} fill="var(--ink-3)">
              {shortDate(w)}
            </text>
          ))}
          {lines.map((l) => (
            <path key={l.id} d={path(l.values)} fill="none" stroke={`var(--pod-${l.id})`} strokeWidth={2} strokeLinejoin="round" />
          ))}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + innerH} stroke="var(--ink-3)" strokeWidth={1} />}
          {hover != null &&
            lines.map((l) => {
              const v = l.values[hover];
              return v == null ? null : <circle key={l.id} cx={x(hover)} cy={y(v)} r={4} fill={`var(--pod-${l.id})`} stroke="var(--page)" strokeWidth={2} />;
            })}
        </svg>
        {hover != null && (
          <div className="pointer-events-none absolute top-0 left-12 border border-divider bg-page px-3 py-2 text-xs shadow">
            <div className="mb-1 font-bold text-ink">Week of {shortDate(data.weeks[hover]!)}</div>
            {lines
              .map((l) => ({ l, v: l.values[hover] ?? null }))
              .sort((a, b) => (a.v ?? Infinity) - (b.v ?? Infinity))
              .map(({ l, v }) => {
                const band = funnelBand(v, targets);
                return (
                  <div key={l.id} className="flex items-center justify-between gap-4">
                    <PodChip podId={l.id} />
                    <span className="num text-ink">
                      {freqText(v)} {band && <span className="text-ink-3">· {band}</span>}
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
