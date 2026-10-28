import { useState, type ReactNode } from "react";
import { Info, type TermId } from "../glossary.tsx";
import type { CoverageResponse, LaunchesResponse, MetaResponse, PodRow, PodsResponse, RankingsResponse, TrendGrain, TrendsResponse } from "../../shared/api.ts";
import { cpa, podScores, roas, type PodScore, type Targets } from "../../shared/metrics.ts";
import { qs, useApi } from "../api.ts";
import { HeaderControls, previousPeriod, rangeLabel, shiftDay, type Range } from "../components/HeaderControls.tsx";
import { PodSpend } from "../components/PodSpend.tsx";
import { AWARENESS } from "../../shared/taxonomy.ts";
import { openDrill } from "../drill.ts";
import { Sparkline } from "../components/Sparkline.tsx";
import { TrendCharts } from "../components/TrendCharts.tsx";
import { CpaValue, Icon, PageHeader, PodChip, RoasValue, SectionTitle, Segmented, Select, Tag, Thumb, LoadError, Empty } from "../components/ui.tsx";
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

function Kpi({ label, source, value, sub, term }: { label: string; source: string; value: ReactNode; sub: ReactNode; term?: TermId }) {
  return (
    <div className="min-w-0 px-4 py-4">
      <div className="flex items-start justify-between gap-2">
        <span className="kicker">
          {label} {term && <Info id={term} />}
        </span>
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
  const launches = useApi<LaunchesResponse>("/api/launches?weeks=1");
  const prev = previousPeriod(range, meta.latestDate);
  const before = useApi<RankingsResponse>(prev ? `/api/rankings?${qs({ range: "custom", from: prev.from, to: prev.to, limit: 1 })}` : null);
  const t = top.data?.totals;
  const b = prev ? before.data?.totals : undefined;
  const tg = meta.targets;
  const sparkDays = meta.latestDate ? Array.from({ length: 7 }, (_, i) => shiftDay(meta.latestDate!, i - 6)) : [];
  // Ranked by pod score (hit rate, spend, ROAS; weights in Settings → Targets), then spend.
  const podRows = (pods.data?.rows ?? []).filter((r) => r.kind === "pod");
  const scores = podScores(podRows, tg);
  const ranked = podRows
    .map((r, i) => ({ ...r, score: scores[i]! }))
    .sort((a, b) => b.score.score - a.score.score || b.totals.spendCents - a.totals.spendCents);
  const agency = pods.data?.rows.find((r) => r.kind === "agency");
  const pctFmt = (d: number) => pct(Math.abs(d), 1);
  // While the totals load the cards show a grey bar; "—" is kept for numbers that really are missing.
  const kpi = (v: ReactNode) => (t ? v : top.loading ? <span className="skeleton mt-1 h-7 w-28" aria-label="Loading" /> : "—");

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Kojeva performance on Meta">
        <HeaderControls meta={meta} range={range} setRange={setRange} syncNow />
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
            term="cpa"
            source="Meta"
            value={kpi(t && <CpaValue value={cpa(t)} target={tg.targetCpa} warnMax={tg.cpaWarnMax} />)}
            sub={<>{b && t && <Delta now={cpa(t)} before={cpa(b)} better="down" fmt={pctFmt} />} Target ${tg.targetCpa.toFixed(2)}</>}
          />
          <Kpi
            label="ROAS"
            term="roas"
            source="Meta"
            value={kpi(t && <RoasValue value={roas(t)} target={tg.targetRoas} />)}
            sub={<>{b && t && <Delta now={roas(t)} before={roas(b)} better="up" fmt={pctFmt} />} Target {tg.targetRoas.toFixed(2)}</>}
          />
        </div>

        <PodSpend range={range} latest={meta.latestDate} targets={tg} inhouseIds={meta.pods.filter((p) => p.inhouse).map((p) => p.id)} compact />

        <section>
          <SectionTitle title="Pod leaderboard" right={pods.data && `Ranked by pod score (hit rate ${tg.scoreWeightHitRate} · spend ${tg.scoreWeightSpend} · ROAS ${tg.scoreWeightRoas}) · ${pods.data.from === "2000-01-01" ? "All time" : `${shortDate(pods.data.from)} – ${shortDate(pods.data.to)}`} · Meta`} />
          <LoadError error={pods.error} retry={pods.retry} what="the pods" loading={!pods.data} rows={6} />
          <Leaderboard rows={ranked} agency={agency} targets={tg} sparkDays={sparkDays} launches={launches.data} />
        </section>

        <div className="grid gap-10 lg:grid-cols-2">
          <NewLaunches meta={meta} />
          <CoverageGaps />
        </div>

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
            <LoadError error={top.error} retry={top.retry} what="the top ads" loading={!top.data} rows={5} />
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
      <LoadError error={error} retry={retry} what="trends" loading={!data} rows={6} />
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
  rows: (PodRow & { score: PodScore })[];
  agency: PodRow | undefined;
  targets: Targets;
  sparkDays: string[];
  launches: LaunchesResponse | null;
}) {
  const line = (r: PodRow & { score?: PodScore }, rank: number | null) => {
    const decided = r.hits + r.misses;
    const week = launches?.rows.find((l) => l.podId === r.podId)?.counts[0] ?? null;
    // The leader: first place with a score above 0.
    const top = rank === 1 && (r.score?.score ?? 0) > 0;
    const s = r.score;
    return (
      <tr key={r.podId} className={`border-b border-divider ${rank == null ? "text-ink-3" : ""} ${top ? "bg-accent-soft" : ""}`}>
        <td className={`num w-8 py-3 align-middle font-bold ${top ? "pl-1 text-accent-ink" : "text-ink-3"}`}>
          {top ? (
            <span className="inline-flex items-center gap-0.5" title="Top pod by hit rate">
              <Icon name="trophy" size={15} />
              <span className="sr-only">1</span>
            </span>
          ) : (
            (rank ?? "")
          )}
        </td>
        <td className="py-3 pr-3">
          <a href="#/pods" className="inline-flex items-center gap-2 font-bold text-ink hover:underline">
            <span className="size-2.5 shrink-0" style={{ background: `var(--pod-${r.podId})` }} aria-hidden />
            {r.name}
          </a>
          {top && <span className="kicker ml-2 text-accent-ink">Top pod</span>}
          <div className="text-xs text-ink-3">
            {rank == null
              ? "Shown beside the pods, never counted in them"
              : `${week ?? 0} ${week === 1 ? "concept" : "concepts"} this week${r.live ? ` · ${r.live} testing now` : ""}`}
          </div>
        </td>
        <td className="py-3 pr-3 text-right">
          {s && (
            <span title={`Hit rate ${s.hitRate.toFixed(1)} + spend ${s.spend.toFixed(1)} + ROAS ${s.roas.toFixed(1)}`}>
              <div className="num text-xl leading-none font-extrabold text-ink">{Math.round(s.score)}</div>
              <div className="num text-xs whitespace-nowrap text-ink-3">
                {Math.round(s.hitRate)} · {Math.round(s.spend)} · {Math.round(s.roas)}
              </div>
            </span>
          )}
        </td>
        <td className="py-3 pr-3 text-right">
          <div className="num text-lg leading-none font-bold text-ink">{pct(r.hitRate, 0)}</div>
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
          <th className="py-2 pr-3 text-right font-normal">
            Score <Info id="podScore" />
          </th>
          <th className="py-2 pr-3 text-right font-normal">
            Hit rate <Info id="hitRate" />
          </th>
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

/**
 * Ads (posts) whose first spend was in the last two weeks (Monday of last week to the latest synced
 * day, the same Mon–Sun weeks as the launch grid), biggest spend first, with CPA and ROAS. Two weeks,
 * not one: a new ad spends little in its first days, so early in a week this week's alone are near $0.
 * A row opens the ad on Ad Rankings.
 */
function NewLaunches({ meta }: { meta: MetaResponse }) {
  const latest = meta.latestDate;
  // Monday of the week before the latest synced day's week (getUTCDay: Sunday 0 … Saturday 6).
  const monday = latest ? shiftDay(latest, -((new Date(`${latest}T00:00:00Z`).getUTCDay() + 6) % 7) - 7) : null;
  const week = monday && latest ? (`custom:${monday}:${latest}` as Range) : null;
  const { data, error, retry } = useApi<RankingsResponse>(week ? `/api/rankings?${qs({ range: week, sort: "spend" })}` : null);
  const tg = meta.targets;
  const rows = data ? data.items.filter((p) => p.firstSpend != null && p.firstSpend >= data.from) : [];
  return (
    <section>
      <SectionTitle
        title="New in the last 2 weeks"
        right={
          data && (
            <span className="text-sm text-ink-3">
              {rows.length} ad{rows.length === 1 ? "" : "s"} launched Mon {shortDate(data.from)} – {shortDate(data.to)}
            </span>
          )
        }
      />
      <LoadError error={error} retry={retry} what="new ads" loading={!data} rows={5} />
      {data && rows.length === 0 && <Empty small>No ads launched in the last 2 weeks.</Empty>}
      {rows.length > 0 && (
        <table className="w-full table-fixed text-sm">
          <thead className="kicker text-left">
            <tr className="border-b border-divider">
              <th className="py-2 font-normal">Ad · by spend</th>
              <th className="w-16 py-2 text-right font-normal">Spend</th>
              <th className="w-20 py-2 text-right font-normal">CPA</th>
              <th className="w-14 py-2 text-right font-normal">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 8).map((p) => (
              <tr key={p.postId} className="border-b border-divider hover:bg-surface">
                <td className="py-2.5 pr-3">
                  <a href={`#/rankings?post=${encodeURIComponent(p.postId)}`} className="flex items-center gap-3">
                    <Thumb mediaType={p.mediaType} label="" url={p.thumbnailUrl} className="h-10 w-7 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink" title={p.name}>
                        {p.name}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                        <PodChip podId={p.assignment.podId} />
                        <span>Launched {shortDate(p.firstSpend)}</span>
                      </span>
                    </span>
                  </a>
                </td>
                <td className="num py-2.5 text-right text-ink">{money(p.totals.spendCents, { compact: true })}</td>
                <td className="py-2.5 text-right">
                  <CpaValue value={cpa(p.totals)} target={tg.targetCpa} warnMax={tg.cpaWarnMax} />
                </td>
                <td className="py-2.5 text-right">
                  <RoasValue value={roas(p.totals)} target={tg.targetRoas} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > 8 && (
        <a href={`#/rankings?range=${week}`} className="link mt-2 inline-flex items-center gap-1 text-sm">
          These 2 weeks on Ad Rankings <Icon name="arrow" size={14} />
        </a>
      )}
    </section>
  );
}

/**
 * The thinnest persona × awareness cells on the Coverage Map over the last 30 days: nothing running
 * first (ones that have hit before at the top), then the least spend; two per persona at most. A row opens the cell.
 */
function CoverageGaps() {
  const { data, error, retry } = useApi<CoverageResponse>(`/api/coverage?${qs({ range: "month" })}`);
  const gaps = data
    ? data.personas
        .flatMap((p) =>
          Object.keys(AWARENESS).map((level) => {
            const cell = data.cells.find((c) => c.personaId === p.id && c.awareness === level);
            return { persona: p, level, spend: cell?.totals.spendCents ?? 0, ads: cell?.ads ?? 0, hits: cell?.hits ?? 0, concepts: cell?.concepts ?? 0 };
          }),
        )
        .sort((a, b) => Number(a.ads > 0) - Number(b.ads > 0) || b.hits - a.hits || a.spend - b.spend)
        // At most two per persona, so the list spans the map.
        .filter((g, _, all) => all.filter((x) => x.persona.id === g.persona.id).indexOf(g) < 2)
        .slice(0, 6)
    : [];
  const total = data?.totals.spendCents ?? 0;
  const open = (g: (typeof gaps)[number]) =>
    openDrill({
      title: `${g.persona.name} × ${AWARENESS[g.level]}`,
      range: "all",
      filter: { persona: g.persona.id, awareness: g.level },
      coverage: { range: "month", pod: "" },
    });
  return (
    <section>
      <SectionTitle
        title={
          <>
            Coverage gaps <Info id="coverage" />
          </>
        }
        right={
          <a href="#/coverage" className="link inline-flex items-center gap-1 text-sm">
            Coverage Map <Icon name="arrow" size={14} />
          </a>
        }
      />
      <LoadError error={error} retry={retry} what="coverage" loading={!data} rows={5} />
      {data && data.personas.length === 0 && (
        <p className="py-3 text-sm text-ink-3">
          Confirm the persona list in{" "}
          <a href="#/settings?tab=personas" className="link">
            Settings
          </a>{" "}
          to see the gaps.
        </p>
      )}
      {data && data.personas.length > 0 && (
        <>
          <p className="mb-1 text-sm text-ink-2">
            {data.filled} of {data.defined} persona × awareness cells have running ads · last 30 days
          </p>
          <ul>
            {gaps.map((g) => (
              <li key={`${g.persona.id}:${g.level}`} className="border-b border-divider">
                <button type="button" onClick={() => open(g)} className="flex w-full items-baseline gap-3 py-2.5 text-left hover:bg-surface">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{g.persona.name}</span>
                    <span className="block text-xs text-ink-3">{AWARENESS[g.level]}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-ink-2">
                    {g.ads === 0 ? "Nothing running" : `${money(g.spend, { compact: true })} · ${pct(total ? g.spend / total : null, 1)} of spend`}
                    <span className="block text-ink-3">
                      {g.concepts === 0 ? "Never tested" : `${g.hits} hit${g.hits === 1 ? "" : "s"} from ${g.concepts} concept${g.concepts === 1 ? "" : "s"} before`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
