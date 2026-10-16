import { useState } from "react";
import type { InsightDimension, InsightsResponse, MetaResponse } from "../../shared/api.ts";
import { cpa, roas } from "../../shared/metrics.ts";
import { ANGLES, FORMATS } from "../../shared/taxonomy.ts";
import { qs, RANGE_LABELS, useApi } from "../api.ts";
import { Card, CpaValue, Empty, PodChip, RoasValue, Segmented, Select } from "../components/ui.tsx";
import { money, pct } from "../format.ts";
import { ConceptsTable } from "./PodsView.tsx";

type Range = keyof typeof RANGE_LABELS;

const LABELS: Record<InsightDimension, Record<string, string>> = { angle: ANGLES, format: FORMATS, atria_theme: {}, atria_desire: {} };
const DIM_NAME: Record<InsightDimension, string> = { angle: "Angle", format: "Format", atria_theme: "Atria theme", atria_desire: "Core desire" };
const isAtria = (d: InsightDimension) => d === "atria_theme" || d === "atria_desire";

/** Fewer decided tests than this and a hit rate is shown as a hint, not a verdict. */
const MIN_DECIDED = 3;

export function InsightsPage({ meta, range, setRange }: { meta: MetaResponse; range: Range; setRange: (r: Range) => void }) {
  const [dimension, setDimension] = useState<InsightDimension>("angle");
  const [pod, setPod] = useState("");
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const { data, error } = useApi<InsightsResponse>(`/api/insights?${qs({ range, dimension, pod })}`);
  const labels = LABELS[dimension];
  const name = (v: string | null) => (v == null ? (isAtria(dimension) ? "Not tagged by Atria" : `No ${dimension}`) : (labels[v] ?? v));
  // Atria rows overlap (a concept sits under each of its themes), so count concepts once.
  const untagged = data?.rows.find((r) => r.value === null)?.concepts ?? 0;
  const total = isAtria(dimension) ? null : (data?.rows.reduce((n, r) => n + r.concepts, 0) ?? 0);
  const tagged = total == null ? 0 : total - untagged;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Creative insights</h1>
          <p className="max-w-[70ch] text-sm text-ink-3">
            Which angles and formats win, measured on concepts and their test results. Tags are read from concept and ad names; correct any in
            Needs Tagging and the hand-set tag wins.
          </p>
        </div>
        <Segmented value={range} onChange={setRange} options={(Object.keys(RANGE_LABELS) as Range[]).map((value) => ({ value, label: RANGE_LABELS[value] }))} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={dimension}
          onChange={(d) => {
            setDimension(d);
            setOpen(undefined);
          }}
          options={[
            { value: "angle", label: "By angle" },
            { value: "format", label: "By format" },
            { value: "atria_theme", label: "By Atria theme" },
            { value: "atria_desire", label: "By core desire" },
          ]}
        />
        <Select
          label="Pod"
          value={pod}
          onChange={(v) => {
            setPod(v);
            setOpen(undefined);
          }}
          options={[{ value: "", label: "All" }, ...meta.pods.map((p) => ({ value: p.id, label: p.name }))]}
        />
        {data && total != null && total > 0 && (
          <span className="num text-xs text-ink-3">
            {total} concepts · {pct(tagged / total, 0)} have {dimension === "angle" ? "an angle" : "a format"}
          </span>
        )}
        {data && isAtria(dimension) && (
          <span className="text-xs text-ink-3">A concept appears under each of its Atria tags, so rows overlap and don't add up.</span>
        )}
      </div>

      <Card className="overflow-hidden">
        {error && <Empty>Couldn't load insights: {error.message}</Empty>}
        {data && data.rows.length === 0 && <Empty>No concepts started testing in this period.</Empty>}
        {data && data.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-ink-3">
                <tr>
                  <th className="px-4 py-2 font-medium">{DIM_NAME[dimension]}</th>
                  <th className="px-3 py-2 font-medium">Concepts</th>
                  <th className="w-[28%] px-3 py-2 font-medium">Hit rate</th>
                  <th className="px-3 py-2 text-right font-medium">Test CPA</th>
                  <th className="px-3 py-2 text-right font-medium">Test ROAS</th>
                  <th className="px-3 py-2 text-right font-medium">Test spend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((r) => {
                  const decided = r.hits + r.misses;
                  const thin = decided < MIN_DECIDED;
                  const isOpen = open === r.value;
                  return (
                    <tr
                      key={r.value ?? "none"}
                      onClick={() => setOpen(isOpen ? undefined : r.value)}
                      className={`cursor-pointer transition hover:bg-surface-2 ${isOpen ? "bg-accent-soft/40" : ""} ${r.value === null ? "text-ink-3" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <div className={`font-medium ${r.value === null ? "text-ink-3" : "text-ink"}`}>
                          <span aria-hidden className="mr-1 text-ink-3">{isOpen ? "▾" : "▸"}</span>
                          {name(r.value)}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.pods.slice(0, 4).map((p) => (
                            <span key={p.podId} className="inline-flex items-center gap-1 text-[11px] text-ink-3">
                              <PodChip podId={p.podId} />
                              <span className="num">{p.concepts}</span>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="num px-3 py-3 text-ink">
                        {r.concepts}
                        {r.testing > 0 && <span className="text-xs text-ink-3"> · {r.testing} testing</span>}
                      </td>
                      <td className="px-3 py-3">
                        {r.hitRate == null ? (
                          <span className="text-xs text-ink-3">No decided tests yet</span>
                        ) : (
                          <div className="flex items-center gap-2" title={`${r.hits} hits of ${decided} decided`}>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                              <div
                                className={`h-full rounded-full ${thin ? "bg-ink-3/50" : "bg-accent"}`}
                                style={{ width: `${Math.max(r.hitRate * 100, r.hitRate > 0 ? 3 : 0)}%` }}
                              />
                            </div>
                            <span className="num w-24 shrink-0 text-xs text-ink">
                              {pct(r.hitRate, 0)} <span className="text-ink-3">· {r.hits}/{decided}</span>
                            </span>
                          </div>
                        )}
                        {thin && r.hitRate != null && <div className="mt-0.5 text-[11px] text-ink-3">Few tests, treat as a hint</div>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <CpaValue value={cpa(r.window)} target={meta.targets.targetCpa} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <RoasValue value={roas(r.window)} target={meta.targets.targetRoas} />
                      </td>
                      <td className="num px-3 py-3 text-right text-ink">{money(r.window.spendCents, { compact: true })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open !== undefined && (
        <ConceptsTable
          key={`${dimension}:${open}:${pod}`}
          range={range}
          targets={meta.targets}
          pods={meta.pods.map((p) => ({ podId: p.id, name: p.name }))}
          filter={{ [dimension]: open ?? "none", pod }}
          title={name(open)}
        />
      )}
      <p className="text-xs text-ink-3">
        A concept counts toward the period in which it first spent. Test CPA, ROAS and spend sum each concept's judging window (first spend to
        day {meta.targets.testWindowDays} or the day it qualified). Grey bars mark fewer than {MIN_DECIDED} decided tests.
      </p>
    </div>
  );
}
