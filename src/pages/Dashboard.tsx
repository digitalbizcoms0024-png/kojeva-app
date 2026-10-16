import type { MetaResponse, PodsResponse, RankingsResponse } from "../../shared/api.ts";
import { cpa, roas } from "../../shared/metrics.ts";
import { qs, RANGE_LABELS, useApi } from "../api.ts";
import { Card, CpaValue, Empty, HitBadge, PodChip, RoasValue, Segmented, Stat, Thumb } from "../components/ui.tsx";
import { int, money, pct } from "../format.ts";

type Range = keyof typeof RANGE_LABELS;

export function DashboardPage({ meta, range, setRange }: { meta: MetaResponse; range: Range; setRange: (r: Range) => void }) {
  const top = useApi<RankingsResponse>(`/api/rankings?${qs({ range, sort: "spend", limit: 5 })}`);
  const pods = useApi<PodsResponse>(`/api/pods?${qs({ range })}`);
  const t = top.data?.totals;
  const unassigned = pods.data?.rows.find((r) => !r.podId);
  const unassignedShare = t && unassigned && t.spendCents > 0 ? unassigned.totals.spendCents / t.spendCents : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Overview</h1>
          <p className="text-sm text-ink-3">How the account and each pod are doing.</p>
        </div>
        <Segmented value={range} onChange={setRange} options={(Object.keys(RANGE_LABELS) as Range[]).map((value) => ({ value, label: RANGE_LABELS[value] }))} />
      </div>

      <Card className="grid grid-cols-2 divide-line sm:grid-cols-5 sm:divide-x">
        <Stat label="Spend">{money(t?.spendCents, { compact: true })}</Stat>
        <Stat label="Purchases">{int(t?.purchases)}</Stat>
        <Stat label="CPA" sub={`Target $${meta.targets.targetCpa}`}>
          {t ? <CpaValue value={cpa(t)} target={meta.targets.targetCpa} /> : "—"}
        </Stat>
        <Stat label="ROAS · Meta" sub={`Target ${meta.targets.targetRoas}`}>
          {t ? <RoasValue value={roas(t)} target={meta.targets.targetRoas} /> : "—"}
        </Stat>
        <Stat label="ROAS · Triple Whale" sub="Not connected (Phase 4)">—</Stat>
      </Card>

      {unassignedShare != null && unassignedShare > 0.05 && (
        <a href="#/tagging" className="block rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-ink">
          <b>{pct(unassignedShare, 0)} of spend</b> ({money(unassigned!.totals.spendCents, { compact: true })}) is on ads with no pod, so pod rankings leave it out. <span className="text-accent underline">Tag them →</span>
        </a>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-2">Pod leaderboard</h2>
        {pods.error && <Empty>{pods.error.message}</Empty>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {pods.data?.rows
            .filter((r) => r.podId)
            .sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1))
            .map((r) => (
              <Card key={r.podId} className="p-4">
                <PodChip podId={r.podId} />
                <div className="mt-3 flex items-baseline justify-between">
                  <div>
                    <div className="num text-2xl font-semibold text-ink">{pct(r.hitRate, 0)}</div>
                    <div className="text-xs text-ink-3">hit rate · {r.hits}/{r.hits + r.misses}</div>
                  </div>
                  <div className="num text-right text-sm">
                    <div className="text-ink">{money(r.totals.spendCents, { compact: true })}</div>
                    <div className="text-xs text-ink-3">spend</div>
                  </div>
                </div>
                <div className="num mt-3 flex justify-between text-sm">
                  <span className="text-ink-3">
                    CPA <CpaValue value={cpa(r.totals)} target={meta.targets.targetCpa} />
                  </span>
                  <span className="text-ink-3">
                    ROAS <RoasValue value={roas(r.totals)} target={meta.targets.targetRoas} />
                  </span>
                </div>
              </Card>
            ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-2">Top 5 by spend</h2>
          <a href="#/rankings" className="text-sm text-accent">All rankings →</a>
        </div>
        <Card className="divide-y divide-line">
          {top.data?.items.map((p, i) => (
            <div key={p.postId} className="flex items-center gap-3 px-4 py-3">
              <span className="num w-5 text-sm text-ink-3">{i + 1}</span>
              <Thumb mediaType={p.mediaType} label="" url={p.thumbnailUrl} className="h-12 w-9 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink">{p.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <PodChip podId={p.assignment.podId} />
                  <HitBadge status={p.hit} />
                </div>
              </div>
              <div className="num hidden gap-4 text-sm sm:flex">
                <span className="text-ink">{money(p.totals.spendCents, { compact: true })}</span>
                <CpaValue value={cpa(p.totals)} target={meta.targets.targetCpa} />
                <RoasValue value={roas(p.totals)} target={meta.targets.targetRoas} />
              </div>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
