import { useEffect, useState } from "react";
import type { MetaResponse, PodsResponse, PostDetail, PostSummary, RankingsResponse, SortKey } from "../../shared/api.ts";
import { cpa, ctr, roas, twCpa, twRoas, type Targets, type Totals } from "../../shared/metrics.ts";
import { ANGLES, FORMATS } from "../../shared/taxonomy.ts";
import { qs, useApi } from "../api.ts";
import { HeaderControls, type Range } from "../components/HeaderControls.tsx";
import { DailyCharts } from "../components/DailyCharts.tsx";
import { CpaValue, Empty, HitBadge, PageHeader, PodChip, RoasValue, Segmented, Select, Tabs, Tag, Thumb } from "../components/ui.tsx";
import { dollars, int, money, pct, shortDate, TW_MODEL_LABEL, twCoverageNote } from "../format.ts";
import { EditorsTab, PodsTable } from "./PodsView.tsx";

type Tab = "ads" | "pods" | "editors";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "spend", label: "Spend" },
  { value: "purchases", label: "Purchases" },
  { value: "roas", label: "ROAS" },
  { value: "cpa", label: "CPA" },
  { value: "ctr", label: "CTR" },
];

const vocab = (v: Record<string, string>, all: string) => [{ value: "", label: all }, ...Object.entries(v).map(([value, label]) => ({ value, label }))];

/** Cost per 1,000 impressions, in dollars; null without impressions. */
function cpm(t: Totals): number | null {
  return t.impressions > 0 ? t.spendCents / 100 / (t.impressions / 1000) : null;
}

