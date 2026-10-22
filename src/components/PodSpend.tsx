import type { PodRow, PodsResponse } from "../../shared/api.ts";
import { cpa, roas, type Targets } from "../../shared/metrics.ts";
import { qs, useApi } from "../api.ts";
import { GROUPS } from "../../shared/taxonomy.ts";
import { downloadCsv, int, money, pct, plain, plainDollars, shortDate } from "../format.ts";
import { previousPeriod, type Range } from "./HeaderControls.tsx";
import { useState } from "react";
import { CpaValue, CsvButton, PodChip, RoasValue, SectionTitle, Segmented } from "./ui.tsx";

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
  if (before == null || (before === 0 && now === 0)) return <span className="text-ink-3">—</span>;
  // From (next to) nothing, a percentage means little ("+11,894%"): say it's new instead.
  if (before === 0 || (now > 0 && before < now / 10)) return <span className="text-ink-2" title={`Previous period: ${money(before)}`}>New</span>;
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

/** "Outside the pods: Agency $289K · Trybe $358 (89% of all spend)": what the in-house view leaves out of the bar. */
function OutsideLine({ rows, all }: { rows: PodRow[]; all: number }) {
  const spent = rows.filter((r) => r.totals.spendCents > 0);
  if (!spent.length) return null;
  const sum = spent.reduce((n, r) => n + r.totals.spendCents, 0);
  return (
    <p className="mt-2 text-xs text-ink-3">
      Outside the pods:{" "}
      {spent.map((r, i) => (
        <span key={r.podId ?? "none"} className="num">
          {i > 0 && " · "}
          <b className="text-ink-2">{r.name}</b> {money(r.totals.spendCents, { compact: true })}
        </span>
      ))}{" "}
      ({all > 0 ? pct(sum / all, 0) : "—"} of all spend)
    </p>
  );
}

export type SpendView = "inhouse" | "all";

/**
 * Spend per pod for the global date range, with the change against the period before. By default
 * only the in-house pods are in the bar and the table (the agency, partners like Trybe and uncredited
 * spend would dwarf them; one line under the bar keeps them in view); "All spend" shows everyone.
 * `compact` shows only the share bar (Dashboard).
 */
