import type { PodRow, PodsResponse } from "../../shared/api.ts";
import { cpa, roas, twRoas, type Targets } from "../../shared/metrics.ts";
import { qs, useApi } from "../api.ts";
import { GROUPS } from "../../shared/taxonomy.ts";
import { downloadCsv, int, money, pct, plain, plainDollars, shortDate } from "../format.ts";
import { previousPeriod, type Range } from "./HeaderControls.tsx";
import { CpaValue, CsvButton, PodChip, RoasValue, SectionTitle } from "./ui.tsx";

// Built-in pods, added pods, the agency, then unassigned.
const order = (r: PodRow) => {
  const i = r.podId ? GROUPS.findIndex((g) => g.id === r.podId) : -1;
  return i < 0 ? GROUPS.length : i;
};

/** Pods, the agency and unassigned spend for the selected range, in a fixed order. */
function rowsOf(data: PodsResponse | null): PodRow[] {
  return (data?.rows ?? []).filter((r) => r.kind !== "unassigned" || r.totals.spendCents > 0).sort((a, b) => order(a) - order(b));
}

function Change({ now, before }: { now: number; before: number | undefined }) {
  if (before == null || before === 0) return <span className="text-ink-3">—</span>;
  const c = now / before - 1;
  // Spend going up or down isn't good or bad by itself, so it stays in ink.
  return (
    <span className="num text-ink-2">
      {c >= 0 ? "▲" : "▼"} {pct(Math.abs(c), 0)}
    </span>
  );
}

/** One horizontal bar split by group, each part labelled with name and share below. */
function ShareBar({ rows, total }: { rows: PodRow[]; total: number }) {
  if (total <= 0) return null;
  return (
    <div>
      <div className="flex h-4 w-full gap-0.5 overflow-hidden" role="img" aria-label="Spend share by pod">
        {rows
          .filter((r) => r.totals.spendCents > 0)
          .map((r) => (
            <div
              key={r.podId ?? "none"}
              title={`${r.name}: ${money(r.totals.spendCents)} (${pct(r.totals.spendCents / total, 0)})`}
              style={{
                width: `${(r.totals.spendCents / total) * 100}%`,
                background: r.podId ? `var(--pod-${r.podId})` : "repeating-linear-gradient(135deg, var(--line) 0 4px, var(--surface-2) 4px 8px)",
              }}
            />
          ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {rows
          .filter((r) => r.totals.spendCents > 0)
          .map((r) => (
            <span key={r.podId ?? "none"} className="num inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2.5"
                style={{ background: r.podId ? `var(--pod-${r.podId})` : "var(--line)" }}
                aria-hidden
              />
              <b className="text-ink">{r.name}</b> {pct(r.totals.spendCents / total, 0)} · {money(r.totals.spendCents, { compact: true })}
            </span>
          ))}
      </div>
    </div>
  );
}

/**
 * Spend per pod (and the agency and unassigned) for the global date range, with the change against
 * the period before. `compact` shows only the share bar (Dashboard).
 */
export function PodSpend({ range, latest, targets, compact = false }: { range: Range; latest: string | null; targets: Targets; compact?: boolean }) {
  const now = useApi<PodsResponse>(`/api/pods?${qs({ range })}`);
  const prev = previousPeriod(range, latest);
  const before = useApi<PodsResponse>(prev ? `/api/pods?${qs({ range: "custom", from: prev.from, to: prev.to })}` : null);
  const rows = rowsOf(now.data);
  const total = rows.reduce((n, r) => n + r.totals.spendCents, 0);
  const prevBy = new Map((before.data?.rows ?? []).map((r) => [r.podId ?? "none", r.totals.spendCents]));
  const period = now.data ? (now.data.from === "2000-01-01" ? "All time" : `${shortDate(now.data.from)} – ${shortDate(now.data.to)}`) : "";

  if (compact)
    return (
      <section>
        <SectionTitle
          title="Spend by pod"
          right={
            <a href="#/pods" className="link text-sm">
              Details →
            </a>
          }
        />
        <ShareBar rows={rows} total={total} />
      </section>
    );

  return (
    <section>
      <SectionTitle
        title="Spend by pod"
        right={
          <span className="flex flex-wrap items-center gap-3">
            <span>
              {period} · Meta{prev ? ` · ${prev.label}` : ""}
            </span>
            <CsvButton
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  `kojeva-spend-by-pod-${now.data?.from === "2000-01-01" ? "all" : now.data?.from}-to-${now.data?.to}.csv`,
                  ["Group", "Spend (Meta, $)", "Share (%)", "Spend previous period (Meta, $)", "Purchases (Meta)", "CPA (Meta, $)", "ROAS (Meta)", "ROAS (Triple Whale)"],
                  rows.map((r) => [
                    r.name,
                    plainDollars(r.totals.spendCents),
                    plain(total > 0 ? (r.totals.spendCents / total) * 100 : null, 1),
                    plainDollars(prevBy.get(r.podId ?? "none")),
                    r.totals.purchases,
                    plain(cpa(r.totals)),
                    plain(roas(r.totals)),
                    plain(twRoas(r.tw, r.totals.spendCents)),
                  ]),
                )
              }
            />
          </span>
        }
      />
      <ShareBar rows={rows} total={total} />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="kicker text-left">
            <tr className="border-b-2 border-divider">
              <th className="py-2 pr-3 font-normal">Group</th>
              <th className="py-2 pr-3 text-right font-normal">Spend · Meta</th>
              <th className="py-2 pr-3 text-right font-normal">Share</th>
              <th className="py-2 pr-3 text-right font-normal">{prev ? prev.label : "Change"}</th>
              <th className="py-2 pr-3 text-right font-normal">Purchases</th>
              <th className="py-2 pr-3 text-right font-normal">CPA · Meta</th>
              <th className="py-2 pr-3 text-right font-normal">ROAS · Meta</th>
              <th className="py-2 text-right font-normal">ROAS · TW</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.podId ?? "none"} className="border-b border-divider">
                <td className="py-2.5 pr-3">
                  <PodChip podId={r.podId} />
                  {r.kind === "agency" && <span className="ml-2 text-xs text-ink-3">not counted in pods</span>}
                </td>
                <td className="num py-2.5 pr-3 text-right font-bold text-ink">{money(r.totals.spendCents)}</td>
                <td className="num py-2.5 pr-3 text-right text-ink-2">{total > 0 ? pct(r.totals.spendCents / total, 0) : "—"}</td>
                <td className="py-2.5 pr-3 text-right">{prev ? <Change now={r.totals.spendCents} before={prevBy.get(r.podId ?? "none")} /> : "—"}</td>
                <td className="num py-2.5 pr-3 text-right text-ink">{int(r.totals.purchases)}</td>
                <td className="py-2.5 pr-3 text-right">
                  <CpaValue value={cpa(r.totals)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <RoasValue value={roas(r.totals)} target={targets.targetRoas} />
                </td>
                <td className="py-2.5 text-right">
                  <RoasValue value={twRoas(r.tw, r.totals.spendCents)} target={targets.targetRoas} />
                </td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="py-2.5 pr-3 text-ink">Total</td>
              <td className="num py-2.5 pr-3 text-right text-ink">{money(total)}</td>
              <td className="py-2.5 pr-3 text-right text-ink-2">100%</td>
              <td className="py-2.5 pr-3 text-right">
                {prev ? <Change now={total} before={[...prevBy.values()].reduce((n, v) => n + v, 0) || undefined} /> : "—"}
              </td>
              <td colSpan={4} />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-3">Spend change is shown in ink, not green or red: more or less spend isn't good or bad by itself.</p>
    </section>
  );
}
