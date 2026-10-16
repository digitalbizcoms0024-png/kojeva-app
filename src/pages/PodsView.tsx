import type { PodRow, PodsResponse } from "../../shared/api.ts";
import { cpa, roas, type Targets } from "../../shared/metrics.ts";
import { Card, CpaValue, Empty, PodChip, RoasValue } from "../components/ui.tsx";
import { int, money, pct } from "../format.ts";

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

export function PodsTab({ data, error, targets }: Props) {
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
      <p className="text-xs text-ink-3">
        Hit = a new concept reaches CPA ≤ ${targets.targetCpa} {targets.hitRule === "both" ? "and" : "or"} ROAS ≥ {targets.targetRoas} over its first{" "}
        {targets.testWindowDays} days, with at least ${targets.minTestSpend} spend. Concepts count toward the period in which they first spent.
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
