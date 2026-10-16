import type { ReactNode } from "react";
import type { AlertsResponse, MetaResponse, PodRow, PodsResponse, RankingsResponse } from "../../shared/api.ts";
import { cpa, roas, twCpa, twRoas, type Targets, type Totals } from "../../shared/metrics.ts";
import { qs, useApi } from "../api.ts";
import { HeaderControls, type Range } from "../components/HeaderControls.tsx";
import { Sparkline } from "../components/Sparkline.tsx";
import { CpaValue, Empty, Icon, PageHeader, PodChip, RoasValue, SectionTitle, Tag, Thumb } from "../components/ui.tsx";
import { dollars, int, money, pct, shortDate, TW_MODEL_LABEL, twCoverageNote } from "../format.ts";

export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** The period just before the selected one, for "vs last week" deltas. */
function previousPeriod(range: Range, latest: string | null): { from: string; to: string; label: string } | null {
  if (!latest || range === "all") return null;
  const days = range === "week" ? 7 : 30;
  return { from: shiftDay(latest, -2 * days + 1), to: shiftDay(latest, -days), label: range === "week" ? "vs last week" : "vs last 30 days" };
}

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
  const prev = previousPeriod(range, meta.latestDate);
  const before = useApi<RankingsResponse>(prev ? `/api/rankings?${qs({ range: "custom", from: prev.from, to: prev.to, limit: 1 })}` : null);
  const t = top.data?.totals;
  const b = prev ? before.data?.totals : undefined;
  const tg = meta.targets;
  const sparkDays = meta.latestDate ? Array.from({ length: 7 }, (_, i) => shiftDay(meta.latestDate!, i - 6)) : [];
  const ranked = (pods.data?.rows ?? []).filter((r) => r.kind === "pod").sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1) || b.totals.spendCents - a.totals.spendCents);
  const agency = pods.data?.rows.find((r) => r.kind === "agency");
  const pctFmt = (d: number) => pct(Math.abs(d), 1);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={meta.tripleWhale ? "Kojeva performance on Meta, with Triple Whale beside it" : "Kojeva performance on Meta"}>
        <HeaderControls meta={meta} range={range} setRange={setRange} />
      </PageHeader>

      <div className="flex flex-col gap-8 px-4 py-6 md:px-8">
        <div className={`grid grid-cols-2 gap-0.5 border-2 border-divider bg-divider [&>*]:bg-page ${meta.tripleWhale ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
          <Kpi
            label="Spend"
            source="Meta"
            value={money(t?.spendCents, { compact: true })}
            sub={b && t && <><Delta now={t.spendCents} before={b.spendCents} better="up" fmt={pctFmt} /> {prev?.label}</>}
          />
          <Kpi
            label="Purchases"
            source="Meta"
            value={int(t?.purchases)}
            sub={b && t && <><Delta now={t.purchases} before={b.purchases} better="up" fmt={pctFmt} /> {prev?.label}</>}
          />
          <Kpi
            label="CPA"
            source="Meta"
            value={t ? <CpaValue value={cpa(t)} target={tg.targetCpa} warnMax={tg.cpaWarnMax} /> : "—"}
            sub={<>{b && t && <Delta now={cpa(t)} before={cpa(b)} better="down" fmt={pctFmt} />} Target ${tg.targetCpa.toFixed(2)}</>}
          />
          <Kpi
            label="ROAS"
            source="Meta"
            value={t ? <RoasValue value={roas(t)} target={tg.targetRoas} /> : "—"}
            sub={<>{b && t && <Delta now={roas(t)} before={roas(b)} better="up" fmt={pctFmt} />} Target {tg.targetRoas.toFixed(2)}</>}
          />
          {meta.tripleWhale && (
            <Kpi
              label="ROAS"
              source="Triple Whale"
              value={t && top.data?.tw ? <RoasValue value={twRoas(top.data.tw, t.spendCents)} target={tg.targetRoas} /> : "—"}
              sub={
                <span title={TW_MODEL_LABEL}>
                  {twCoverageNote(top.data?.twCoverage) ??
                    (t && top.data?.tw ? `CPA ${dollars(twCpa(top.data.tw, t.spendCents))} · ${int(Math.round(top.data.tw.purchases))} orders` : TW_MODEL_LABEL)}
                </span>
              }
            />
          )}
        </div>

        <section>
          <SectionTitle title="Pod leaderboard" right={pods.data && `Ranked by hit rate · ${shortDate(pods.data.from === "2000-01-01" ? null : pods.data.from)} – ${shortDate(pods.data.to)} · Meta`} />
          {pods.error && <Empty>{pods.error.message}</Empty>}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {ranked.map((r, i) => (
              <PodCard key={r.podId} r={r} rank={i + 1} targets={tg} sparkDays={sparkDays} />
            ))}
          </div>
          {agency && agency.totals.spendCents > 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-2">
              <PodChip podId="agency" />
              <span className="num">
                {money(agency.totals.spendCents, { compact: true })} spend · CPA{" "}
                <CpaValue value={cpa(agency.totals)} target={tg.targetCpa} warnMax={tg.cpaWarnMax} /> · ROAS{" "}
                <RoasValue value={roas(agency.totals)} target={tg.targetRoas} />
              </span>
              <span className="text-xs text-ink-3">Shown beside the pods, never counted in them.</span>
            </p>
          )}
        </section>

        <div className="grid gap-8 xl:grid-cols-2">
          <section className="min-w-0">
            <SectionTitle
              title={`Top 5 ads ${range === "week" ? "this week" : range === "month" ? "this month" : "of all time"}`}
              right={
                <a href="#/rankings" className="link inline-flex items-center gap-1 text-sm">
                  All rankings <Icon name="arrow" size={14} />
                </a>
              }
            />
            {top.error && <Empty>{top.error.message}</Empty>}
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

          <section className="min-w-0">
            <SectionTitle title="Alerts" right={alerts.data && `${alerts.data.alerts.length} open${alerts.data.asOf ? ` · data through ${shortDate(alerts.data.asOf)}` : ""}`} />
            {alerts.error && <Empty>{alerts.error.message}</Empty>}
            {alerts.data && alerts.data.alerts.length === 0 && <p className="py-3 text-sm text-ink-3">Nothing needs a look right now.</p>}
            <ul>
              {alerts.data?.alerts.map((a) => (
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
                  <a href={a.href} className="link shrink-0 text-sm">
                    {a.action}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function PodCard({ r, rank, targets, sparkDays }: { r: PodRow; rank: number; targets: Targets; sparkDays: string[] }) {
  const editors = r.editors.filter((e) => e.editorId).length;
  const decided = r.hits + r.misses;
  const tot: Totals = r.totals;
  return (
    <div className="flex flex-col bg-surface p-4" style={{ borderTop: `4px solid var(--pod-${r.podId})` }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-lg font-extrabold text-ink">
            <span className="size-2.5" style={{ background: `var(--pod-${r.podId})` }} aria-hidden />
            {r.name}
          </div>
          <div className="text-xs text-ink-3">
            Strategist · {editors} {editors === 1 ? "editor" : "editors"} with ads
          </div>
        </div>
        <span className="num text-sm font-bold text-ink-3">#{rank}</span>
      </div>
      <div className="kicker mt-4">Hit rate</div>
      <div className="num text-[44px] leading-none font-extrabold tracking-[-0.03em] text-ink">{pct(r.hitRate, 0)}</div>
      <div className="mt-1 text-xs text-ink-3">
        {decided ? `${r.hits} of ${decided} concepts hit` : "No decided concepts yet"}
        {r.testing > 0 && ` · ${r.testing} testing`}
      </div>
      <div className="mt-4">
        <Sparkline values={r.spark} days={sparkDays} color={`var(--pod-${r.podId})`} label={r.name} />
        <div className="mt-1 text-[11px] text-ink-3">Daily spend, last 7 days</div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-divider pt-3">
        <div>
          <dt className="kicker">Spend</dt>
          <dd className="num font-bold text-ink">{money(tot.spendCents, { compact: true })}</dd>
        </div>
        <div>
          <dt className="kicker">CPA</dt>
          <dd>
            <CpaValue value={cpa(tot)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
          </dd>
        </div>
        <div>
          <dt className="kicker">ROAS</dt>
          <dd>
            <RoasValue value={roas(tot)} target={targets.targetRoas} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