export function RankingsPage({
  meta,
  range,
  setRange,
  initialPost,
}: {
  meta: MetaResponse;
  range: Range;
  setRange: (r: Range) => void;
  initialPost?: string | null;
}) {
  const [tab, setTab] = useState<Tab>("ads");
  const [sort, setSort] = useState<SortKey>("spend");
  const [pod, setPod] = useState("all");
  const [status, setStatus] = useState("all");
  const [format, setFormat] = useState("");
  const [angle, setAngle] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(initialPost ?? null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (initialPost) setSelected(initialPost);
  }, [initialPost]);

  const rankings = useApi<RankingsResponse>(tab === "ads" ? `/api/rankings?${qs({ range, sort, pod, status, q, format, angle })}` : null);
  const pods = useApi<PodsResponse>(tab !== "ads" ? `/api/pods?${qs({ range })}` : null);

  const items = rankings.data?.items ?? [];
  const activeId = selected ?? items[0]?.postId ?? null;
  const rank = items.findIndex((p) => p.postId === activeId) + 1;

  return (
    <div>
      <PageHeader title="Ad Rankings" subtitle="Ranked by post · copies across campaigns grouped together">
        <HeaderControls meta={meta} range={range} setRange={setRange} />
      </PageHeader>

      <div className="flex flex-col gap-5 px-4 py-6 md:px-8">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: "ads", label: "Ads" },
            { value: "pods", label: "Pods" },
            { value: "editors", label: "Editors" },
          ]}
        />

        {tab === "ads" && (
          <>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm text-ink-2">
                  Search
                  <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ad name, editor, angle…" className="field" />
                </label>
                <div className="flex flex-col gap-1 text-sm text-ink-2">
                  Rank by
                  <Segmented label="Rank by" value={sort} onChange={setSort} options={SORTS} />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Select
                  stacked
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
                  stacked
                  label="Status"
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "all", label: "All" },
                    { value: "active", label: "Active" },
                    { value: "paused", label: "Paused" },
                  ]}
                />
                <Select stacked label="Format" value={format} onChange={setFormat} options={vocab(FORMATS, "All formats")} />
                <Select stacked label="Angle" value={angle} onChange={setAngle} options={vocab(ANGLES, "All angles")} />
              </div>
              {rankings.data && (
                <p className="num text-xs text-ink-3">
                  {int(rankings.data.count)} posts · {shortDate(rankings.data.from === "2000-01-01" ? null : rankings.data.from)} – {shortDate(rankings.data.to)} · spend{" "}
                  <b className="text-ink">{money(rankings.data.totals.spendCents, { compact: true })}</b> · CPA{" "}
                  <b className="text-ink">{dollars(cpa(rankings.data.totals))}</b> · ROAS <b className="text-ink">{roas(rankings.data.totals)?.toFixed(2) ?? "—"}</b> · targets $
                  {meta.targets.targetCpa} / {meta.targets.targetRoas}
                  {rankings.data.tw && (
                    <>
                      {" "}
                      · ROAS · TW <b className="text-ink">{twRoas(rankings.data.tw, rankings.data.totals.spendCents)?.toFixed(2) ?? "—"}</b>
                    </>
                  )}
                  {twCoverageNote(rankings.data.twCoverage) && ` · ${twCoverageNote(rankings.data.twCoverage)}`}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                {rankings.error && <Empty>Couldn't load rankings: {rankings.error.message}</Empty>}
                {rankings.data && items.length === 0 && <Empty>No ads with spend match these filters.</Empty>}
                <ol className="flex flex-col gap-2">
                  {items.map((p, i) => (
                    <RankCard key={p.postId} post={p} rank={i + 1} targets={meta.targets} active={p.postId === activeId} onSelect={() => setSelected(p.postId)} />
                  ))}
                </ol>
              </div>
              <div className="min-w-0 lg:sticky lg:top-4">
                {activeId ? (
                  <PostDetailPanel postId={activeId} range={range} targets={meta.targets} rank={rank} sortLabel={SORTS.find((s) => s.value === sort)!.label} />
                ) : (
                  <Empty>Select an ad to see its details.</Empty>
                )}
              </div>
            </div>
          </>
        )}

        {tab === "pods" && <PodsTable data={pods.data} error={pods.error} targets={meta.targets} />}
        {tab === "editors" && <EditorsTab data={pods.data} error={pods.error} targets={meta.targets} />}
      </div>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const cls =
    rank === 1
      ? "bg-accent text-on-accent"
      : rank === 2
        ? "bg-ink text-page"
        : rank === 3
          ? "border-2 border-ink text-ink"
          : "text-ink-2";
  return <span className={`num grid size-8 shrink-0 place-items-center text-sm font-extrabold ${cls}`}>{rank}</span>;
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="kicker truncate text-[10px]">{label}</div>
      <div className="num font-bold whitespace-nowrap text-ink">{children}</div>
    </div>
  );
}

