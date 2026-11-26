import { useMemo, useState, type ReactNode } from "react";
import type { BfcmAd, BfcmAdset, BfcmDay, BfcmResponse, MetaResponse } from "../../shared/api.ts";
import { podById } from "../../shared/taxonomy.ts";
import { BFCM, BFCM_GENERAL, bfcmCall, BFCM_EARLY_DOLLARS, BFCM_JUDGE_DOLLARS, bfcmSum, bfcmWindow, type BfcmAction, type BfcmTotals, type BfcmView } from "../../shared/bfcm.ts";
import { addTotals, cpa, ctr, roas, ZERO_TOTALS, type Targets, type Totals } from "../../shared/metrics.ts";
import { useApi } from "../api.ts";
import { FrequencyValue } from "../components/PodReach.tsx";
import { HeaderControls } from "../components/HeaderControls.tsx";
import { TrendCharts } from "../components/TrendCharts.tsx";
import { CpaValue, CsvButton, Empty, LoadError, PageHeader, PodChip, PodSwatch, RoasValue, SectionTitle, Segmented, Stat, Tag, Thumb } from "../components/ui.tsx";
import { dollars, downloadCsv, int, money, pct, shortDate } from "../format.ts";

type View = BfcmView;
type Sort = "spend" | "roas" | "cpa" | "purchases" | "ctr";
const windowOf = bfcmWindow;

type Row = BfcmAd & { totals: BfcmTotals; promo: Totals; action: BfcmAction; reason: string };

const ACTION: Record<BfcmAction, { label: string; icon: string; cls: string }> = {
  scale: { label: "Scale", icon: "↑", cls: "border-good text-good" },
  watch: { label: "Watch", icon: "!", cls: "border-warn-line text-warn" },
  cut: { label: "Cut", icon: "✕", cls: "border-bad text-bad" },
  early: { label: "Too early", icon: "…", cls: "border-divider text-ink-3" },
};

function ActionTag({ action }: { action: BfcmAction }) {
  const a = ACTION[action];
  return (
    <span className={`inline-flex items-center gap-1 border px-1.5 py-px text-xs font-semibold whitespace-nowrap ${a.cls}`}>
      <span aria-hidden>{a.icon}</span>
      {a.label}
    </span>
  );
}

/**
 * BFCM (owner, Nov 8): the promo campaign only, Nov 8 – Dec 1, with a Scale / Watch / Cut call for
 * each ad on the usual targets. Promo ad sets don't count in the pods' hit rate.
 */
