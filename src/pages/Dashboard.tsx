import { useState, type ReactNode } from "react";
import type { AlertsResponse, LaunchesResponse, MetaResponse, PodRow, PodsResponse, RankingsResponse, TrendGrain, TrendsResponse } from "../../shared/api.ts";
import { cpa, roas, type Targets } from "../../shared/metrics.ts";
import { qs, useApi } from "../api.ts";
import { HeaderControls, previousPeriod, rangeLabel, shiftDay, type Range } from "../components/HeaderControls.tsx";
import { PodSpend } from "../components/PodSpend.tsx";
import { Sparkline } from "../components/Sparkline.tsx";
import { TrendCharts } from "../components/TrendCharts.tsx";
import { CpaValue, Icon, PageHeader, PodChip, RoasValue, SectionTitle, Segmented, Select, Tag, Thumb, LoadError } from "../components/ui.tsx";
import { int, money, pct, shortDate } from "../format.ts";

function Delta({ now, before, better, fmt }: { now: number | null; before: number | null; better: "up" | "down"; fmt: (d: number) => string }) {
  if (now == null || before == null || before === 0) return null;
  const change = now / before - 1;
  const good = better === "up" ? change >= 0 : change <= 0;
  return (
    <span className={`num font-bold ${good ? "text-good" : "text-bad"}`}>
      {change >= 0 ? "▲" : "▼"} {fmt(change)}
    </span>
  );
}

function Kpi({ label, source, value, sub }: { label: string; source: string; value: ReactNode; sub: ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-4">
      <div className="flex items-start justify-between gap-2">
        <span className="kicker">{label}</span>
        <Tag>{source}</Tag>
      </div>
      <div className="num mt-2 text-[32px] leading-none font-extrabold tracking-[-0.02em] text-ink">{value}</div>
      <div className="mt-2 flex flex-wrap gap-x-2 text-xs text-ink-3">{sub}</div>
    </div>
  );
}

