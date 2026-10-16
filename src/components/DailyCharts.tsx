import { useState } from "react";
import type { Totals } from "../../shared/metrics.ts";
import { cpa } from "../../shared/metrics.ts";
import { dollars, int, money, shortDate } from "../format.ts";

type Day = { date: string } & Totals;

const W = 560;
const H = 120;
const PAD = { l: 44, r: 8, t: 10, b: 20 };
const innerW = W - PAD.l - PAD.r;
const innerH = H - PAD.t - PAD.b;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag / 2) * 2 * mag;
}

/**
 * Daily spend (bars) and daily CPA (line, with the target as a dashed rule),
 * as two aligned charts sharing one x-axis and one hover position.
 */
export function DailyCharts({ daily, targetCpa }: { daily: Day[]; targetCpa: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (daily.length === 0) return <div className="py-8 text-center text-sm text-ink-3">No spend in this period.</div>;

  const n = daily.length;
  const step = innerW / n;
  const x = (i: number) => PAD.l + step * i + step / 2;
  const barW = Math.max(2, Math.min(18, step - 2)); // 2px gap between adjacent bars

  const spendMax = niceMax(Math.max(...daily.map((d) => d.spendCents / 100)));
  const cpas = daily.map((d) => cpa(d));
  const cpaMax = niceMax(Math.max(targetCpa * 1.5, ...cpas.map((v) => v ?? 0)));
  const ySpend = (v: number) => PAD.t + innerH - (v / spendMax) * innerH;
  const yCpa = (v: number) => PAD.t + innerH - (Math.min(v, cpaMax) / cpaMax) * innerH;

  // Break the CPA line on days with no purchases instead of drawing through them.
  const segments: string[] = [];
  let cur = "";
  cpas.forEach((v, i) => {
    if (v == null) {
      if (cur) segments.push(cur);
      cur = "";
    } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${yCpa(v).toFixed(1)}`;
  });
  if (cur) segments.push(cur);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.floor((px - PAD.l) / step))));
  };

  const tickIdx = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  const hovered = hover != null ? daily[hover] : null;

  const axis = (max: number, fmt: (v: number) => string) => (
    <>
      {[0, max / 2, max].map((v) => {
        const y = PAD.t + innerH - (v / max) * innerH;
        return (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)">
              {fmt(v)}
            </text>
          </g>
        );
      })}
      {tickIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
          {shortDate(daily[i]!.date)}
        </text>
      ))}
      {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + innerH} stroke="var(--ink-3)" strokeWidth={1} />}
    </>
  );

  return (
    <div className="relative">
      <div className="text-xs font-medium text-ink-2">Daily spend</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Daily spend bar chart">
        {axis(spendMax, (v) => `$${v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : v.toFixed(0)}`)}
        {daily.map((d, i) => {
          const y = ySpend(d.spendCents / 100);
          const h = PAD.t + innerH - y;
          const r = Math.min(4, barW / 2, h);
          // Rounded data-end, square at the baseline.
          return (
            <path
              key={d.date}
              d={`M${x(i) - barW / 2},${PAD.t + innerH}V${y + r}q0,-${r} ${r},-${r}H${x(i) + barW / 2 - r}q${r},0 ${r},${r}V${PAD.t + innerH}Z`}
              fill="var(--chart-bar)"
              opacity={hover == null || hover === i ? 1 : 0.45}
            />
          );
        })}
      </svg>

      <div className="mt-3 text-xs font-medium text-ink-2">
        Daily CPA <span className="font-normal text-ink-3">· dashed line = ${targetCpa} target</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Daily CPA line chart">
        {axis(cpaMax, (v) => `$${v.toFixed(0)}`)}
        <line x1={PAD.l} x2={W - PAD.r} y1={yCpa(targetCpa)} y2={yCpa(targetCpa)} stroke="var(--good)" strokeWidth={1.5} strokeDasharray="4 4" />
        {segments.map((d) => (
          <path key={d} d={d} fill="none" stroke="var(--chart-line)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hover != null && cpas[hover] != null && (
          <circle cx={x(hover)} cy={yCpa(cpas[hover]!)} r={4} fill="var(--chart-line)" stroke="var(--surface)" strokeWidth={2} />
        )}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-6 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: `${(x(hover!) / W) * 100}%`, transform: `translateX(${hover! > n / 2 ? "-105%" : "5%"})` }}
        >
          <div className="font-medium text-ink">{shortDate(hovered.date)}</div>
          <div className="num mt-1 grid grid-cols-[auto_auto] gap-x-3 text-ink-2">
            <span>Spend</span>
            <span className="text-right text-ink">{money(hovered.spendCents)}</span>
            <span>Purchases</span>
            <span className="text-right text-ink">{int(hovered.purchases)}</span>
            <span>CPA</span>
            <span className="text-right text-ink">{dollars(cpa(hovered))}</span>
          </div>
        </div>
      )}
    </div>
  );
}
