import { useState } from "react";
import { money, shortDate } from "../format.ts";

const W = 240;
const H = 40;

/** One pod's daily spend as a thin line, with a hover readout per day. */
export function Sparkline({ values, days, color, label }: { values: number[]; days: string[]; color: string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const x = (i: number) => (i / (values.length - 1)) * (W - 4) + 2;
  const y = (v: number) => H - 3 - (v / max) * (H - 8);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(values.length - 1, Math.round(((e.clientX - r.left) / r.width) * (values.length - 1)))));
  };
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-10 w-full"
        role="img"
        aria-label={`${label}: daily spend, last ${values.length} days`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--ink-3)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute -top-8 z-10 border border-divider bg-page px-2 py-1 text-xs whitespace-nowrap text-ink"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > values.length / 2 ? "-100%" : "0"})` }}
        >
          {shortDate(days[hover])} · <b className="num">{money(values[hover])}</b>
        </div>
      )}
    </div>
  );
}