export function DashboardPage({ meta, range, setRange }: { meta: MetaResponse; range: Range; setRange: (r: Range) => void }) {
  const top = useApi<RankingsResponse>(`/api/rankings?${qs({ range, sort: "spend", limit: 5 })}`);
  const pods = useApi<PodsResponse>(`/api/pods?${qs({ range })}`);
  const alerts = useApi<AlertsResponse>("/api/alerts");
  const launches = useApi<LaunchesResponse>("/api/launches?weeks=1");
  const prev = previousPeriod(range, meta.latestDate);
  const before = useApi<RankingsResponse>(prev ? `/api/rankings?${qs({ range: "custom", from: prev.from, to: prev.to, limit: 1 })}` : null);
  const t = top.data?.totals;
  const b = prev ? before.data?.totals : undefined;
  const tg = meta.targets;
  const sparkDays = meta.latestDate ? Array.from({ length: 7 }, (_, i) => shiftDay(meta.latestDate!, i - 6)) : [];
  const ranked = (pods.data?.rows ?? []).filter((r) => r.kind === "pod").sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1) || b.totals.spendCents - a.totals.spendCents);
  const agency = pods.data?.rows.find((r) => r.kind === "agency");
  const pctFmt = (d: number) => pct(Math.abs(d), 1);
  // While the totals load the cards say so ("…"); "—" is kept for numbers that really are missing.
  const kpi = (v: ReactNode) => (t ? v : top.loading ? "…" : "—");

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Kojeva performance on Meta">
        <HeaderControls meta={meta} range={range} setRange={setRange} />
      </PageHeader>

      <div className="flex flex-col gap-8 px-4 py-6 md:px-8">
        <LoadError error={top.error} retry={top.retry} what="the totals" />
        <div className="grid grid-cols-2 gap-0.5 border-2 border-divider bg-divider lg:grid-cols-4 [&>*]:bg-page">
          <Kpi
            label="Spend"
            source="Meta"
            value={kpi(money(t?.spendCents, { compact: true }))}
            sub={b && t && <><Delta now={t.spendCents} before={b.spendCents} better="up" fmt={pctFmt} /> {prev?.label}</>}
          />
          <Kpi
            label="Purchases"
            source="Meta"
            value={kpi(int(t?.purchases))}
            sub={b && t && <><Delta now={t.purchases} before={b.purchases} better="up" fmt={pctFmt} /> {prev?.label}</>}
          />
          <Kpi
            label="CPA"
            source="Meta"
            value={kpi(t && <CpaValue value={cpa(t)} target={tg.targetCpa} warnMax={tg.cpaWarnMax} />)}
            sub={<>{b && t && <Delta now={cpa(t)} before={cpa(b)} better="down" fmt={pctFmt} />} Target ${tg.targetCpa.toFixed(2)}</>}
          />
          <Kpi
            label="ROAS"
            source="Meta"
            value={kpi(t && <RoasValue value={roas(t)} target={tg.targetRoas} />)}
            sub={<>{b && t && <Delta now={roas(t)} before={roas(b)} better="up" fmt={pctFmt} />} Target {tg.targetRoas.toFixed(2)}</>}
          />
        </div>

        <AlertsSection alerts={alerts} />

        <PodSpend range={range} latest={meta.latestDate} targets={tg} compact />

        <section>
          <SectionTitle title="Pod leaderboard" right={pods.data && `Ranked by hit rate · ${shortDate(pods.data.from === "2000-01-01" ? null : pods.data.from)} – ${shortDate(pods.data.to)} · Meta`} />
          <LoadError error={pods.error} retry={pods.retry} what="the pods" />
          <Leaderboard rows={ranked} agency={agency} targets={tg} sparkDays={sparkDays} launches={launches.data} />
        </section>

        <TrendsSection meta={meta} range={range} />

          <section>
            <SectionTitle
              title={`Top 5 ads ${rangeLabel(range)}`}
              right={
                <a href="#/rankings" className="link inline-flex items-center gap-1 text-sm">
                  All rankings <Icon name="arrow" size={14} />
                </a>
              }
            />
            <LoadError error={top.error} retry={top.retry} what="the top ads" />
            <table className="w-full table-fixed text-sm">
              <thead className="kicker text-left">
                <tr className="border-b border-divider">
                  <th className="w-7 py-2 font-normal">#</th>
                  <th className="py-2 font-normal">Ad</th>
                  <th className="w-20 py-2 text-right font-normal">Spend</th>
                  <th className="hidden w-24 py-2 text-right font-normal sm:table-cell">CPA</th>
                  <th className="hidden w-16 py-2 text-right font-normal sm:table-cell">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {top.data?.items.map((p, i) => (
                  <tr key={p.postId} className="border-b border-divider">
                    <td className="num py-3 align-top font-bold text-ink">{i + 1}</td>
                    <td className="py-3 pr-3">
                      <a href={`#/rankings?post=${encodeURIComponent(p.postId)}`} className="flex items-center gap-3">
                        <Thumb mediaType={p.mediaType} label="" url={p.thumbnailUrl} className="h-12 w-8 shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-ink" title={p.name}>
                            {p.name}
                          </span>
                          <span className="mt-1 flex gap-2 sm:hidden">
                            <CpaValue value={cpa(p.totals)} target={tg.targetCpa} warnMax={tg.cpaWarnMax} />
                            <RoasValue value={roas(p.totals)} target={tg.targetRoas} />
                          </span>
                          <span className="mt-1 block">
                            <PodChip podId={p.assignment.podId} />
                          </span>
                        </span>
                      </a>
                    </td>
                    <td className="num py-3 text-right text-ink">{money(p.totals.spendCents, { compact: true })}</td>
                    <td className="hidden py-3 text-right sm:table-cell">
                      <CpaValue value={cpa(p.totals)} target={tg.targetCpa} warnMax={tg.cpaWarnMax} />
                    </td>
                    <td className="hidden py-3 text-right sm:table-cell">
                      <RoasValue value={roas(p.totals)} target={tg.targetRoas} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink-3">Ranked by spend · CPA and ROAS from Meta · copies grouped by post</p>
          </section>

      </div>
    </div>
  );
}

function TrendsSection({ meta, range }: { meta: MetaResponse; range: Range }) {
  const [pod, setPod] = useState("");
  const [grain, setGrain] = useState<TrendGrain | "auto">("auto");
  const { data, error, retry } = useApi<TrendsResponse>(`/api/trends?${qs({ range, pod, grain: grain === "auto" ? undefined : grain })}`);
  return (
    <section>
      <SectionTitle
        title="Trends"
        right={
          <span className="flex flex-wrap items-center gap-3">
            <Select
              label="Pod"
              value={pod}
              onChange={setPod}
              options={[{ value: "", label: "Whole account" }, ...meta.pods.map((p) => ({ value: p.id, label: p.name })), { value: "unassigned", label: "Unassigned" }]}
            />
            <Segmented
              label="Grouping"
              value={data && grain === "auto" ? data.grain : grain}
              onChange={setGrain}
              options={[
                { value: "day", label: "Daily" },
                { value: "week", label: "Weekly" },
              ]}
            />
          </span>
        }
      />
      <LoadError error={error} retry={retry} what="trends" />
      {data && <TrendCharts points={data.points} targetCpa={meta.targets.targetCpa} targetRoas={meta.targets.targetRoas} />}
      <p className="mt-2 text-xs text-ink-3">Meta numbers. Weeks start on Monday.</p>
    </section>
  );
}



/**
 * The pods ranked by hit rate as one compact table (it replaced a card per pod, which made an empty
 * pod as tall as a busy one). The agency sits under it, shown but never ranked.
 */
function Leaderboard({
  rows,
  agency,
  targets,
  sparkDays,
  launches,
}: {
  rows: PodRow[];
  agency: PodRow | undefined;
  targets: Targets;
  sparkDays: string[];
  launches: LaunchesResponse | null;
}) {
  const line = (r: PodRow, rank: number | null) => {
    const decided = r.hits + r.misses;
    const week = launches?.rows.find((l) => l.podId === r.podId)?.counts[0] ?? null;
    return (
      <tr key={r.podId} className={`border-b border-divider ${rank == null ? "text-ink-3" : ""}`}>
        <td className="num w-8 py-3 align-middle font-bold text-ink-3">{rank ?? ""}</td>
        <td className="py-3 pr-3">
          <a href="#/pods" className="inline-flex items-center gap-2 font-bold text-ink hover:underline">
            <span className="size-2.5 shrink-0" style={{ background: `var(--pod-${r.podId})` }} aria-hidden />
            {r.name}
          </a>
          <div className="text-xs text-ink-3">
            {rank == null
              ? "Shown beside the pods, never counted in them"
              : `${week ?? 0} ${week === 1 ? "concept" : "concepts"} this week${r.testing ? ` · ${r.testing} testing` : ""}`}
          </div>
        </td>
        <td className="py-3 pr-3 text-right">
          <div className="num text-xl leading-none font-extrabold text-ink">{pct(r.hitRate, 0)}</div>
          <div className="num text-xs text-ink-3">{decided ? `${r.hits}/${decided}${r.lateHits ? ` · ${r.lateHits} late` : ""}` : "none decided"}</div>
        </td>
        <td className="hidden w-36 py-3 pr-3 md:table-cell">
          <Sparkline values={r.spark} days={sparkDays} color={`var(--pod-${r.podId})`} label={r.name} />
        </td>
        <td className="num py-3 pr-3 text-right text-ink">{money(r.totals.spendCents, { compact: true })}</td>
        <td className="hidden py-3 pr-3 text-right sm:table-cell">
          <CpaValue value={cpa(r.totals)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
        </td>
        <td className="hidden py-3 text-right sm:table-cell">
          <RoasValue value={roas(r.totals)} target={targets.targetRoas} />
        </td>
      </tr>
    );
  };
  if (!rows.length) return null;
  return (
    <table className="w-full text-sm">
      <thead className="kicker text-left">
        <tr className="border-b border-divider">
          <th className="py-2 font-normal">#</th>
          <th className="py-2 font-normal">Pod</th>
          <th className="py-2 pr-3 text-right font-normal">Hit rate</th>
          <th className="hidden py-2 pr-3 font-normal md:table-cell">Spend, last 7 days</th>
          <th className="py-2 pr-3 text-right font-normal">Spend</th>
          <th className="hidden py-2 pr-3 text-right font-normal sm:table-cell">CPA</th>
          <th className="hidden py-2 text-right font-normal sm:table-cell">ROAS</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => line(r, i + 1))}
        {agency && agency.totals.spendCents > 0 && line(agency, null)}
      </tbody>
    </table>
  );
}

