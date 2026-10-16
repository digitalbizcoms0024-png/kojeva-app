import { useState } from "react";
import type { TrendPoint } from "../../shared/api.ts";
import { cpa, roas, twCpa, twRoas } from "../../shared/metrics.ts";
import { dollars, money, ratio, shortDate } from "../format.ts";

const W = 380;
const H = 150;
const PAD = { l: 40, r: 8, t: 10, b: 20 };
const innerW = W - PAD.l - PAD.r;
const innerH = H - PAD.t - PAD.b;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/** "M…L…" paths, broken wherever the value is missing (missing is not zero). */
function linePaths(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string[] {
  const out: string[] = [];
  let cur = "";
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (cur) out.push(cur);
  return out;
}

type Series = { key: string; label: string; values: (number | null)[]; dash?: string; color: string };

function Chart({
  title,
  points,
  hover,
  setHover,
  bars,
  lines = [],
  target,
  fmt,
}: {
  title: string;
  points: TrendPoint[];
  hover: number | null;
  setHover: (i: number | null) => void;
  bars?: number[];
  lines?: Series[];
  target?: { value: number; label: string };
  fmt: (v: number) => string;
}) {
  const n = points.length;
  const step = innerW / Math.max(n, 1);
  const x = (i: number) => PAD.l + step * i + step / 2;
  const all = [...(bars ?? []), ...lines.flatMap((l) => l.values.filter((v): v is number => v != null && Number.isFinite(v))), target ? target.value * 1.3 : 0];
  const max = niceMax(Math.max(...all, 0));
  const y = (v: number) => PAD.t + innerH - (Math.min(v, max) / max) * innerH;
  const barW = Math.max(1, Math.min(18, step - 2));
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.floor((px - PAD.l) / step))));
  };

  return (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="kicker">{title}</span>
        {lines.length > 0 && (
          <span className="flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
            {lines.map((l) => (
              <span key={l.key} className="inline-flex items-center gap-1">
                <svg width="18" height="6" aria-hidden>
                  <line x1="0" x2="18" y1="3" y2="3" stroke={l.color} strokeWidth="2" strokeDasharray={l.dash} />
                </svg>
                {l.label}
              </span>
            ))}
            {target && (
              <span className="inline-flex items-center gap-1">
                <svg width="18" height="6" aria-hidden>
                  <line x1="0" x2="18" y1="3" y2="3" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="2 3" />
                </svg>
                {target.label}
              </span>
            )}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)">
              {fmt(v)}
            </text>
          </g>
        ))}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H - 4} textAnchor={n > 1 && i === n - 1 ? "end" : n > 1 && i === 0 ? "start" : "middle"} fontSize={10} fill="var(--ink-3)">
            {shortDate(points[i]!.start)}
          </text>
        ))}
        {bars?.map((v, i) => (
          <rect
            key={points[i]!.start}
            x={x(i) - barW / 2}
            y={y(v)}
            width={barW}
            height={PAD.t + innerH - y(v)}
            fill="var(--chart-bar)"
            opacity={hover == null || hover === i ? 1 : 0.45}
          />
        ))}
        {target && <line x1={PAD.l} x2={W - PAD.r} y1={y(target.value)} y2={y(target.value)} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="2 3" />}
        {lines.map((l) =>
          linePaths(l.values, x, y).map((d) => (
            <path key={`${l.key}${d}`} d={d} fill="none" stroke={l.color} strokeWidth={2} strokeDasharray={l.dash} strokeLinejoin="round" />
          )),
        )}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + innerH} stroke="var(--ink-3)" strokeWidth={1} />}
        {hover != null &&
          lines.map((l) => {
            const v = l.values[hover];
            return v == null || !Number.isFinite(v) ? null : <circle key={l.key} cx={x(hover)} cy={y(v)} r={4} fill={l.color} stroke="var(--page)" strokeWidth={2} />;
          })}
      </svg>
    </div>
  );
}

/**
 * Spend, CPA and ROAS over time as three aligned charts (one y-axis each) sharing one hover.
 * Meta is the solid line, Triple Whale the dashed one; they're never combined.
 */
export function TrendCharts({ points, targetCpa, targetRoas }: { points: TrendPoint[]; targetCpa: number; targetRoas: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return <p className="py-6 text-sm text-ink-3">No spend in this period.</p>;
  const hasTw = points.some((p) => p.tw);
  const meta = (key: string, values: (number | null)[]): Series => ({ key: `meta-${key}`, label: "Meta", values, color: "var(--chart-line)" });
  const tw = (key: string, values: (number | null)[]): Series => ({ key: `tw-${key}`, label: "Triple Whale", values, color: "var(--ink-2)", dash: "6 4" });
  const cpaLines = [meta("cpa", points.map((p) => cpa(p.totals))), ...(hasTw ? [tw("cpa", points.map((p) => twCpa(p.tw, p.totals.spendCents)))] : [])];
  const roasLines = [meta("roas", points.map((p) => roas(p.totals))), ...(hasTw ? [tw("roas", points.map((p) => twRoas(p.tw, p.totals.spendCents)))] : [])];
  const h = hover != null ? points[hover]! : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="min-h-10 border-b border-divider pb-2 text-sm text-ink-2" aria-live="polite">
        {h ? (
          <span className="num flex flex-wrap gap-x-4 gap-y-1">
            <b className="text-ink">{shortDate(h.start)}</b>
            <span>
              Spend <b className="text-ink">{money(h.totals.spendCents)}</b>
            </span>
            <span>
              CPA <b className="text-ink">{dollars(cpa(h.totals))}</b> Meta{hasTw && <> · <b className="text-ink">{dollars(twCpa(h.tw, h.totals.spendCents))}</b> TW</>}
            </span>
            <span>
              ROAS <b className="text-ink">{ratio(roas(h.totals))}</b> Meta{hasTw && <> · <b className="text-ink">{ratio(twRoas(h.tw, h.totals.spendCents))}</b> TW</>}
            </span>
          </span>
        ) : (
          <span className="text-ink-3">Hover a chart to read a {points.length > 1 ? "point" : "value"}.</span>
        )}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Chart
          title="Spend · Meta"
          points={points}
          hover={hover}
          setHover={setHover}
          bars={points.map((p) => p.totals.spendCents / 100)}
          fmt={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : v.toFixed(0)}`}
        />
        <Chart
          title="CPA"
          points={points}
          hover={hover}
          setHover={setHover}
          lines={cpaLines}
          target={{ value: targetCpa, label: `Target $${targetCpa}` }}
          fmt={(v) => `$${v.toFixed(0)}`}
        />
        <Chart
          title="ROAS"
          points={points}
          hover={hover}
          setHover={setHover}
          lines={roasLines}
          target={{ value: targetRoas, label: `Target ${targetRoas}` }}
          fmt={(v) => v.toFixed(1)}
        />
      </div>
    </div>
  );
}
