import { useEffect, useRef, useState } from "react";
import { Info } from "../glossary.tsx";
import type { AttributionResponse, MetaResponse, PodsResponse, PostDetail, PostSummary, RankingsResponse, SortKey } from "../../shared/api.ts";
import { attributedCpa, attributedRoas, cpa, ctr, roas, type Targets, type Totals } from "../../shared/metrics.ts";
import { ANGLES, FORMATS } from "../../shared/taxonomy.ts";
import { qs, useApi } from "../api.ts";
import { HeaderControls, type Range } from "../components/HeaderControls.tsx";
import { PlayableThumb } from "../components/AdPreview.tsx";
import { DailyCharts } from "../components/DailyCharts.tsx";
import { CpaValue, Icon, Empty, HitBadge, PageHeader, PodChip, RoasValue, Segmented, Select, Tabs, Tag, Thumb, LoadError, Pager, SearchBox, Skeleton, useLockBodyScroll } from "../components/ui.tsx";
import { dollars, downloadCsv, int, money, pct, plain, plainDollars, ratio, shortDate } from "../format.ts";
import { podById } from "../../shared/taxonomy.ts";
import { EditorsTab, PodsTable } from "./PodsView.tsx";

type Tab = "ads" | "pods" | "editors";
type Preset = "all" | "1w" | "2w";
/** Whose ads and pods the page shows: Kojeva's own pods (default), or everyone incl. Agency and partners like Trybe. */
type View = "inhouse" | "all";

const STATUSES = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "hits", label: "Hits" },
  { value: "scaling", label: "Scaling" },
  { value: "fatigued", label: "Fatigued or watch" },
  { value: "hits_off", label: "Hits turned off" },
];

/** One-click filters beside the presets (owner, Oct 28); each is a Status value, also in Filters. */
const QUICK: { value: string; label: string; title: string }[] = [
  { value: "all", label: "Any", title: "No quick filter" },
  { value: "hits", label: "Hits", title: "Ads from concepts that hit (on target, late hit or called a winner)" },
  { value: "scaling", label: "Scaling", title: "A copy is running outside testing ad sets" },
  { value: "fatigued", label: "Watch", title: "Fatiguing, or flagged to watch" },
  { value: "hits_off", label: "Turned off", title: "Hits that no longer run anywhere" },
];

