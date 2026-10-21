import { useEffect, useRef } from "react";
import type { ConceptsResponse, CoverageResponse, MetaResponse } from "../../shared/api.ts";
import { addTotals, cpa, isHit, ZERO_TOTALS } from "../../shared/metrics.ts";
import { qs, useApi } from "../api.ts";
import type { DrillSpec } from "../drill.ts";
import { money, pct } from "../format.ts";
import { CellAds } from "../pages/Coverage.tsx";
import { ConceptsTable } from "../pages/PodsView.tsx";
import { CpaValue } from "./ui.tsx";

const DECIDED = new Set(["hit", "late_hit", "winner", "super_winner", "miss"]);

/**
 * A group of concepts in a side card over the page (an Insights row or heatmap cell, a Coverage
 * cell, a launch week): its hit rate, test CPA and spend, then its concepts. A concept opens its
 * own card in place, with ← Back to this one. Esc, ✕ or the backdrop closes it.
 */
export function GroupDrawer({ spec, meta, onClose }: { spec: DrillSpec; meta: MetaResponse; onClose: () => void }) {
  const t = meta.targets;
  const { data } = useApi<ConceptsResponse>(`/api/concepts?${qs({ ...spec.filter, range: spec.range })}`);
  const cov = spec.coverage;
  const { data: coverage } = useApi<CoverageResponse>(cov ? `/api/coverage?${qs({ range: cov.range, pod: cov.pod })}` : null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = data?.rows ?? [];
  const decided = rows.filter((k) => DECIDED.has(k.status));
  const hits = rows.filter((k) => isHit(k.status));
  const tested = rows.reduce((acc, k) => addTotals(acc, k.window), ZERO_TOTALS);
  const nullable = (v: string | undefined) => (v == null || v === "none" ? null : v);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={spec.title}>
      <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className={`relative flex h-full w-full ${cov ? "max-w-[840px]" : "max-w-[680px]"} flex-col overflow-y-auto bg-page shadow-xl outline-none`}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b-2 border-divider bg-page px-5 py-4">
          <div className="min-w-0">
            <div className="kicker">Concepts</div>
            <h2 className="truncate text-xl font-extrabold text-ink" title={spec.title}>
              {spec.title}
            </h2>
            {data && (
              <p className="num mt-1 text-sm text-ink-2">
                {rows.length} {rows.length === 1 ? "concept" : "concepts"} · hit rate{" "}
                <b className="text-ink">{decided.length ? pct(hits.length / decided.length, 0) : "—"}</b> ({hits.length}/{decided.length}) · test CPA{" "}
                <CpaValue value={cpa(tested)} target={t.targetCpa} warnMax={t.cpaWarnMax} /> · {money(tested.spendCents)} tested
              </p>
            )}
          </div>
          <button onClick={onClose} className="btn btn-secondary shrink-0" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-6 px-5 py-5">
          {cov && coverage && (
            <section className="flex flex-col gap-2">
              <h3 className="font-extrabold text-ink">Running ads in this cell</h3>
              <CellAds data={coverage} open={{ personaId: nullable(spec.filter.persona), awareness: nullable(spec.filter.awareness) }} meta={meta} />
            </section>
          )}
          <ConceptsTable
            range={spec.range}
            targets={t}
            pods={meta.pods.map((p) => ({ podId: p.id, name: p.name }))}
            filter={spec.filter}
            title={cov ? "Every concept tested in this cell" : "Concepts"}
            inPanel
          />
        </div>
      </div>
    </div>
  );
}
