import { useEffect, useState } from "react";
import type { AttributionResponse, MetaResponse, PodsResponse, PostDetail, PostSummary, RankingsResponse, SortKey } from "../../shared/api.ts";
import { attributedCpa, attributedRoas, cpa, ctr, roas, type Targets, type Totals } from "../../shared/metrics.ts";
import { ANGLES, FORMATS } from "../../shared/taxonomy.ts";
import { qs, useApi } from "../api.ts";
import { HeaderControls, type Range } from "../components/HeaderControls.tsx";
import { PlayableThumb } from "../components/AdPreview.tsx";
import { DailyCharts } from "../components/DailyCharts.tsx";
import { CpaValue, CsvButton, Empty, HitBadge, PageHeader, PodChip, RoasValue, Segmented, Select, Tabs, Tag, Thumb, LoadError, Pager } from "../components/ui.tsx";
import { dollars, downloadCsv, int, money, pct, plain, plainDollars, ratio, shortDate } from "../format.ts";
import { podById } from "../../shared/taxonomy.ts";
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
/** Ads shown per page. */
const PAGE = 10;

function cpm(t: Totals): number | null {
  return t.impressions > 0 ? t.spendCents / 100 / (t.impressions / 1000) : null;
}

export function RankingsPage({
  meta,
  range,
  setRange,
  initialPost,
  initialStatus,
}: {
  meta: MetaResponse;
  range: Range;
  setRange: (r: Range) => void;
  initialPost?: string | null;
  initialStatus?: string | null;
}) {
  const [tab, setTab] = useState<Tab>("ads");
  const [sort, setSort] = useState<SortKey>("spend");
  const [pod, setPod] = useState("all");
  const [status, setStatus] = useState(initialStatus ?? "all");
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
  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  const [showAll, setShowAll] = useState(false);
  const rankings = useApi<RankingsResponse>(
    tab === "ads" ? `/api/rankings?${qs({ range, sort, pod, status, q, format, angle, all: showAll && sort !== "spend" ? "1" : undefined })}` : null,
  );
  const pods = useApi<PodsResponse>(tab !== "ads" ? `/api/pods?${qs({ range })}` : null);

  const items = rankings.data?.items ?? [];
  const activeId = selected ?? items[0]?.postId ?? null;
  // 10 a page (the full list ran to hundreds of cards); a new filter goes back to page 1.
  const query = `${range}|${sort}|${pod}|${status}|${q}|${format}|${angle}`;
  const [page, setPage] = useState({ query, n: 0 });
  const pageNo = page.query === query ? Math.min(page.n, Math.max(0, Math.ceil(items.length / PAGE) - 1)) : 0;
  const start = pageNo * PAGE;
  // On a phone the ad's details open over the list instead of below all of it.
  const [sheet, setSheet] = useState(false);
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
                    { value: "fatigued", label: "Fatigued or watch" },
                    { value: "hits_off", label: "Hits turned off" },
                  ]}
                />
                <Select stacked label="Format" value={format} onChange={setFormat} options={vocab(FORMATS, "All formats")} />
                <Select stacked label="Angle" value={angle} onChange={setAngle} options={vocab(ANGLES, "All angles")} />
              </div>
              {status === "hits_off" && (
                <p className="bg-warn-soft px-3 py-2 text-sm text-ink">
                  ! Hits and late hits that no longer run anywhere: every copy of the creative is paused or off in Meta, or spent nothing in the
                  last 3 synced days. Listed whatever the date range spent; results are for the range shown, so pick All time to see their full
                  results.
                </p>
              )}
              {rankings.data && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="num text-xs text-ink-3">
                    {int(rankings.data.count)} posts · {shortDate(rankings.data.from === "2000-01-01" ? null : rankings.data.from)} –{" "}
                    {shortDate(rankings.data.to)} · spend{" "}
                    <b className="text-ink">
                      {money(rankings.data.totals.spendCents, {
                        compact: true,
                      })}
                    </b>{" "}
                    · CPA <b className="text-ink">{dollars(cpa(rankings.data.totals))}</b> · ROAS{" "}
                    <b className="text-ink">{roas(rankings.data.totals)?.toFixed(2) ?? "—"}</b> · targets ${meta.targets.targetCpa} / {meta.targets.targetRoas}
                  </p>
                  <CsvButton disabled={items.length === 0} onClick={() => exportRankings(items, rankings.data!.from, rankings.data!.to)} />
                </div>
              )}
              {sort !== "spend" && status !== "hits_off" && rankings.data && (rankings.data.minSpendCents != null || showAll) && (
                <p className="text-xs text-ink-2">
                  {rankings.data.minSpendCents != null ? (
                    <>
                      Only ads with <b className="text-ink">{money(rankings.data.minSpendCents, { compact: true })}+</b> spend ($
                      {meta.targets.rankMinSpendPerDay}/day × {rankings.data.minDays} days) are ranked
                      {rankings.data.belowMin > 0 && ` · ${int(rankings.data.belowMin)} below that left out`} ·{" "}
                      <button type="button" className="link" onClick={() => setShowAll(true)}>
                        Include them
                      </button>
                    </>
                  ) : (
                    <>
                      Every ad is ranked, however little it spent ·{" "}
                      <button type="button" className="link" onClick={() => setShowAll(false)}>
                        Apply the ${meta.targets.rankMinSpendPerDay}/day minimum
                      </button>
                    </>
                  )}{" "}
                  ·{" "}
                  <a href="#/settings?tab=targets" className="link">
                    Change
                  </a>
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <LoadError error={rankings.error} retry={rankings.retry} what="rankings" />
                {rankings.data && items.length === 0 && (
                  <Empty>{status === "hits_off" ? "No hits are turned off: every winner still has a copy running." : "No ads with spend match these filters."}</Empty>
                )}
                <ol className="flex flex-col gap-2">
                  {items.slice(start, start + PAGE).map((p, i) => (
                    <RankCard
                      key={p.postId}
                      post={p}
                      rank={start + i + 1}
                      targets={meta.targets}
                      active={p.postId === activeId}
                      onSelect={() => {
                        setSelected(p.postId);
                        setSheet(true);
                      }}
                    />
                  ))}
                </ol>
                <Pager
                  page={pageNo}
                  size={PAGE}
                  total={items.length}
                  onPage={(n) => {
                    setPage({ query, n });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              </div>
              {sheet && activeId && (
                <div className="fixed inset-0 z-50 flex flex-col bg-page lg:hidden" role="dialog" aria-modal="true" aria-label="Ad details">
                  <div className="flex items-center justify-between border-b-2 border-divider px-4 py-3">
                    <span className="kicker">Ad #{rank}</span>
                    <button className="btn btn-secondary" onClick={() => setSheet(false)} aria-label="Close">
                      ✕
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    <PostDetailPanel postId={activeId} range={range} targets={meta.targets} rank={rank} sortLabel={SORTS.find((s) => s.value === sort)!.label} />
                  </div>
                </div>
              )}
              <div className="hidden min-w-0 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:overscroll-contain">
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

const upDown = (v: number) => `${v >= 0 ? "up" : "down"} ${Math.round(Math.abs(v) * 100)}%`;

/** What tripped the fatigue check (last 3 days vs first week), then the other measures for context. */
function fatigueText(f: NonNullable<PostDetail["fatigue"]>): string {
  const phrase = {
    frequency: f.frequencyChange != null && `frequency ${upDown(f.frequencyChange)} (people see it more often)`,
    ctr: f.ctrChange != null && `CTR ${upDown(f.ctrChange)} (fewer clicks)`,
    cpa: f.cpaChange == null || !Number.isFinite(f.cpaChange) ? "no purchases" : `CPA ${upDown(f.cpaChange)}`,
  };
  const tripped = f.signals.map((s) => phrase[s]).filter(Boolean);
  const other = [
    !f.signals.includes("frequency") && f.frequencyChange != null && `frequency ${upDown(f.frequencyChange)}`,
    !f.signals.includes("ctr") && f.ctrChange != null && `CTR ${upDown(f.ctrChange)}`,
    !f.signals.includes("cpa") && f.cpaChange != null && Number.isFinite(f.cpaChange) && `CPA ${upDown(f.cpaChange)}`,
  ].filter(Boolean);
  return `${tripped.join(" and ")} in the last 3 days vs its first week.${other.length ? ` Not a concern yet: ${other.join(", ")}.` : ""}`;
}

const SIGNAL_LABEL = {
  frequency: "frequency up",
  ctr: "CTR down",
  cpa: "CPA up",
} as const;

function FatigueTag({ f }: { f: PostSummary["fatigue"] }) {
  if (!f) return null;
  const title = `Last 3 days vs first week: ${f.signals.map((s) => SIGNAL_LABEL[s]).join(", ")}`;
  return f.status === "fatigued" ? (
    <span className="bg-bad-soft px-1.5 py-px text-[11px] font-semibold text-bad" title={title}>
      ✕ Fatigued
    </span>
  ) : (
    <span className="bg-warn-soft px-1.5 py-px text-[11px] font-semibold text-warn" title={title}>
      ! Watch
    </span>
  );
}

function exportRankings(items: PostSummary[], from: string, to: string) {
  downloadCsv(
    `kojeva-rankings-${from === "2000-01-01" ? "all" : from}-to-${to}.csv`,
    [
      "Rank",
      "Post ID",
      "Ad name",
      "Pod",
      "Editor",
      "Ad set",
      "Launched",
      "Days live",
      "Copies",
      "Status",
      "Spend (Meta, $)",
      "Purchases (Meta)",
      "Revenue (Meta, $)",
      "CPA (Meta, $)",
      "ROAS (Meta)",
      "Link CTR (%)",
      "Concept result",
      "Fatigue",
      "Angle",
      "Format",
    ],
    items.map((p, i) => [
      i + 1,
      p.postId,
      p.name,
      p.assignment.podId ? (podById(p.assignment.podId)?.name ?? p.assignment.podId) : "Unassigned",
      p.assignment.editorName,
      p.adsetName,
      p.launched,
      p.daysLive,
      p.copies,
      p.active ? "Active" : "Paused",
      plainDollars(p.totals.spendCents),
      p.totals.purchases,
      plainDollars(p.totals.revenueCents),
      plain(cpa(p.totals)),
      plain(roas(p.totals)),
      plain(ctr(p.totals) == null ? null : ctr(p.totals)! * 100),
      p.hit,
      p.fatigue?.status,
      p.assignment.angle,
      p.assignment.format,
    ]),
  );
}

function RankBadge({ rank }: { rank: number }) {
  const cls = rank === 1 ? "bg-accent text-on-accent" : rank === 2 ? "bg-ink text-page" : rank === 3 ? "border-2 border-ink text-ink" : "text-ink-2";
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
            <FatigueTag f={post.fatigue} />
            <HitBadge status={post.hit} />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 border-t border-divider pt-2 2xl:grid-cols-5">
            <Metric label="Spend">{money(post.totals.spendCents)}</Metric>
            <Metric label="Purchases">{int(post.totals.purchases)}</Metric>
            <Metric label="Link CTR">{pct(ctr(post.totals))}</Metric>
            <Metric label="CPA · Meta">
              <CpaValue value={cpa(post.totals)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
            </Metric>
            <Metric label="ROAS · Meta">
              <RoasValue value={roas(post.totals)} target={targets.targetRoas} />
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
  const attr = useApi<AttributionResponse>(`/api/attribution?${qs({ range, level: "post", post: postId })}`);
  const click7 = attr.data?.rows[0]?.click7 ?? null;
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
          {rank > 0 && (
            <Tag tone="ink">
              #{rank} by {sortLabel}
            </Tag>
          )}
          <Tag>{data.active ? "Active" : "Paused"}</Tag>
          <FatigueTag f={data.fatigue} />
          <HitBadge status={data.hit} />
        </span>
      </div>
      {data.fatigue && (
        <p className={`px-3 py-2 text-sm ${data.fatigue.status === "fatigued" ? "bg-bad-soft text-ink" : "bg-warn-soft text-ink"}`}>
          <b>{data.fatigue.status === "fatigued" ? "✕ Fatiguing" : "! Worth watching"}</b> · {fatigueText(data.fatigue)}
        </p>
      )}

      <div className="flex flex-col gap-4 sm:flex-row">
        <PlayableThumb
          postId={data.postId}
          name={data.name}
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
            Runs as{" "}
            <b className="text-ink">
              {data.copies} {data.copies === 1 ? "ad" : "ads"}
            </b>
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
        </div>
        <div className="mt-0.5 grid grid-cols-2 gap-0.5 border-2 border-t-0 border-divider bg-divider sm:grid-cols-3">
          <Cell label="Purch. · 7-day click">{click7 ? int(click7.purchases) : "—"}</Cell>
          <Cell label="CPA · 7-day click">{dollars(attributedCpa(click7, data.totals.spendCents))}</Cell>
          <Cell label="ROAS · 7-day click">{ratio(attributedRoas(click7, data.totals.spendCents))}</Cell>
        </div>
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
