import type { LaunchesResponse } from "../../shared/api.ts";
import { useApi } from "../api.ts";
import { shortDate } from "../format.ts";
import { shiftDay } from "./HeaderControls.tsx";
import { Empty, PodChip, SectionTitle } from "./ui.tsx";

export type LaunchCell = { podId: string; week: string };

/**
 * New concepts per pod per Monday–Sunday week (first day of spend), last 8 weeks. Shading deepens
 * with the count; every cell shows its number. Clicking a cell selects that pod and week.
 */
export function LaunchCadence({ selected, onSelect }: { selected: LaunchCell | null; onSelect: (c: LaunchCell | null) => void }) {
  const { data, error } = useApi<LaunchesResponse>("/api/launches?weeks=8");
  if (error) return <Empty>{error.message}</Empty>;
  if (!data) return null;
  const max = Math.max(1, ...data.rows.flatMap((r) => r.counts));
  const current = data.weeks.length - 1;
  const rows = data.rows.filter((r) => r.kind === "pod" || r.counts.some((n) => n > 0));
  const totals = data.weeks.map((_, i) => rows.filter((r) => r.kind === "pod").reduce((n, r) => n + r.counts[i]!, 0));
  return (
    <section>
      <SectionTitle title="Concepts launched per week" right="By first day of spend · weeks run Monday–Sunday · click a number for its concepts" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed text-sm">
          <thead className="kicker">
            <tr className="border-b-2 border-divider">
              <th className="w-36 py-2 pr-3 text-left font-normal">Pod</th>
              {data.weeks.map((w, i) => (
                <th key={w} className={`py-2 text-center font-normal ${i === current ? "text-accent-ink" : ""}`} title={`${shortDate(w)} – ${shortDate(shiftDay(w, 6))}`}>
                  {i === current ? "This week" : shortDate(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.podId} className="border-b border-divider">
                <td className="py-1.5 pr-3">
                  <PodChip podId={r.podId} />
                </td>
                {r.counts.map((n, i) => {
                  const week = data.weeks[i]!;
                  const active = selected?.podId === r.podId && selected.week === week;
                  return (
                    <td key={week} className="p-0.5 text-center">
                      <button
                        className={`num w-full py-2 font-bold ${active ? "outline-2 outline-accent" : ""} ${n ? "text-ink" : "text-ink-3"}`}
                        style={n ? { background: `color-mix(in srgb, var(--ink) ${8 + (n / max) * 27}%, transparent)` } : undefined}
                        onClick={() => onSelect(active || n === 0 ? null : { podId: r.podId, week })}
                        disabled={n === 0}
                        aria-label={`${r.name}: ${n} concepts launched in the week of ${shortDate(week)}`}
                      >
                        {n}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-3 text-xs text-ink-3">All pods</td>
              {totals.map((n, i) => (
                <td key={data.weeks[i]} className="num py-2 text-center text-xs font-bold text-ink-2">
                  {n}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