const DISMISS_KEY = "dismissed-alerts";
const WEEK_MS = 7 * 86_400_000;

/** Alerts hidden for a week, in this browser only (a per-viewer convenience). */
function readDismissed(): Record<string, number> {
  try {
    const all = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "{}") as Record<string, number>;
    return Object.fromEntries(Object.entries(all).filter(([, until]) => until > Date.now()));
  } catch {
    return {};
  }
}

/** Alerts first on the page: problems before warnings before good news, five at a time. */
function AlertsSection({ alerts }: { alerts: { data: AlertsResponse | null; error: Error | null; retry: () => void } }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [all, setAll] = useState(false);
  const rank = { bad: 0, warn: 1, good: 2 } as const;
  const open = (alerts.data?.alerts ?? []).filter((a) => !dismissed[a.id]).sort((a, b) => rank[a.tone] - rank[b.tone]);
  const shown = all ? open : open.slice(0, 5);
  const hidden = Object.keys(dismissed).length;
  const dismiss = (id: string) => {
    const next = { ...dismissed, [id]: Date.now() + WEEK_MS };
    setDismissed(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* per-browser convenience only */
    }
  };
  const restore = () => {
    setDismissed({});
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch {
      /* per-browser convenience only */
    }
  };
  return (
    <section>
      <SectionTitle
        title="Alerts"
        right={
          alerts.data && (
            <span>
              {open.length} open{alerts.data.asOf ? ` · data through ${shortDate(alerts.data.asOf)}` : ""}
              {hidden > 0 && (
                <>
                  {" · "}
                  <button type="button" className="link" onClick={restore}>
                    show {hidden} hidden
                  </button>
                </>
              )}
            </span>
          )
        }
      />
      <LoadError error={alerts.error} retry={alerts.retry} what="alerts" />
      {alerts.data && open.length === 0 && <p className="py-3 text-sm text-ink-3">Nothing needs a look right now.</p>}
      <ul>
        {shown.map((a) => (
          <li key={a.id} className="flex items-start gap-3 border-b border-divider py-3">
            <span
              className={`mt-0.5 grid size-4 shrink-0 place-items-center text-[10px] font-bold text-page ${a.tone === "bad" ? "bg-bad" : a.tone === "warn" ? "bg-warn" : "bg-good"}`}
              aria-label={a.tone === "bad" ? "Problem" : a.tone === "warn" ? "Needs attention" : "Good news"}
            >
              {a.tone === "bad" ? "✕" : a.tone === "warn" ? "!" : "✓"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-ink">{a.title}</div>
              <div className="text-sm text-ink-3">{a.detail}</div>
            </div>
            <span className="flex shrink-0 flex-col items-end gap-1 text-sm">
              <a href={a.href} className="link">
                {a.action}
              </a>
              <button type="button" className="text-xs text-ink-3 hover:text-ink" onClick={() => dismiss(a.id)} title="Hide this alert for a week, in this browser">
                Hide for a week
              </button>
            </span>
          </li>
        ))}
      </ul>
      {open.length > 5 && (
        <button type="button" className="link mt-2 text-sm" onClick={() => setAll((x) => !x)}>
          {all ? "Show fewer" : `Show all ${open.length}`}
        </button>
      )}
    </section>
  );
}
