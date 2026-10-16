import { useState } from "react";
import type { ConceptsResponse, PodRow, PodsResponse } from "../../shared/api.ts";
import { qs, useApi } from "../api.ts";
import { cpa, roas, type Targets } from "../../shared/metrics.ts";
import { ANGLES, FORMATS } from "../../shared/taxonomy.ts";
import { Card, CpaValue, Empty, HitBadge, PodChip, RoasValue, Select } from "../components/ui.tsx";
import { int, money, pct, shortDate } from "../format.ts";

type Props = { data: PodsResponse | null; error: Error | null; targets: Targets };

function PodCard({ r, targets }: { r: PodRow; targets: Targets }) {
  return (
    <Card className={`p-4 ${r.kind === "agency" ? "border-dashed" : ""}`}>
      <div className="flex items-center justify-between">
        <PodChip podId={r.podId} />
        <span className="text-xs text-ink-3">{r.kind === "agency" ? "before pods" : `${r.editors.filter((e) => e.editorId).length} editors`}</span>
      </div>
      <div className="mt-4 text-xs text-ink-3">Hit rate</div>
      <div className="num text-3xl font-semibold text-ink">{pct(r.hitRate, 0)}</div>
      <div className="text-xs text-ink-3">
        {r.hits} {r.hits === 1 ? "hit" : "hits"} of {r.hits + r.misses} decided · {r.testing} testing
      </div>
      <dl className="num mt-4 grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-ink-3">Spend</dt>
        <dd className="text-right text-ink">{money(r.totals.spendCents, { compact: true })}</dd>
        <dt className="text-ink-3">Purchases</dt>
        <dd className="text-right text-ink">{int(r.totals.purchases)}</dd>
        <dt className="text-ink-3">CPA</dt>
        <dd className="text-right">
          <CpaValue value={cpa(r.totals)} target={targets.targetCpa} />
        </dd>
        <dt className="text-ink-3">ROAS</dt>
        <dd className="text-right">
          <RoasValue value={roas(r.totals)} target={targets.targetRoas} />
        </dd>
        <dt className="text-ink-3">New concepts</dt>
        <dd className="text-right text-ink">{int(r.concepts)}</dd>
      </dl>
    </Card>
  );
}

