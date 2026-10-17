import { useState } from "react";
import type { MetaResponse } from "../../shared/api.ts";
import { RANGE_LABELS } from "../api.ts";
import { dateTime, shortDate } from "../format.ts";

/** "week" | "month" | "mtd" | "all", or a custom range written as "custom:YYYY-MM-DD:YYYY-MM-DD". */
export type Range = keyof typeof RANGE_LABELS | `custom:${string}:${string}`;

export function customRange(r: Range): { from: string; to: string } | null {
  const m = /^custom:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(r);
  return m ? { from: m[1]!, to: m[2]! } : null;
}

/** Short label for headings: "in the last 7 days", "Oct 1 – Oct 15", … */
export function rangeLabel(r: Range): string {
  const c = customRange(r);
  if (c) return `${shortDate(c.from)} – ${shortDate(c.to)}`;
  return r === "week" ? "in the last 7 days" : r === "month" ? "in the last 30 days" : r === "mtd" ? "this month to date" : "of all time";
}

export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** The period just before the selected one, for "vs last week" deltas. */
export function previousPeriod(range: Range, latest: string | null): { from: string; to: string; label: string } | null {
  const custom = customRange(range);
  if (custom) {
    const days = Math.round((Date.parse(custom.to) - Date.parse(custom.from)) / 86_400_000) + 1;
    return { from: shiftDay(custom.from, -days), to: shiftDay(custom.from, -1), label: `vs previous ${days} days` };
  }
  if (!latest || range === "all") return null;
  if (range === "mtd") {
    // The same days of the previous month (Oct 1–16 → Sep 1–16), clamped to that month's end.
    const [y, m, d] = latest.split("-").map(Number) as [number, number, number];
    const prevFirst = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    const prevLast = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
    return { from: prevFirst, to: `${prevFirst.slice(0, 8)}${String(Math.min(d, prevLast)).padStart(2, "0")}`, label: "vs same days last month" };
  }
  const days = range === "week" ? 7 : 30;
  return { from: shiftDay(latest, -2 * days + 1), to: shiftDay(latest, -days), label: range === "week" ? "vs previous 7 days" : "vs previous 30 days" };
}

function RangeSwitch({ range, setRange, latest }: { range: Range; setRange: (r: Range) => void; latest: string | null }) {
  const custom = customRange(range);
  const today = latest ?? new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(custom?.from ?? today);
  const [to, setTo] = useState(custom?.to ?? today);
  const opt = (selected: boolean) =>
    `-ml-px border px-3 py-1.5 text-sm transition first:ml-0 ${
      selected ? "relative z-10 border-accent bg-accent text-on-accent" : "border-divider bg-page text-ink hover:bg-surface"
    }`;
  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <div className="inline-flex flex-wrap" role="tablist" aria-label="Date range">
        {(Object.keys(RANGE_LABELS) as (keyof typeof RANGE_LABELS)[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={range === k}
            className={opt(range === k)}
            onClick={() => {
              setRange(k);
              setOpen(false);
            }}
          >
            {RANGE_LABELS[k]}
          </button>
        ))}
        <button role="tab" aria-selected={!!custom} aria-expanded={open} className={opt(!!custom)} onClick={() => setOpen((o) => !o)}>
          {custom ? `${shortDate(custom.from)} – ${shortDate(custom.to)}` : "Custom"}
        </button>
      </div>
      {open && (
        <form
          className="absolute top-full right-0 z-30 mt-1 flex flex-wrap items-end gap-2 border-2 border-divider bg-page p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to && from <= to) {
              setRange(`custom:${from}:${to}`);
              setOpen(false);
            }
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            From
            <input type="date" className="field" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            To
            <input type="date" className="field" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={!from || !to || from > to}>
            Apply
          </button>
        </form>
      )}
    </div>
  );
}

/** Date range switch plus the last-sync status: the controls at the top right of every data page. */
export function HeaderControls({ meta, range, setRange }: { meta: MetaResponse; range?: Range; setRange?: (r: Range) => void }) {
  const failed = meta.lastSync?.status === "error";
  return (
    <>
      {range && setRange && <RangeSwitch range={range} setRange={setRange} latest={meta.latestDate} />}
      <a
        href="#/settings"
        className="inline-flex items-center gap-2 border border-divider px-3 py-1.5 text-[13px] text-ink-2 hover:bg-surface"
        title={meta.lastSync?.message ?? undefined}
      >
        <span className={`size-2 ${failed ? "bg-bad" : "bg-good"}`} aria-hidden />
        {failed ? "Last sync failed · " : "Last synced "}
        {dateTime(meta.lastSync?.finishedAt)} · Meta
      </a>
    </>
  );
}