export function PodSpend({
  range,
  latest,
  targets,
  inhouseIds,
  compact = false,
  view: controlled,
}: {
  range: Range;
  latest: string | null;
  targets: Targets;
  inhouseIds: string[];
  compact?: boolean;
  /** Set by a page that switches In-house / All for all its sections; the section's own switch then hides. */
  view?: SpendView;
}) {
  const [own, setView] = useState<SpendView>("inhouse");
  const view = controlled ?? own;
  const now = useApi<PodsResponse>(`/api/pods?${qs({ range })}`);
  const prev = previousPeriod(range, latest);
  const before = useApi<PodsResponse>(prev ? `/api/pods?${qs({ range: "custom", from: prev.from, to: prev.to })}` : null);
  const all = rowsOf(now.data);
  const allTotal = all.reduce((n, r) => n + r.totals.spendCents, 0);
  const isInside = (r: PodRow) => r.podId != null && inhouseIds.includes(r.podId);
  const outside = all.filter((r) => !isInside(r));
  // The share bar and "Share" column: in-house pods only, or everyone.
  const rows = view === "inhouse" ? all.filter(isInside) : all;
  const total = rows.reduce((n, r) => n + r.totals.spendCents, 0);
  const switcher = controlled ? null : (
    <Segmented
      label="Spend by pod view"
      value={view}
      onChange={setView}
      options={[
        { value: "inhouse", label: "In-house" },
        { value: "all", label: "All spend" },
      ]}
    />
  );
  const prevBy = new Map((before.data?.rows ?? []).map((r) => [r.podId ?? "none", r.totals.spendCents]));
  const period = now.data ? (now.data.from === "2000-01-01" ? "All time" : `${shortDate(now.data.from)} – ${shortDate(now.data.to)}`) : "";

  if (compact)
    return (
      <section>
        <SectionTitle
          title="Spend by pod"
          right={
            <span className="flex flex-wrap items-center gap-3">
              {switcher}
              <a href="#/pods" className="link text-sm">
                Details →
              </a>
            </span>
          }
        />
        {view === "inhouse" && <p className="mb-2 text-xs text-ink-3">In-house pods · {money(total, { compact: true })}</p>}
        <ShareBar rows={rows} total={total} />
        {view === "inhouse" && <OutsideLine rows={outside} all={allTotal} />}
      </section>
    );

  return (
    <section>
      <SectionTitle
        title="Spend by pod"
        right={
          <span className="flex flex-wrap items-center gap-3">
            {switcher}
            <span>
              {period} · Meta{prev ? ` · ${prev.label}` : ""}
            </span>
            <CsvButton
              disabled={!all.length}
              onClick={() =>
                downloadCsv(
                  `kojeva-spend-by-pod-${now.data?.from === "2000-01-01" ? "all" : now.data?.from}-to-${now.data?.to}.csv`,
                  ["Group", "Spend (Meta, $)", "Share (%)", "Spend previous period (Meta, $)", "Purchases (Meta)", "CPA (Meta, $)", "ROAS (Meta)"],
                  all.map((r) => [
                    r.name,
                    plainDollars(r.totals.spendCents),
                    plain(allTotal > 0 ? (r.totals.spendCents / allTotal) * 100 : null, 1),
                    plainDollars(prevBy.get(r.podId ?? "none")),
                    r.totals.purchases,
                    plain(cpa(r.totals)),
                    plain(roas(r.totals)),
                  ]),
                )
              }
            />
          </span>
        }
      />
      {view === "inhouse" && <p className="mb-2 text-xs text-ink-3">In-house pods · {money(total, { compact: true })}</p>}
      <ShareBar rows={rows} total={total} />
      {view === "inhouse" && <OutsideLine rows={outside} all={allTotal} />}
      <div className="mt-4 overflow-x-auto">
        <table className="pin-first w-full text-sm">
          <thead className="kicker text-left">
            <tr className="border-b-2 border-divider">
              <th className="py-2 pr-3 font-normal">Group</th>
              <th className="py-2 pr-3 text-right font-normal">Spend · Meta</th>
              <th className="py-2 pr-3 text-right font-normal">Share</th>
              <th className="py-2 pr-3 text-right font-normal">{prev ? prev.label : "Change"}</th>
              <th className="py-2 pr-3 text-right font-normal">Purchases</th>
              <th className="py-2 pr-3 text-right font-normal">CPA · Meta</th>
              <th className="py-2 text-right font-normal">ROAS · Meta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <SpendRow key={r.podId ?? "none"} r={r} share={total > 0 ? r.totals.spendCents / total : null} before={prevBy.get(r.podId ?? "none")} prev={!!prev} targets={targets} />
            ))}
            <TotalRow label={view === "inhouse" ? "In-house total" : "Total"} rows={rows} prevBy={prevBy} prev={!!prev} />
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-3">Spend change is shown in ink, not green or red: more or less spend isn't good or bad by itself.</p>
    </section>
  );
}

function SpendRow({ r, share, before, prev, targets }: { r: PodRow; share: number | null; before: number | undefined; prev: boolean; targets: Targets }) {
  return (
    <tr className="border-b border-divider">
      <td className="py-2.5 pr-3">
        <PodChip podId={r.podId} />
        {r.kind === "agency" && <span className="ml-2 text-xs text-ink-3">not counted in pods</span>}
      </td>
      <td className="num py-2.5 pr-3 text-right font-bold text-ink">{money(r.totals.spendCents)}</td>
      <td className="num py-2.5 pr-3 text-right text-ink-2">{share == null ? "—" : pct(share, 0)}</td>
      <td className="py-2.5 pr-3 text-right">{prev ? <Change now={r.totals.spendCents} before={before} /> : "—"}</td>
      <td className="num py-2.5 pr-3 text-right text-ink">{int(r.totals.purchases)}</td>
      <td className="py-2.5 pr-3 text-right">
        <CpaValue value={cpa(r.totals)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
      </td>
      <td className="py-2.5 text-right">
        <RoasValue value={roas(r.totals)} target={targets.targetRoas} />
      </td>
    </tr>
  );
}

function TotalRow({ label, rows, prevBy, prev }: { label: string; rows: PodRow[]; prevBy: Map<string, number>; prev: boolean }) {
  const total = rows.reduce((n, r) => n + r.totals.spendCents, 0);
  const before = rows.reduce((n, r) => n + (prevBy.get(r.podId ?? "none") ?? 0), 0);
  return (
    <tr className="font-bold">
      <td className="py-2.5 pr-3 text-ink">{label}</td>
      <td className="num py-2.5 pr-3 text-right text-ink">{money(total)}</td>
      <td className="py-2.5 pr-3 text-right text-ink-2">{label === "All spend" ? "" : "100%"}</td>
      <td className="py-2.5 pr-3 text-right">{prev ? <Change now={total} before={before || undefined} /> : "—"}</td>
      <td colSpan={3} />
    </tr>
  );
}