export function ConceptsTable({
  range,
  targets,
  pods,
  filter = {},
  title = "Concepts tested",
}: {
  range: string;
  targets: Targets;
  pods: { podId: string | null; name: string }[];
  filter?: { angle?: string; format?: string; pod?: string };
  title?: string;
}) {
  const [pod, setPod] = useState(filter.pod ?? "");
  const { data, error } = useApi<ConceptsResponse>(`/api/concepts?${qs({ range, pod, angle: filter.angle, format: filter.format })}`);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-ink-3 uppercase">
          {title}
          {data ? ` · ${data.rows.length}` : ""}
        </h3>
        <Select
          label="Pod"
          value={pod}
          onChange={setPod}
          options={[{ value: "", label: "All" }, ...pods.filter((p) => p.podId).map((p) => ({ value: p.podId!, label: p.name }))]}
        />
      </div>
      {error && <Empty>Couldn't load concepts: {error.message}</Empty>}
      {data && data.rows.length === 0 && <Empty>No concepts started testing in this period.</Empty>}
      {data && data.rows.length > 0 && (
        <div className="max-h-[32rem] overflow-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-3">
              <tr>
                <th className="px-3 py-2 font-medium">Pod</th>
                <th className="px-3 py-2 font-medium">Concept</th>
                <th className="px-3 py-2 font-medium">Judged on</th>
                <th className="px-3 py-2 text-right font-medium">Spend</th>
                <th className="px-3 py-2 text-right font-medium">CPA</th>
                <th className="px-3 py-2 text-right font-medium">ROAS</th>
                <th className="px-3 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.rows.map((k) => (
                <tr key={k.conceptId}>
                  <td className="px-3 py-2">
                    <PodChip podId={k.podId} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-ink">{k.label}</div>
                    <div className="text-xs text-ink-3">
                      {k.adsetName} · {k.ads} {k.ads === 1 ? "ad" : "ads"} · {money(k.allTime.spendCents, { compact: true })} all-time
                    </div>
                    {(k.angle || k.format) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {k.angle && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent">{ANGLES[k.angle] ?? k.angle}</span>}
                        {k.format && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">{FORMATS[k.format] ?? k.format}</span>}
                      </div>
                    )}
                  </td>
                  <td className="num px-3 py-2 whitespace-nowrap text-ink-2">
                    {shortDate(k.firstSpend)} – {shortDate(k.windowEnd)}
                  </td>
                  <td className="num px-3 py-2 text-right text-ink">{money(k.window.spendCents)}</td>
                  <td className="px-3 py-2 text-right">
                    <CpaValue value={cpa(k.window)} target={targets.targetCpa} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <RoasValue value={roas(k.window)} target={targets.targetRoas} />
                  </td>
                  <td className="px-3 py-2">
                    <HitBadge status={k.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PodsTab({ data, error, targets, range }: Props & { range: string }) {
  if (error) return <Empty>Couldn't load pods: {error.message}</Empty>;
  if (!data) return <Empty>Loading…</Empty>;
  const pods = data.rows.filter((r) => r.kind === "pod").sort((a, b) => b.totals.spendCents - a.totals.spendCents);
  const agency = data.rows.find((r) => r.kind === "agency");
  const unassigned = data.rows.find((r) => r.kind === "unassigned");
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {pods.map((r) => (
          <PodCard key={r.podId} r={r} targets={targets} />
        ))}
      </div>
      {agency && agency.totals.spendCents > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-3 uppercase">Before the in-house pods</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <PodCard r={agency} targets={targets} />
          </div>
        </div>
      )}
      {unassigned && unassigned.totals.spendCents > 0 && (
        <p className="text-sm text-ink-2">
          <b className="text-ink">{money(unassigned.totals.spendCents, { compact: true })}</b> of spend in this period is on ads the hub
          can't credit to a pod or the agency ({int(unassigned.concepts)} new concepts). See{" "}
          <a href="#/tagging" className="text-accent underline">
            Needs tagging
          </a>
          .
        </p>
      )}
      <ConceptsTable range={range} targets={targets} pods={data.rows} />
      <p className="text-xs text-ink-3">
        A concept is one testing ad set (combined ones like "Batch 3 & 5" are split by ad name). It qualifies once one of its ads has spent $
        {targets.minTestSpend}, and is judged on all its ads from first spend to day {targets.testWindowDays} or the day it qualified, whichever is
        later. Hit = CPA ≤ ${targets.targetCpa} {targets.hitRule === "both" ? "and" : "or"} ROAS ≥ {targets.targetRoas} over that window. Concepts
        count toward the period in which they first spent.
      </p>
    </div>
  );
}

export function EditorsTab({ data, error, targets }: Props) {
  if (error) return <Empty>Couldn't load editors: {error.message}</Empty>;
  if (!data) return <Empty>Loading…</Empty>;
  const rows = data.rows
    .flatMap((p) => p.editors.filter((e) => e.editorId).map((e) => ({ ...e, podId: p.podId })))
    .sort((a, b) => b.totals.spendCents - a.totals.spendCents);
  if (rows.length === 0) return <Empty>No editors have assigned ads in this period.</Empty>;
  return (
    <div className="overflow-x-auto p-4">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-3">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-medium">#</th>
            <th className="py-2 pr-3 font-medium">Editor</th>
            <th className="py-2 pr-3 font-medium">Pod</th>
            <th className="py-2 pr-3 text-right font-medium">Spend</th>
            <th className="py-2 pr-3 text-right font-medium">Purchases</th>
            <th className="py-2 pr-3 text-right font-medium">CPA</th>
            <th className="py-2 pr-3 text-right font-medium">ROAS</th>
            <th className="py-2 text-right font-medium">New concepts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((e, i) => (
            <tr key={e.editorId}>
              <td className="num py-2 pr-3 text-ink-3">{i + 1}</td>
              <td className="py-2 pr-3 font-medium text-ink">{e.name}</td>
              <td className="py-2 pr-3">
                <PodChip podId={e.podId} />
              </td>
              <td className="num py-2 pr-3 text-right text-ink">{money(e.totals.spendCents, { compact: true })}</td>
              <td className="num py-2 pr-3 text-right text-ink">{int(e.totals.purchases)}</td>
              <td className="py-2 pr-3 text-right">
                <CpaValue value={cpa(e.totals)} target={targets.targetCpa} />
              </td>
              <td className="py-2 pr-3 text-right">
                <RoasValue value={roas(e.totals)} target={targets.targetRoas} />
              </td>
              <td className="num py-2 text-right text-ink">{int(e.concepts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
