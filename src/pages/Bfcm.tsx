import { useMemo, useState, type ReactNode } from "react";
import type { BfcmAd, BfcmDay, BfcmResponse, MetaResponse } from "../../shared/api.ts";
import { BFCM, bfcmCall, BFCM_EARLY_DOLLARS, BFCM_JUDGE_DOLLARS, bfcmSum, bfcmWindow, type BfcmAction, type BfcmTotals, type BfcmView } from "../../shared/bfcm.ts";
import { addTotals, cpa, ctr, roas, ZERO_TOTALS, type Targets, type Totals } from "../../shared/metrics.ts";
import { useApi } from "../api.ts";
import { FrequencyValue } from "../components/PodReach.tsx";
import { HeaderControls } from "../components/HeaderControls.tsx";
import { TrendCharts } from "../components/TrendCharts.tsx";
import { CpaValue, Empty, LoadError, PageHeader, PodChip, RoasValue, SectionTitle, Segmented, Stat, Tag, Thumb } from "../components/ui.tsx";
import { dollars, int, money, pct, shortDate } from "../format.ts";

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
                {head("Daily freq.", null)}
                <th className="py-2 font-normal">ROAS by day</th>
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
                    <td className="py-2 pr-3 text-right text-ink">
                      <FrequencyValue totals={s} targets={t} short />
                    </td>
                    <td className="py-2">
                      <RoasBars days={r.daily} target={t.targetRoas} />
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

/** Each promo day's ROAS as a thin bar, with the target as a line (hover a bar for the day). */
function RoasBars({ days, target }: { days: BfcmDay[]; target: number }) {
  const vals = days.map((d) => ({ date: d.date, r: roas(d) }));
  if (vals.length === 0) return <span className="text-ink-3">—</span>;
  const max = Math.max(target * 1.5, ...vals.map((v) => v.r ?? 0));
  const H = 28;
  const W = Math.max(40, vals.length * 6);
  return (
    <svg width={W} height={H} role="img" aria-label="ROAS by day">
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
