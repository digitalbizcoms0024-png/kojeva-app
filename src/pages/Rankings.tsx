import { useEffect, useState } from "react";
import type { MetaResponse, PodsResponse, PostDetail, PostSummary, RankingsResponse, SortKey } from "../../shared/api.ts";
import { cpa, ctr, roas, type Targets } from "../../shared/metrics.ts";
import { qs, useApi } from "../api.ts";
import { DailyCharts } from "../components/DailyCharts.tsx";
import { Card, CpaValue, Empty, HitBadge, PodChip, RoasValue, Segmented, Select, Stat, Thumb } from "../components/ui.tsx";
import { dollars, int, money, pct, shortDate } from "../format.ts";
import type { RangeKey } from "../../shared/api.ts";
import { PodsTab, EditorsTab } from "./PodsView.tsx";

type Tab = "ads" | "pods" | "editors";
type Range = Exclude<RangeKey, "custom">;

const SORTS: { value: SortKey; label: string }[] = [
  { value: "spend", label: "Spend" },
  { value: "purchases", label: "Purchases" },
  { value: "roas", label: "ROAS" },
  { value: "cpa", label: "CPA (lowest)" },
  { value: "ctr", label: "Link CTR" },
];

export function RankingsPage({ meta, range, setRange }: { meta: MetaResponse; range: Range; setRange: (r: Range) => void }) {
  const [tab, setTab] = useState<Tab>("ads");
  const [sort, setSort] = useState<SortKey>("spend");
  const [pod, setPod] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const rankings = useApi<RankingsResponse>(tab === "ads" ? `/api/rankings?${qs({ range, sort, pod, status, q })}` : null);
  const pods = useApi<PodsResponse>(tab !== "ads" ? `/api/pods?${qs({ range })}` : null);

  const items = rankings.data?.items ?? [];
  const activeId = selected && items.some((i) => i.postId === selected) ? selected : (items[0]?.postId ?? null);

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-center gap-6 border-b border-line px-4 pt-4">
          {(["ads", "pods", "editors"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-1 pb-3 text-base capitalize transition ${
                tab === t ? "border-ink font-semibold text-ink" : "border-transparent text-ink-3 hover:text-ink-2"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          {tab === "ads" && (
            <>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ad, editor, angle…"
                className="min-w-48 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:outline-2 focus:outline-accent"
              />
              <Select label="Rank by" value={sort} onChange={(v) => setSort(v as SortKey)} options={SORTS} />
              <Select
                label="Pod"
                value={pod}
                onChange={setPod}
                options={[
                  { value: "all", label: "All pods" },
                  ...meta.pods.map((p) => ({ value: p.id, label: p.name })),
                  { value: "unassigned", label: "Unassigned" },
                ]}
              />
              <Select
                label="Status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "all", label: "All" },
                  { value: "active", label: "Active" },
                  { value: "paused", label: "Paused" },
                ]}
              />
            </>
          )}
          <div className={tab === "ads" ? "" : "mx-auto"}>
            <Segmented
              value={range}
              onChange={setRange}
              options={[
                { value: "week", label: "This week" },
                { value: "month", label: "This month" },
                { value: "all", label: "All time" },
              ]}
            />
          </div>
        </div>

        {tab === "ads" && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="min-w-0 border-line lg:border-r">
              <div className="flex flex-wrap justify-between gap-2 px-4 py-2 text-xs text-ink-3">
                <span>
                  {rankings.data ? `${shortDate(rankings.data.from === "2000-01-01" ? null : rankings.data.from)} – ${shortDate(rankings.data.to)} · ${int(rankings.data.count)} posts` : "Loading…"}
                </span>
                {rankings.data && (
                  <span className="num">
                    Spend <b className="text-ink">{money(rankings.data.totals.spendCents, { compact: true })}</b> · Purchases{" "}
                    <b className="text-ink">{int(rankings.data.totals.purchases)}</b> · ROAS{" "}
                    <b className="text-ink">{roas(rankings.data.totals)?.toFixed(2) ?? "—"}</b> · CPA{" "}
                    <b className="text-ink">{dollars(cpa(rankings.data.totals))}</b>
                  </span>
                )}
              </div>
              {rankings.error && <Empty>Couldn't load rankings: {rankings.error.message}</Empty>}
              {rankings.data && items.length === 0 && <Empty>No ads with spend match these filters.</Empty>}
              <ol className="flex max-h-[calc(100vh-18rem)] flex-col gap-2 overflow-y-auto px-3 pb-3 lg:min-h-[32rem]">
                {items.map((p, i) => (
                  <RankCard key={p.postId} post={p} rank={i + 1} targets={meta.targets} active={p.postId === activeId} onSelect={() => setSelected(p.postId)} />
                ))}
              </ol>
            </div>
            <div className="min-w-0 p-4">
              {activeId ? <PostDetailPanel postId={activeId} range={range} targets={meta.targets} rank={items.findIndex((p) => p.postId === activeId) + 1} /> : <Empty>Select an ad to see its details.</Empty>}
            </div>
          </div>
        )}

        {tab === "pods" && <PodsTab data={pods.data} error={pods.error} targets={meta.targets} />}
        {tab === "editors" && <EditorsTab data={pods.data} error={pods.error} targets={meta.targets} />}
      </Card>
    </div>
  );
}

const MEDAL = ["🥇", "🥈", "🥉"];

function RankCard({ post, rank, targets, active, onSelect }: { post: PostSummary; rank: number; targets: Targets; active: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        onClick={onSelect}
        aria-current={active}
        className={`flex w-full gap-3 rounded-xl border p-3 text-left transition ${
          active ? "border-accent bg-accent-soft/50 ring-1 ring-accent" : "border-line bg-surface hover:border-ink-3"
        }`}
      >
        <div className="num flex w-8 shrink-0 items-start justify-center pt-0.5 text-sm font-semibold text-ink-2">
          {rank <= 3 ? <span className="text-xl" aria-label={`Rank ${rank}`}>{MEDAL[rank - 1]}</span> : rank}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-ink" title={post.name}>
            {post.name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            <PodChip podId={post.assignment.podId} source={post.assignment.podSource} />
            {post.assignment.editorName && <span>{post.assignment.editorName}</span>}
            <span>· {shortDate(post.launched)}</span>
            {post.daysLive != null && <span>· Live {post.daysLive}d</span>}
            {post.copies > 1 && <span className="font-medium text-ink-2">· {post.copies} copies</span>}
            <HitBadge status={post.hit} />
          </div>
          <div className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
            <span>
              Spend <b className="text-ink">{money(post.totals.spendCents, { compact: true })}</b>
            </span>
            <span>
              Purch <b className="text-ink">{int(post.totals.purchases)}</b>
            </span>
            <span>
              ROAS <RoasValue value={roas(post.totals)} target={targets.targetRoas} />
            </span>
            <span>
              CPA <CpaValue value={cpa(post.totals)} target={targets.targetCpa} />
            </span>
            <span>
              CTR <b className="text-ink">{pct(ctr(post.totals))}</b>
            </span>
          </div>
        </div>
        <Thumb mediaType={post.mediaType} label={post.name} url={post.thumbnailUrl} className="h-20 w-14 shrink-0" />
      </button>
    </li>
  );
}

function PostDetailPanel({ postId, range, targets, rank }: { postId: string; range: Range; targets: Targets; rank: number }) {
  const { data, error } = useApi<PostDetail>(`/api/posts/${encodeURIComponent(postId)}?${qs({ range })}`);
  if (error) return <Empty>Couldn't load this ad: {error.message}</Empty>;
  if (!data || data.postId !== postId) return <Empty>Loading…</Empty>;
  const a = data.assignment;
  const tags: [string, string | null][] = [
    ["Angle", a.angle],
    ["Format", a.format],
    ["Hook", a.hook],
    ["Landing page", a.landingPage],
  ];

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold text-ink">Ad details</h2>
      <div className="flex flex-col gap-4 sm:flex-row">
        <Thumb mediaType={data.mediaType} label={data.name} url={data.thumbnailUrl} className="aspect-[9/16] w-full max-w-40 shrink-0" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="text-xl font-semibold break-words text-ink">{data.name}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full px-2 py-0.5 font-medium ${data.active ? "bg-good-soft text-good" : "bg-surface-2 text-ink-2"}`}>
              {data.active ? "● Active" : "Paused"}
            </span>
            {rank > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium text-ink-2">#{rank} in this view</span>}
            <HitBadge status={data.hit} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
            <PodChip podId={a.podId} source={a.podSource} />
            <span>Editor: {a.editorName ?? "—"}</span>
          </div>
          <div className="text-sm text-ink-2">
            Launched {shortDate(data.launched)}
            {data.daysLive != null && ` · first spend ${shortDate(data.firstSpend)} · live ${data.daysLive} days`}
          </div>
          <div className="text-sm text-ink-2">
            Runs as <b className="text-ink">{data.copies} {data.copies === 1 ? "ad" : "ads"}</b>
            {data.copies > 1 && " (copies of the same post, listed below)"}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map(([k, v]) => (
              <span key={k} className={`rounded-md px-2 py-0.5 text-xs ${v ? "bg-accent-soft text-accent" : "bg-surface-2 text-ink-3"}`}>
                {k}: {v ?? "—"}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-ink-3 uppercase">Results · all {data.copies} {data.copies === 1 ? "copy" : "copies"} · selected period</div>
        <div className="grid grid-cols-2 divide-line rounded-xl border border-line sm:grid-cols-5 sm:divide-x">
          <Stat label="Spend">{money(data.totals.spendCents)}</Stat>
          <Stat label="Purchases">{int(data.totals.purchases)}</Stat>
          <Stat label="ROAS (Meta)">
            <RoasValue value={roas(data.totals)} target={targets.targetRoas} />
          </Stat>
          <Stat label="CPA">
            <CpaValue value={cpa(data.totals)} target={targets.targetCpa} />
          </Stat>
          <Stat label="Link CTR">{pct(ctr(data.totals))}</Stat>
        </div>
        <div className="num mt-2 text-xs text-ink-3">
          All time: {money(data.allTime.spendCents)} spend · {int(data.allTime.purchases)} purchases · ROAS {roas(data.allTime)?.toFixed(2) ?? "—"}
        </div>
      </div>

      <DailyCharts daily={data.daily} targetCpa={targets.targetCpa} />

      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-ink-3 uppercase">Every copy of this post</div>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-ink-3">
              <tr>
                <th className="px-3 py-2 font-medium">Campaign / ad set</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Spend</th>
                <th className="px-3 py-2 text-right font-medium">CPA</th>
                <th className="px-3 py-2 text-right font-medium">ROAS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.copyRows.map((c) => (
                <tr key={c.adId}>
                  <td className="px-3 py-2">
                    <div className="text-ink">{c.campaignName ?? "—"}</div>
                    <div className="text-xs text-ink-3">{c.adsetName ?? "—"} · {c.name}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-2">{c.status === "ACTIVE" ? "Active" : c.status.toLowerCase()}</td>
                  <td className="num px-3 py-2 text-right text-ink">{money(c.totals.spendCents)}</td>
                  <td className="px-3 py-2 text-right">
                    <CpaValue value={cpa(c.totals)} target={targets.targetCpa} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <RoasValue value={roas(c.totals)} target={targets.targetRoas} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium tracking-wide text-ink-3 uppercase">Why it works</div>
        <p className="text-sm text-ink-3">Creative notes and AI analysis arrive in Phase 3 (Creative Intelligence).</p>
      </div>
    </div>
  );
}