export function BfcmPage({ meta }: { meta: MetaResponse }) {
  const { data, error, retry } = useApi<BfcmResponse>("/api/bfcm");
  const [view, setView] = useState<View>("promo");
  const [sort, setSort] = useState<Sort>("spend");
  const t = meta.targets;
  const latest = data?.latest && data.latest > BFCM.to ? BFCM.to : (data?.latest ?? null);
  const started = latest != null && latest >= BFCM.from;

  const rows = useMemo<Row[]>(() => {
    if (!data || !latest || !started) return [];
    const win = windowOf(view, latest);
    return data.ads.map((a) => ({ ...a, totals: bfcmSum(a.daily, win), ...bfcmCall(a.daily, latest, t) }));
  }, [data, latest, started, view, t]);

  const total = rows.reduce<Totals>((acc, r) => addTotals(acc, r.totals), ZERO_TOTALS);
  const days = useMemo(() => {
    if (!data || !latest) return [];
    const byDate = new Map<string, Totals>();
    for (const a of data.ads) for (const d of a.daily) if (d.date <= latest) byDate.set(d.date, addTotals(byDate.get(d.date) ?? ZERO_TOTALS, d));
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([start, totals]) => ({ start, totals }));
  }, [data, latest]);
  const dayN = latest ? Math.round((Date.parse(latest) - Date.parse(BFCM.from)) / 86_400_000) + 1 : 0;
  const totalDays = Math.round((Date.parse(BFCM.to) - Date.parse(BFCM.from)) / 86_400_000) + 1;
  const win = latest ? windowOf(view, latest) : null;
  const viewLabel = win ? (win[0] === win[1] ? shortDate(win[0]) : `${shortDate(win[0])} – ${shortDate(win[1])}`) : "";

  return (
    <div>
      <PageHeader
        title="BFCM"
        subtitle={
          <>
            {BFCM.label} · {shortDate(BFCM.from)} – {shortDate(BFCM.to)} · Meta numbers, this campaign only · not counted in pod hit rates
          </>
        }
      >
        <HeaderControls meta={meta} syncNow />
      </PageHeader>
      <div className="flex flex-col gap-8 px-4 py-6 md:px-8">
        <LoadError error={error} retry={retry} what="the BFCM ads" loading={!data} rows={6} />
        {data && data.ads.length === 0 && <Empty>No ads found in {BFCM.label} yet. They appear after the next sync.</Empty>}
        {data && data.ads.length > 0 && !started && (
          <Empty>
            {data.ads.length} ads are scheduled. Numbers start on {shortDate(BFCM.from)}: press Sync now on the Dashboard once they've spent.
          </Empty>
        )}
        {started && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                label="Period"
                value={view}
                onChange={setView}
                options={[
                  { value: "promo", label: "Promo so far" },
                  { value: "last3", label: "Last 3 days" },
                  { value: "before", label: "Day before" },
                  { value: "latest", label: "Latest day" },
                ]}
              />
              <span className="text-sm text-ink-2">
                {viewLabel} · day {Math.min(dayN, totalDays)} of {totalDays}
                {latest === new Date().toISOString().slice(0, 10) && view !== "promo" && view !== "before" && " · today is still filling in"}
              </span>
            </div>

            <section className="grid grid-cols-2 gap-px border-2 border-divider bg-divider sm:grid-cols-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
              <Tile label="Spend">{money(total.spendCents)}</Tile>
              <Tile label="Revenue">{money(total.revenueCents)}</Tile>
              <Tile label="Purchases">{int(total.purchases)}</Tile>
              <Tile label="ROAS" sub={`Target ${t.targetRoas}`}>
                <RoasValue value={roas(total)} target={t.targetRoas} />
              </Tile>
              <Tile label="CPA" sub={`Target $${t.targetCpa}`}>
                <CpaValue value={cpa(total)} target={t.targetCpa} warnMax={t.targetCpa * 1.25} />
              </Tile>
            </section>

            <section className="flex flex-col gap-3">
              <SectionTitle title="Day by day" className="mb-0" />
              <p className="text-sm text-ink-3">
                {BFCM.days.map((d) => `${d.label} ${shortDate(d.date)}`).join(" · ")} · ends {shortDate(BFCM.to)}
              </p>
              <TrendCharts points={days} targetCpa={t.targetCpa} targetRoas={t.targetRoas} />
            </section>

            <PodBoard adsets={data?.adsets ?? []} win={win!} t={t} viewLabel={viewLabel} />
            <ActionBoard rows={rows} t={t} />
            <Rankings rows={rows} sort={sort} setSort={setSort} t={t} viewLabel={viewLabel} />
            <Batches rows={rows} t={t} viewLabel={viewLabel} />
            <FatigueWatch rows={rows} />
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="bg-page px-4 py-3">
      <Stat label={label} sub={sub}>
        {children}
      </Stat>
    </div>
  );
}

const postHref = (postId: string) => `#/rankings?post=${encodeURIComponent(postId)}`;

type Group = { id: string; name: string; liveAds: number; totals: Totals; adsets: { name: string; liveAds: number; totals: Totals }[] };

const groupName = (id: string) => (id === BFCM_GENERAL.id ? BFCM_GENERAL.name : (podById(id)?.name ?? id));