type Layout = "cards" | "table";
/** Rows per page in the table view (the cards show PAGE). */
const TABLE_PAGE = 50;
const LAYOUT_KEY = "kojeva.rankings.layout";

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
  // ROAS first (owner, Oct 28); ads under the daily spend minimum are left out of it.
  const [sort, setSort] = useState<SortKey>("roas");
  const [view, setView] = useState<View>("inhouse");
  // A pod picked in Filters; "" means every pod in the view.
  const [pod, setPod] = useState("");
  const [status, setStatus] = useState(initialStatus ?? "all");
  // Preset: only ads launched in the last 7 days, or since Monday of last week (numbers from then on).
  const [preset, setPreset] = useState<Preset>("all");
  const launched = preset !== "all";
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
  // Cards or a compact table, remembered per browser.
  const [layout, setLayoutState] = useState<Layout>(() => {
    try {
      return localStorage.getItem(LAYOUT_KEY) === "table" ? "table" : "cards";
    } catch {
      return "cards";
    }
  });
  const setLayout = (l: Layout) => {
    setLayoutState(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      // Private window: the choice lasts for this visit only.
    }
  };
  const size = layout === "table" ? TABLE_PAGE : PAGE;
  // New (2 weeks) is in-house pods only, whatever the view (owner, Oct 28).
  const podParam = pod || (view === "inhouse" || launched ? "inhouse" : "all");
  const inhouseIds = meta.pods.filter((p) => p.inhouse).map((p) => p.id);
  const rankings = useApi<RankingsResponse>(
    tab === "ads" ? `/api/rankings?${qs({ range, sort, pod: podParam, status, q, format, angle, launched: launched ? preset : undefined, all: showAll && sort !== "spend" ? "1" : undefined })}` : null,
  );
  const podsAll = useApi<PodsResponse>(tab !== "ads" ? `/api/pods?${qs({ range })}` : null);
  // The Pods and Editors tabs follow the view: in-house pods only, or every group.
  const pods = {
    ...podsAll,
    data: podsAll.data && view === "inhouse" ? { ...podsAll.data, rows: podsAll.data.rows.filter((r) => r.podId != null && inhouseIds.includes(r.podId)) } : podsAll.data,
  };

  const items = rankings.data?.items ?? [];
  // The ad whose details slide in from the right; none until one is clicked (or linked with ?post=).
  const activeId = selected;
  // 10 a page (the full list ran to hundreds of cards); a new filter goes back to page 1.
  const query = `${range}|${sort}|${podParam}|${status}|${q}|${format}|${angle}|${preset}|${layout}`;
  const [page, setPage] = useState({ query, n: 0 });
  const pageNo = page.query === query ? Math.min(page.n, Math.max(0, Math.ceil(items.length / size) - 1)) : 0;
  const start = pageNo * size;
  // On a phone the ad's details open over the list instead of below all of it.
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
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-ink-2">Show</span>
          <Segmented
            label="Pods shown"
            value={view}
            onChange={(v: View) => {
              setView(v);
              setPod("");
            }}
            options={[
              { value: "inhouse", label: "In-house pods" },
              { value: "all", label: "All, with agency & partners" },
            ]}
          />
        </div>

        {tab === "ads" && (
          <>
            <div className="flex flex-col gap-3">
              {/* Row 1: preset · search · sort · filters · CSV. */}
              <div className="flex flex-wrap items-center gap-3">
                <Segmented
                  label="Preset"
                  value={preset}
                  onChange={setPreset}
                  options={[
                    { value: "all", label: "All ads" },
                    { value: "1w", label: "New: past week", title: "Ads launched in the last 7 days (in-house pods)" },
                    { value: "2w", label: "New: past 2 weeks", title: "Ads launched since Monday of last week (in-house pods)" },
                  ]}
                />
                <Segmented
                  label="Quick filter"
                  value={QUICK.some((x) => x.value === status) ? status : ""}
                  onChange={setStatus}
                  options={QUICK.map((x) => ({ value: x.value, label: x.label, title: x.title }))}
                />
                <SearchBox value={search} onChange={setSearch} placeholder="Search ads, editors, angles…" />
                <Select label="Sort" value={sort} onChange={(v) => setSort(v as SortKey)} options={SORTS} />
                <FiltersButton
                  count={[pod !== "", status !== "all", format !== "", angle !== ""].filter(Boolean).length}
                >
                  <Select
                    stacked
                    label="Pod"
                    value={pod}
                    onChange={setPod}
                    options={[
                      { value: "", label: view === "inhouse" ? "All in-house pods" : "All pods" },
                      ...meta.pods.filter((p) => view === "all" || p.inhouse).map((p) => ({ value: p.id, label: p.name })),
                      ...(view === "all" ? [{ value: "unassigned", label: "Unassigned" }] : []),
                    ]}
                  />
                  <Select
                    stacked
                    label="Status"
                    value={status}
                    onChange={setStatus}
                    options={STATUSES}
                  />
                  <Select stacked label="Format" value={format} onChange={setFormat} options={vocab(FORMATS, "All formats")} />
                  <Select stacked label="Angle" value={angle} onChange={setAngle} options={vocab(ANGLES, "All angles")} />
                </FiltersButton>
                <Segmented
                  label="Layout"
                  value={layout}
                  onChange={setLayout}
                  options={[
                    { value: "cards", label: "Cards" },
                    { value: "table", label: "Table" },
                  ]}
                />
                <button
                  type="button"
                  className="btn btn-secondary px-2.5"
                  disabled={items.length === 0}
                  onClick={() => exportRankings(items, rankings.data!.from, rankings.data!.to)}
                  title="Download these ads as CSV"
                  aria-label="Download CSV"
                >
                  <Icon name="download" size={16} />
                </button>
              </div>

              {/* Row 2: what's applied (removable) and the totals. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
                {launched && rankings.data && (
                  <span className="text-ink-2">
                    Ads launched {shortDate(rankings.data.from)} – {shortDate(rankings.data.to)} ·
                  </span>
                )}
                {podParam === "inhouse" && (
                  <span className="text-ink-2">
                    In-house pods:{" "}
                    {meta.pods
                      .filter((p) => p.kind === "pod" && p.inhouse)
                      .map((p) => p.name)
                      .join(", ")}
                  </span>
                )}
                {[
                  pod !== "" && { key: "pod", text: `Pod: ${pod === "unassigned" ? "Unassigned" : (meta.pods.find((x) => x.id === pod)?.name ?? pod)}`, clear: () => setPod("") },
                  status !== "all" && { key: "status", text: `Status: ${STATUSES.find((x) => x.value === status)?.label ?? status}`, clear: () => setStatus("all") },
                  format !== "" && { key: "format", text: `Format: ${FORMATS[format] ?? format}`, clear: () => setFormat("") },
                  angle !== "" && { key: "angle", text: `Angle: ${ANGLES[angle] ?? angle}`, clear: () => setAngle("") },
                ]
                  .filter((c): c is { key: string; text: string; clear: () => void } => Boolean(c))
                  .map((c, _, all) => (
                    <span key={c.key} className="contents">
                      <button type="button" onClick={c.clear} className="inline-flex items-center gap-1 border border-divider bg-surface px-2 py-1 text-ink hover:border-ink-3" title="Remove this filter">
                        {c.text} <span aria-hidden>✕</span>
                      </button>
                      {c === all[all.length - 1] && all.length > 1 && (
                        <button
                          type="button"
                          className="link"
                          onClick={() => {
                            setPod("");
                            setStatus("all");
                            setFormat("");
                            setAngle("");
                          }}
                        >
                          Clear all
                        </button>
                      )}
                    </span>
                  ))}
                {rankings.data && (
                  <span className="num ml-auto text-ink-3">
                    {int(rankings.data.count)} {rankings.data.count === 1 ? "ad" : "ads"} ·{" "}
                    {rankings.data.from === "2000-01-01" ? "All time" : `${shortDate(rankings.data.from)} – ${shortDate(rankings.data.to)}`} ·{" "}
                    <b className="text-ink">{money(rankings.data.totals.spendCents, { compact: true })}</b> spent · CPA{" "}
                    <b className="text-ink">{dollars(cpa(rankings.data.totals))}</b> · ROAS <b className="text-ink">{roas(rankings.data.totals)?.toFixed(2) ?? "—"}</b>
                  </span>
                )}
              </div>
              {status === "hits_off" && (
                <p className="bg-warn-soft px-3 py-2 text-sm text-ink">
                  ! Hits and late hits that no longer run anywhere: every copy of the creative is paused or off in Meta, or spent nothing in the
                  last 3 synced days. Listed whatever the date range spent; results are for the range shown, so pick All time to see their full
                  results.
                </p>
              )}
              {sort !== "spend" && status !== "hits_off" && rankings.data && (rankings.data.minSpendCents != null || showAll) && (
                <p className="text-xs text-ink-2">
                  {rankings.data.minSpendCents != null ? (
                    <>
                      <Info id="rankMin" /> Ranked among ads that spent at least <b className="text-ink">{money(rankings.data.minSpendCents, { compact: true })}</b> ($
                      {meta.targets.rankMinSpendPerDay} a day × {rankings.data.minDays} days), so a small lucky ad doesn't top the list
                      {rankings.data.belowMin > 0 && (
                        <>
                          {" "}
                          · {int(rankings.data.belowMin)} smaller {rankings.data.belowMin === 1 ? "ad is" : "ads are"} hidden ·{" "}
                          <button type="button" className="link" onClick={() => setShowAll(true)}>
                            Show them
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      Showing every ad, however little it spent ·{" "}
                      <button type="button" className="link" onClick={() => setShowAll(false)}>
                        Hide ads under ${meta.targets.rankMinSpendPerDay} a day
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

            <div>
              <div className="min-w-0">
                <LoadError error={rankings.error} retry={rankings.retry} what="rankings" loading={!rankings.data} rows={8} />
                {rankings.data && items.length === 0 && (
                  <Empty>{status === "hits_off" ? "No hits are turned off: every winner still has a copy running." : "No ads with spend match these filters."}</Empty>
                )}
                {layout === "table" ? (
                  items.length > 0 && (
                    <RankTable
                      items={items.slice(start, start + size)}
                      start={start}
                      targets={meta.targets}
                      activeId={activeId}
                      onSelect={setSelected}
                      sort={sort}
                      onSort={setSort}
                    />
                  )
                ) : (
                  <ol className="flex flex-col gap-2">
                    {items.slice(start, start + size).map((p, i) => (
                      <RankCard
                        key={p.postId}
                        post={p}
                        rank={start + i + 1}
                        targets={meta.targets}
                        active={p.postId === activeId}
                        onSelect={() => setSelected(p.postId)}
                      />
                    ))}
                  </ol>
                )}
                <Pager
                  page={pageNo}
                  size={size}
                  total={items.length}
                  onPage={(n) => {
                    setPage({ query, n });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              </div>
            </div>
            {activeId && (
              <AdDrawer
                title={rank > 0 ? `Ad #${rank} · by ${SORTS.find((x) => x.value === sort)!.label.toLowerCase()}` : "Ad details"}
                onClose={() => {
                  setSelected(null);
                  // Drop ?post= so a reload doesn't reopen it.
                  const [page = "", q = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
                  const params = new URLSearchParams(q);
                  if (params.has("post")) {
                    params.delete("post");
                    const rest = params.toString();
                    history.replaceState(null, "", `#/${page}${rest ? `?${rest}` : ""}`);
                  }
                }}
              >
                <PostDetailPanel postId={activeId} range={range} targets={meta.targets} />
              </AdDrawer>
            )}
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

/**
 * The compact view: one row per ad (about five times as many on screen as the cards), columns that
 * re-sort the list on click, and a row opens the ad's side card like a card does.
 */
function RankTable({
  items,
  start,
  targets,
  activeId,
  onSelect,
  sort,
  onSort,
}: {
  items: PostSummary[];
  start: number;
  targets: Targets;
  activeId: string | null;
  onSelect: (postId: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
}) {
  const head = (label: string, key: SortKey | null, cls = "") =>
    key ? (
      <th className={`py-2 pr-3 text-right font-normal ${cls}`} aria-sort={sort === key ? "descending" : undefined}>
        <button type="button" onClick={() => onSort(key)} className={`kicker hover:text-ink ${sort === key ? "text-ink" : ""}`} title={`Rank by ${label.toLowerCase()}`}>
          {label}
          {sort === key ? " ▼" : ""}
        </button>
      </th>
    ) : (
      <th className={`py-2 pr-3 text-right font-normal ${cls}`}>{label}</th>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] table-fixed text-sm">
        <thead className="kicker text-left">
          <tr className="border-b-2 border-divider">
            <th className="w-9 py-2 font-normal">#</th>
            <th className="w-[44%] py-2 pr-3 font-normal">Ad</th>
            {head("Spend", "spend")}
            {head("Purchases", "purchases", "hidden sm:table-cell")}
            {head("CPA", "cpa")}
            {head("ROAS", "roas")}
            {head("CTR", "ctr", "hidden md:table-cell")}
            <th className="hidden py-2 pr-3 text-right font-normal lg:table-cell">
              Days live <Info id="daysLive" />
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((p, i) => (
            <tr
              key={p.postId}
              onClick={() => onSelect(p.postId)}
              className={`cursor-pointer border-b border-divider hover:bg-surface ${p.postId === activeId ? "bg-surface" : ""}`}
            >
              <td className="num py-2 align-middle font-bold text-ink-3">{start + i + 1}</td>
              <td className="max-w-0 py-2 pr-3">
                <button type="button" className="flex w-full min-w-0 items-center gap-2.5 text-left" onClick={() => onSelect(p.postId)}>
                  <Thumb mediaType={p.mediaType} label="" url={p.thumbnailUrl} className="h-10 w-7 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink" title={p.name}>
                      {p.name}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
                      <PodChip podId={p.assignment.podId} source={p.assignment.podSource} />
                      {!p.active && <Tag tone="outline">Paused</Tag>}
                      <FatigueTag f={p.fatigue} />
                      <HitBadge status={p.hit} />
                    </span>
                  </span>
                </button>
              </td>
              <td className="num py-2 pr-3 text-right text-ink">{money(p.totals.spendCents, { compact: true })}</td>
              <td className="num hidden py-2 pr-3 text-right text-ink sm:table-cell">{int(p.totals.purchases)}</td>
              <td className="py-2 pr-3 text-right">
                <CpaValue value={cpa(p.totals)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
              </td>
              <td className="py-2 pr-3 text-right">
                <RoasValue value={roas(p.totals)} target={targets.targetRoas} />
              </td>
              <td className="num hidden py-2 pr-3 text-right text-ink md:table-cell">{pct(ctr(p.totals))}</td>
              <td className="num hidden py-2 pr-3 text-right text-ink-3 lg:table-cell">{p.daysLive ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function PostDetailPanel({ postId, range, targets }: { postId: string; range: Range; targets: Targets }) {
  const { data, error } = useApi<PostDetail>(`/api/posts/${encodeURIComponent(postId)}?${qs({ range })}`);
  const attr = useApi<AttributionResponse>(`/api/attribution?${qs({ range, level: "post", post: postId })}`);
  const click7 = attr.data?.rows[0]?.click7 ?? null;
  if (error) return <Empty>Couldn't load this ad: {error.message}</Empty>;
  if (!data || data.postId !== postId) return <Skeleton rows={8} />;
  const a = data.assignment;
  const tags: [string, string | null][] = [
    ["Angle", a.angle ? (ANGLES[a.angle] ?? a.angle) : null],
    ["Format", a.format ? (FORMATS[a.format] ?? a.format) : null],
    ["Hook", a.hook],
    ["Landing page", a.landingPage],
  ];
  const campaigns = [...new Set(data.copyRows.map((c) => c.campaignName).filter(Boolean))];

  return (
    <div className="flex flex-col gap-5">
      <span className="flex flex-wrap gap-1.5">
        <Tag>{data.active ? "Active" : "Paused"}</Tag>
        <FatigueTag f={data.fatigue} />
        <HitBadge status={data.hit} />
      </span>
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
          // Images in the feed's 4:5, videos in 9:16, so neither is cropped.
          className={`${data.mediaType === "image" ? "aspect-[4/5] max-w-48" : "aspect-[9/16] max-w-40"} w-full shrink-0`}
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

/** An ad's details, sliding in from the right over the list (full screen on a phone). Esc or the backdrop closes it. */
function AdDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useLockBodyScroll();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Ad details">
      <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div className="slide-in relative flex h-full w-full max-w-[760px] flex-col bg-page shadow-xl">
        <div className="flex items-center justify-between border-b-2 border-divider px-5 py-3">
          <span className="kicker">{title}</span>
          <button className="btn btn-secondary" onClick={onClose} aria-label="Close ad details">
            ✕
          </button>
        </div>
        <div className="drawer-scroll flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** "Filters · 2": opens a small panel with the filter dropdowns; Esc or a click outside closes it. */
function FiltersButton({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" className={`btn ${count ? "btn-primary" : "btn-secondary"}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="filter" size={16} />
        Filters{count ? ` · ${count}` : ""}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 grid w-[min(92vw,420px)] grid-cols-2 gap-3 border-2 border-divider bg-page p-4 shadow-xl">{children}</div>
      )}
    </div>
  );
}