function RankCard({ post, rank, targets, active, onSelect }: { post: PostSummary; rank: number; targets: Targets; active: boolean; onSelect: () => void }) {
  const fmt = post.assignment.format ? (FORMATS[post.assignment.format] ?? post.assignment.format) : post.mediaType === "image" ? "Image" : "Video";
  return (
    <li>
      <button
        onClick={onSelect}
        aria-current={active}
        className={`flex w-full gap-3 border-2 bg-surface p-3 text-left transition ${active ? "border-accent" : "border-transparent hover:border-divider"}`}
      >
        <RankBadge rank={rank} />
        <Thumb mediaType={post.mediaType} label={fmt} url={post.thumbnailUrl} className="h-[72px] w-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold text-ink" title={post.name}>
            {post.name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            <PodChip podId={post.assignment.podId} source={post.assignment.podSource} />
            {post.launched && <span>Launched {shortDate(post.launched)}</span>}
            {post.daysLive != null && <span>· {post.daysLive} days live</span>}
            {post.copies > 1 && <span>· {post.copies} copies</span>}
            <Tag tone={post.active ? "neutral" : "outline"}>{post.active ? "Active" : "Paused"}</Tag>
            <HitBadge status={post.hit} />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 border-t border-divider pt-2 2xl:grid-cols-6">
            <Metric label="Spend">{money(post.totals.spendCents)}</Metric>
            <Metric label="Purchases">{int(post.totals.purchases)}</Metric>
            <Metric label="Link CTR">{pct(ctr(post.totals))}</Metric>
            <Metric label="CPA · Meta">
              <CpaValue value={cpa(post.totals)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
            </Metric>
            <Metric label="ROAS · Meta">
              <RoasValue value={roas(post.totals)} target={targets.targetRoas} />
            </Metric>
            <Metric label="ROAS · TW">
              <RoasValue value={twRoas(post.tw, post.totals.spendCents)} target={targets.targetRoas} />
            </Metric>
          </div>
        </div>
      </button>
    </li>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-page px-3 py-2.5">
      <div className="kicker">{label}</div>
      <div className="num mt-1 text-lg font-extrabold text-ink">{children}</div>
    </div>
  );
}

const ATRIA_FIELDS = [
  ["theme", "Theme"],
  ["core_desire", "Core desire"],
  ["persona", "Persona"],
  ["emotions", "Emotions"],
  ["visual_hook", "Visual hook"],
  ["media_format", "Format"],
  ["offer_type", "Offer"],
  ["key_message", "Key message"],
] as const;

function PostDetailPanel({ postId, range, targets, rank, sortLabel }: { postId: string; range: Range; targets: Targets; rank: number; sortLabel: string }) {
  const { data, error } = useApi<PostDetail>(`/api/posts/${encodeURIComponent(postId)}?${qs({ range })}`);
  if (error) return <Empty>Couldn't load this ad: {error.message}</Empty>;
  if (!data || data.postId !== postId) return <Empty>Loading…</Empty>;
  const a = data.assignment;
  const tags: [string, string | null][] = [
    ["Angle", a.angle ? (ANGLES[a.angle] ?? a.angle) : null],
    ["Format", a.format ? (FORMATS[a.format] ?? a.format) : null],
    ["Hook", a.hook],
    ["Landing page", a.landingPage],
  ];
  const campaigns = [...new Set(data.copyRows.map((c) => c.campaignName).filter(Boolean))];

  return (
    <div className="flex flex-col gap-5 bg-surface p-4">
      <div className="flex items-center justify-between gap-2 border-b-2 border-divider pb-2">
        <span className="kicker">Ad details</span>
        <span className="flex gap-1.5">
          {rank > 0 && <Tag tone="ink">#{rank} by {sortLabel}</Tag>}
          <Tag>{data.active ? "Active" : "Paused"}</Tag>
          <HitBadge status={data.hit} />
        </span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <Thumb
          mediaType={data.mediaType}
          label={a.format ? (FORMATS[a.format] ?? a.format) : ""}
          url={data.thumbnailUrl}
          className="aspect-[9/16] w-full max-w-40 shrink-0"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="text-xl leading-tight font-extrabold break-words text-ink">{data.name}</div>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-3">Pod</dt>
            <dd>
              <PodChip podId={a.podId} source={a.podSource} />
            </dd>
            <dt className="text-ink-3">Editor</dt>
            <dd className="text-ink">{a.editorName ?? "—"}</dd>
            <dt className="text-ink-3">Launched</dt>
            <dd className="text-ink">
              {shortDate(data.launched)}
              {data.daysLive != null && ` · ${data.daysLive} days live`}
            </dd>
            <dt className="text-ink-3">Ad set</dt>
            <dd className="break-words text-ink">{data.adsetName ?? "—"}</dd>
          </dl>
          <div className="flex flex-wrap gap-1.5">
            {tags.map(([k, v]) => (
              <span key={k} className={`border px-1.5 py-px text-xs ${v ? "border-divider text-ink" : "border-line text-ink-3"}`}>
                {k}: {v ?? "—"}
              </span>
            ))}
          </div>
          <p className="border border-divider bg-page px-3 py-2 text-sm text-ink-2">
            Runs as <b className="text-ink">{data.copies} {data.copies === 1 ? "ad" : "ads"}</b>
            {campaigns.length > 0 && ` across ${campaigns.join(", ")}`}
          </p>
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-extrabold text-ink">
          Results · all {data.copies} {data.copies === 1 ? "copy" : "copies"}
        </h3>
        <div className="grid grid-cols-2 gap-0.5 border-2 border-divider bg-divider sm:grid-cols-3">
          <Cell label="Spend">{money(data.totals.spendCents)}</Cell>
          <Cell label="Purchases">{int(data.totals.purchases)}</Cell>
          <Cell label="CPA · Meta">
            <CpaValue value={cpa(data.totals)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
          </Cell>
          <Cell label="ROAS · Meta">
            <RoasValue value={roas(data.totals)} target={targets.targetRoas} />
          </Cell>
          <Cell label="Link CTR">{pct(ctr(data.totals))}</Cell>
          <Cell label="CPM">{dollars(cpm(data.totals))}</Cell>
          <Cell label="Purchases · TW">{data.tw ? data.tw.purchases.toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—"}</Cell>
          <Cell label="CPA · TW">
            <CpaValue value={twCpa(data.tw, data.totals.spendCents)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
          </Cell>
          <Cell label="ROAS · TW">
            <RoasValue value={twRoas(data.tw, data.totals.spendCents)} target={targets.targetRoas} />
          </Cell>
        </div>
        <div className="mt-1 text-xs text-ink-3">TW = Triple Whale pixel, {TW_MODEL_LABEL}, on Meta's spend. Shown beside Meta's numbers, never added to them.</div>
        <div className="num mt-2 text-xs text-ink-3">
          All time: {money(data.allTime.spendCents)} spend · {int(data.allTime.purchases)} purchases · ROAS {roas(data.allTime)?.toFixed(2) ?? "—"}
        </div>
      </div>

      <DailyCharts daily={data.daily} targetCpa={targets.targetCpa} />

      <div>
        <h3 className="mb-2 font-extrabold text-ink">Every copy of this post</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="kicker text-left">
              <tr className="border-b-2 border-divider">
                <th className="py-2 pr-3 font-normal">Campaign / ad set</th>
                <th className="py-2 pr-3 font-normal">Status</th>
                <th className="py-2 pr-3 text-right font-normal">Spend</th>
                <th className="py-2 pr-3 text-right font-normal">CPA</th>
                <th className="py-2 text-right font-normal">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {data.copyRows.map((c) => (
                <tr key={c.adId} className="border-b border-divider">
                  <td className="py-2 pr-3">
                    <div className="text-ink">{c.campaignName ?? "—"}</div>
                    <div className="text-xs text-ink-3">
                      {c.adsetName ?? "—"} · {c.name}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-xs text-ink-2">{c.status === "ACTIVE" ? "Active" : c.status.toLowerCase()}</td>
                  <td className="num py-2 pr-3 text-right text-ink">{money(c.totals.spendCents)}</td>
                  <td className="py-2 pr-3 text-right">
                    <CpaValue value={cpa(c.totals)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
                  </td>
                  <td className="py-2 text-right">
                    <RoasValue value={roas(c.totals)} target={targets.targetRoas} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-extrabold text-ink">Atria creative tags</h3>
        {data.atria ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            {ATRIA_FIELDS.filter(([k]) => data.atria![k]?.length).map(([k, label]) => (
              <div key={k} className="contents">
                <dt className="text-ink-3">{label}</dt>
                <dd className="flex flex-wrap gap-1">
                  {data.atria![k]!.map((v) => (
                    <span key={v} className="border border-divider px-1.5 py-px text-xs text-ink">
                      {v}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-ink-3">Not tagged by Atria yet. Atria tags creatives in order of spend; the nightly sync picks up new tags.</p>
        )}
      </div>
    </div>
  );
}