function GroupChip({ id }: { id: string }) {
  if (id !== BFCM_GENERAL.id) return <PodChip podId={id} />;
  return (
    <span className="inline-flex items-center gap-1.5 border border-divider px-1.5 py-px text-xs whitespace-nowrap text-ink">
      <span className="inline-block size-2.5 shrink-0" style={{ background: "repeating-linear-gradient(135deg, var(--ink-3) 0 2px, transparent 2px 4px)" }} aria-hidden />
      {BFCM_GENERAL.name}
    </span>
  );
}

/**
 * BFCM by pod (owner, Nov 26): the promo's spend and results by who made each ad set, like the pod
 * leaderboard but for BFCM only. A pod counts the ad sets naming its strategist; Agency the ones starting
 * with Agency / ME / QW / TV / YD (this page only); General In-house the rest. Ranked by spend.
 */
function PodBoard({ adsets, win, t, viewLabel }: { adsets: BfcmAdset[]; win: [string, string]; t: Targets; viewLabel: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => {
    const by = new Map<string, Group>();
    for (const s of adsets) {
      const g = by.get(s.group) ?? { id: s.group, name: groupName(s.group), liveAds: 0, totals: ZERO_TOTALS, adsets: [] };
      const totals = s.daily.filter((d) => d.date >= win[0] && d.date <= win[1]).reduce<Totals>((acc, d) => addTotals(acc, d), ZERO_TOTALS);
      g.liveAds += s.liveAds;
      g.totals = addTotals(g.totals, totals);
      if (totals.spendCents > 0 || totals.purchases > 0 || s.liveAds > 0) g.adsets.push({ name: s.name, liveAds: s.liveAds, totals });
      by.set(s.group, g);
    }
    return [...by.values()]
      .filter((g) => g.totals.spendCents > 0 || g.liveAds > 0)
      .map((g) => ({ ...g, adsets: g.adsets.sort((a, b) => b.totals.spendCents - a.totals.spendCents) }))
      .sort((a, b) => b.totals.spendCents - a.totals.spendCents || a.name.localeCompare(b.name));
  }, [adsets, win]);
  if (groups.length === 0) return null;
  const total = groups.reduce<Totals>((acc, g) => addTotals(acc, g.totals), ZERO_TOTALS);
  const live = groups.reduce((n, g) => n + g.liveAds, 0);
  const share = (g: Group) => (total.spendCents > 0 ? g.totals.spendCents / total.spendCents : null);
  const csv = () =>
    downloadCsv(
      `bfcm-by-pod-${win[0]}-${win[1]}.csv`,
      ["Group", "Live ads", "Spend", "Share", "Purchases", "CPA", "ROAS"],
      groups.map((g) => [g.name, g.liveAds, (g.totals.spendCents / 100).toFixed(2), share(g)?.toFixed(3), g.totals.purchases, cpa(g.totals)?.toFixed(2), roas(g.totals)?.toFixed(2)]),
    );
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title={`BFCM by pod · ${viewLabel}`} right={<CsvButton onClick={csv} />} className="mb-0" />
      <p className="text-sm text-ink-3">
        This campaign only, not in the main pod leaderboard. A pod counts the ad sets naming its strategist; Agency the ones starting with
        Agency / ME / QW / TV / YD; {BFCM_GENERAL.name} the rest. Click a row for its ad sets.
      </p>
      {total.spendCents > 0 && (
        <div>
          <div className="flex h-4 w-full gap-0.5 overflow-hidden" role="img" aria-label="BFCM spend share by group">
            {groups
              .filter((g) => g.totals.spendCents > 0)
              .map((g) => (
                <div
                  key={g.id}
                  title={`${g.name}: ${money(g.totals.spendCents)} (${pct(share(g), 0)})`}
                  style={{
                    width: `${share(g)! * 100}%`,
                    background: g.id === BFCM_GENERAL.id ? "repeating-linear-gradient(135deg, var(--ink-3) 0 3px, var(--surface-2) 3px 6px)" : `var(--pod-${g.id})`,
                  }}
                />
              ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
            {groups
              .filter((g) => g.totals.spendCents > 0)
              .map((g) => (
                <span key={g.id} className="num inline-flex items-center gap-1.5">
                  {g.id === BFCM_GENERAL.id ? (
                    <span className="inline-block size-2.5 shrink-0" style={{ background: "repeating-linear-gradient(135deg, var(--ink-3) 0 2px, transparent 2px 4px)" }} aria-hidden />
                  ) : (
                    <PodSwatch podId={g.id} />
                  )}
                  <b className="font-semibold text-ink">{g.name}</b> {pct(share(g), 0)} · {money(g.totals.spendCents, { compact: true })}
                </span>
              ))}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="kicker text-left">
            <tr className="border-b-2 border-divider">
              <th className="w-8 py-2 font-normal">#</th>
              <th className="py-2 pr-3 font-normal">Group</th>
              <th className="py-2 pr-3 text-right font-normal">Live ads</th>
              <th className="py-2 pr-3 text-right font-normal">Spend · Meta</th>
              <th className="py-2 pr-3 text-right font-normal">Share</th>
              <th className="py-2 pr-3 text-right font-normal">Purchases</th>
              <th className="py-2 pr-3 text-right font-normal">CPA · Meta</th>
              <th className="py-2 text-right font-normal">ROAS · Meta</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, i) => (
              <GroupRows key={g.id} g={g} rank={i + 1} share={share(g)} t={t} open={open === g.id} onToggle={() => setOpen(open === g.id ? null : g.id)} />
            ))}
            <tr className="border-t-2 border-divider font-bold text-ink">
              <td />
              <td className="py-2 pr-3">Total</td>
              <td className="num py-2 pr-3 text-right">{int(live)}</td>
              <td className="num py-2 pr-3 text-right">{money(total.spendCents)}</td>
              <td className="num py-2 pr-3 text-right">100%</td>
              <td className="num py-2 pr-3 text-right">{int(total.purchases)}</td>
              <td className="py-2 pr-3 text-right">
                <CpaValue value={cpa(total)} target={t.targetCpa} warnMax={t.targetCpa * 1.25} />
              </td>
              <td className="py-2 text-right">
                <RoasValue value={roas(total)} target={t.targetRoas} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GroupRows({ g, rank, share, t, open, onToggle }: { g: Group; rank: number; share: number | null; t: Targets; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-b border-divider hover:bg-surface" onClick={onToggle} aria-expanded={open}>
        <td className="num py-2.5 font-bold text-ink-3">{rank}</td>
        <td className="py-2.5 pr-3">
          <span className="inline-flex items-center gap-2">
            <GroupChip id={g.id} />
            <span className="text-xs text-ink-3" aria-hidden>
              {open ? "▾" : "▸"} {g.adsets.length} ad sets
            </span>
          </span>
        </td>
        <td className="num py-2.5 pr-3 text-right text-ink">{int(g.liveAds)}</td>
        <td className="num py-2.5 pr-3 text-right font-bold text-ink">{money(g.totals.spendCents)}</td>
        <td className="num py-2.5 pr-3 text-right text-ink-2">{pct(share, 0)}</td>
        <td className="num py-2.5 pr-3 text-right text-ink">{int(g.totals.purchases)}</td>
        <td className="py-2.5 pr-3 text-right">
          <CpaValue value={cpa(g.totals)} target={t.targetCpa} warnMax={t.targetCpa * 1.25} />
        </td>
        <td className="py-2.5 text-right">
          <RoasValue value={roas(g.totals)} target={t.targetRoas} />
        </td>
      </tr>
      {open &&
        g.adsets.map((s) => (
          <tr key={s.name} className="border-b border-divider bg-surface text-xs">
            <td />
            <td className="max-w-[360px] truncate py-1.5 pr-3 pl-4 text-ink-2" title={s.name}>
              {s.name}
            </td>
            <td className="num py-1.5 pr-3 text-right text-ink-2">{int(s.liveAds)}</td>
            <td className="num py-1.5 pr-3 text-right text-ink-2">{money(s.totals.spendCents)}</td>
            <td />
            <td className="num py-1.5 pr-3 text-right text-ink-2">{int(s.totals.purchases)}</td>
            <td className="py-1.5 pr-3 text-right">
              <CpaValue value={cpa(s.totals)} target={t.targetCpa} warnMax={t.targetCpa * 1.25} />
            </td>
            <td className="py-1.5 text-right">
              <RoasValue value={roas(s.totals)} target={t.targetRoas} />
            </td>
          </tr>
        ))}
    </>
  );
}

function ActionBoard({ rows, t }: { rows: Row[]; t: Targets }) {
  const groups: BfcmAction[] = ["scale", "watch", "cut"];
  const early = rows.filter((r) => r.action === "early").length;
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title="What to do" className="mb-0" />
      <p className="max-w-[110ch] text-sm text-ink-3">
        On the promo so far and the last 3 synced days, whatever period is picked above. <b>Scale</b>: ${BFCM_JUDGE_DOLLARS}+ spent in the last
        3 days at target (ROAS {t.targetRoas}+ or CPA ${t.targetCpa} or less) and not slipping. <b>Cut</b>: ${BFCM_JUDGE_DOLLARS}+ spent with no
        purchase, or ROAS under 1.0. <b>Too early</b>: under ${BFCM_EARLY_DOLLARS} spent. The hub never changes ads in Meta.
      </p>
      <div className="grid gap-3 lg:grid-cols-3">
        {groups.map((g) => {
          const list = rows.filter((r) => r.action === g).sort((a, b) => b.promo.spendCents - a.promo.spendCents);
          return (
            <div key={g} className="flex min-w-0 flex-col gap-2 border-2 border-divider p-3">
              <div className="flex items-center justify-between">
                <ActionTag action={g} />
                <span className="num text-sm text-ink-3">{list.length}</span>
              </div>
              {list.length === 0 && <p className="text-sm text-ink-3">None right now.</p>}
              {list.map((r) => (
                <a key={r.postId} href={postHref(r.postId)} className="flex min-w-0 items-center gap-2.5 py-1 hover:bg-surface">
                  <Thumb mediaType={r.mediaType} label="" url={r.thumbnailUrl} className="h-11 w-8 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink" title={r.name}>
                      {r.name}
                    </span>
                    <span className="block text-xs text-ink-3">{r.reason}</span>
                  </span>
                </a>
              ))}
            </div>
          );
        })}
      </div>
      {early > 0 && <p className="text-sm text-ink-3">{early} more too early to call.</p>}
    </section>
  );
}

const SORTS: { key: Sort; label: string; value: (t: Totals) => number | null }[] = [
  { key: "spend", label: "Spend", value: (t) => t.spendCents },
  { key: "purchases", label: "Purchases", value: (t) => t.purchases },
  { key: "roas", label: "ROAS", value: roas },
  { key: "cpa", label: "CPA", value: (t) => (cpa(t) == null ? null : -cpa(t)!) },
  { key: "ctr", label: "CTR", value: ctr },
];

function Rankings({ rows, sort, setSort, t, viewLabel }: { rows: Row[]; sort: Sort; setSort: (s: Sort) => void; t: Targets; viewLabel: string }) {
  const by = SORTS.find((s) => s.key === sort)!.value;
  const list = rows
    .filter((r) => r.totals.spendCents > 0 || r.totals.purchases > 0)
    .sort((a, b) => {
      const va = by(a.totals);
      const vb = by(b.totals);
      if (va == null) return vb == null ? b.totals.spendCents - a.totals.spendCents : 1;
      if (vb == null) return -1;
      return vb - va || b.totals.spendCents - a.totals.spendCents;
    });
  // Every row's ROAS bars on the same promo days, so a day sits in the same place in each row.
  const dates = [...new Set(list.flatMap((r) => r.daily.map((d) => d.date)))].sort();
  const head = (label: string, key: Sort | null, cls = "") =>
    key ? (
      <th className={`py-2 pr-3 text-right font-normal ${cls}`}>
        <button type="button" onClick={() => setSort(key)} className={`kicker hover:text-ink ${sort === key ? "text-ink" : ""}`}>
          {label}
          {sort === key ? " ▼" : ""}
        </button>
      </th>
    ) : (
      <th className={`py-2 pr-3 text-right font-normal ${cls}`}>{label}</th>
    );
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title={`Rankings · ${viewLabel}`} className="mb-0" />
      {list.length === 0 ? (
        <Empty small>No BFCM spend in this period.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="kicker text-left">
              <tr className="border-b-2 border-divider">
                <th className="w-8 py-2 font-normal">#</th>
                <th className="py-2 pr-3 font-normal">Ad</th>
                {head("Spend", "spend")}
                {head("Purchases", "purchases")}
                {head("ROAS", "roas")}
                {head("CPA", "cpa")}
                {head("CTR", "ctr")}
                {head("CPM", null)}
                {head("Outbound CPC", null)}
                {head("Cost / ATC", null)}
                <th className="w-px whitespace-nowrap py-2 pr-3 font-normal">
                  <span className="inline-grid grid-cols-[2.5rem_3.75rem] gap-x-2">
                    <span className="col-span-2 text-left">Daily freq.</span>
                  </span>
                </th>
                <th className="py-2 pl-2 font-normal">ROAS by day</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => {
                const s = r.totals;
                const per = (n: number | null) => (n == null ? null : n > 0 ? s.spendCents / 100 / n : null);
                return (
                  <tr key={r.postId} className="border-b border-divider">
                    <td className="num py-2 font-bold text-ink-3">{i + 1}</td>
                    <td className="w-[30%] py-2 pr-3">
                      <a href={postHref(r.postId)} className="flex min-w-[260px] max-w-[420px] items-center gap-2.5">
                        <Thumb mediaType={r.mediaType} label="" url={r.thumbnailUrl} className="h-11 w-8 shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-ink" title={r.name}>
                            {r.name}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                            <ActionTag action={r.action} />
                            {!r.active && <Tag tone="outline">Off</Tag>}
                            {r.podId && <PodChip podId={r.podId} />}
                            <span className="truncate">{r.adsets.join(", ")}</span>
                          </span>
                        </span>
                      </a>
                    </td>
                    <td className="num py-2 pr-3 text-right text-ink">{money(s.spendCents, { compact: true })}</td>
                    <td className="num py-2 pr-3 text-right text-ink">{int(s.purchases)}</td>
                    <td className="py-2 pr-3 text-right">
                      <RoasValue value={roas(s)} target={t.targetRoas} />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <CpaValue value={cpa(s)} target={t.targetCpa} warnMax={t.targetCpa * 1.25} />
                    </td>
                    <td className="num py-2 pr-3 text-right text-ink">{pct(ctr(s))}</td>
                    <td className="num py-2 pr-3 text-right text-ink">{dollars(s.impressions > 0 ? s.spendCents / 100 / (s.impressions / 1000) : null)}</td>
                    <td className="num py-2 pr-3 text-right text-ink">{dollars(per(s.outboundClicks))}</td>
                    <td className="num py-2 pr-3 text-right text-ink">{dollars(per(s.addToCart))}</td>
                    <td className="py-2 pr-3 text-ink">
                      <FrequencyValue totals={s} targets={t} short column />
                    </td>
                    <td className="py-2 pl-2 align-middle">
                      <RoasBars days={r.daily} dates={dates} target={t.targetRoas} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Each promo day's ROAS as a thin bar, with the target as a line (hover a bar for the day). `dates` are the
 * days of the whole table, so every row has the same width and each day the same place; a day the ad
 * didn't spend is left empty.
 */
function RoasBars({ days, dates, target }: { days: BfcmDay[]; dates: string[]; target: number }) {
  const byDate = new Map(days.map((d) => [d.date, roas(d)]));
  const vals = dates.map((date) => ({ date, r: byDate.get(date) ?? null }));
  if (days.length === 0) return <span className="text-ink-3">—</span>;
  const max = Math.max(target * 1.5, ...vals.map((v) => v.r ?? 0));
  const H = 28;
  const W = Math.max(40, vals.length * 6);
  return (
    <svg width={W} height={H} role="img" aria-label="ROAS by day" className="block">
      <line x1={0} x2={W} y1={H - (target / max) * H} y2={H - (target / max) * H} stroke="var(--ink-3)" strokeDasharray="2 2" strokeWidth={1} />
      {vals.map((v, i) => {
        const h = v.r == null ? 0 : Math.max(1, (v.r / max) * H);
        return (
          <rect key={v.date} x={i * 6} y={H - h} width={4} height={h} fill={v.r != null && v.r >= target ? "var(--good)" : "var(--chart-bar)"}>
            <title>{`${shortDate(v.date)}: ROAS ${v.r == null ? "—" : v.r.toFixed(2)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/** Ad sets rolled up by their first two name parts ("Statics | Black Friday", "Shameer | Black Friday"). */
function Batches({ rows, t, viewLabel }: { rows: Row[]; t: Targets; viewLabel: string }) {
  const groups = new Map<string, { totals: Totals; ads: number }>();
  for (const r of rows) {
    const key = r.adsets[0]?.split("|").slice(0, 2).map((s) => s.trim()).join(" | ") ?? "Other";
    const g = groups.get(key) ?? { totals: ZERO_TOTALS, ads: 0 };
    g.totals = addTotals(g.totals, r.totals);
    g.ads++;
    groups.set(key, g);
  }
  const list = [...groups.entries()].sort(([, a], [, b]) => b.totals.spendCents - a.totals.spendCents);
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title={`By batch · ${viewLabel}`} className="mb-0" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="kicker text-left">
            <tr className="border-b-2 border-divider">
              <th className="py-2 pr-3 font-normal">Group</th>
              <th className="py-2 pr-3 text-right font-normal">Ads</th>
              <th className="py-2 pr-3 text-right font-normal">Spend</th>
              <th className="py-2 pr-3 text-right font-normal">Purchases</th>
              <th className="py-2 pr-3 text-right font-normal">ROAS</th>
              <th className="py-2 text-right font-normal">CPA</th>
            </tr>
          </thead>
          <tbody>
            {list.map(([name, g]) => (
              <tr key={name} className="border-b border-divider">
                <td className="py-2 pr-3 font-semibold text-ink">{name}</td>
                <td className="num py-2 pr-3 text-right text-ink">{g.ads}</td>
                <td className="num py-2 pr-3 text-right text-ink">{money(g.totals.spendCents, { compact: true })}</td>
                <td className="num py-2 pr-3 text-right text-ink">{int(g.totals.purchases)}</td>
                <td className="py-2 pr-3 text-right">
                  <RoasValue value={roas(g.totals)} target={t.targetRoas} />
                </td>
                <td className="py-2 text-right">
                  <CpaValue value={cpa(g.totals)} target={t.targetCpa} warnMax={t.targetCpa * 1.25} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FatigueWatch({ rows }: { rows: Row[] }) {
  const list = rows.filter((r) => r.fatigue && r.active);
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title="Fatigue watch" className="mb-0" />
      {list.length === 0 ? (
        <p className="text-sm text-ink-3">No running BFCM ad shows fatigue (rising frequency, falling CTR or rising CPA) right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((r) => (
            <li key={r.postId}>
              <a href={postHref(r.postId)} className="flex items-center gap-2.5 hover:bg-surface">
                <Thumb mediaType={r.mediaType} label="" url={r.thumbnailUrl} className="h-11 w-8 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{r.name}</span>
                  <span className="text-xs text-ink-3">
                    {r.fatigue!.status === "fatigued" ? "✕ Fatiguing" : "! Worth watching"} · {r.fatigue!.signals.join(", ")}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
