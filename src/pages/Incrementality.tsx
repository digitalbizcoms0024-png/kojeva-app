import { useState } from "react";
import type { AttributionLevel, AttributionResponse, AttributionRow, MetaResponse } from "../../shared/api.ts";
import { attributedCpa, attributedRoas, incrementalShare, type AttributedTotals } from "../../shared/metrics.ts";
import { qs, useApi } from "../api.ts";
import { HeaderControls, type Range } from "../components/HeaderControls.tsx";
import { CpaValue, CsvButton, Empty, PageHeader, PodChip, RoasValue, SectionTitle, Tabs } from "../components/ui.tsx";
import { dollars, downloadCsv, money, pct, plain, plainDollars, ratio } from "../format.ts";

/** Modelled purchases can be fractional; show one decimal only on small counts. */
const fmtPurchases = (t: AttributedTotals | null) => (t ? t.purchases.toLocaleString("en-US", { maximumFractionDigits: t.purchases >= 100 ? 0 : 1 }) : "—");

/** Incremental share as a number plus a thin bar (no status color: it's a measurement, not a target). */
function Share({ v }: { v: number | null }) {
  if (v == null) return <span className="text-ink-3">—</span>;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-16 bg-surface-2 sm:inline-block" aria-hidden>
        <span className="block h-full bg-ink" style={{ width: `${Math.min(1, v) * 100}%` }} />
      </span>
      <span className="num w-10 text-right font-bold text-ink">{pct(v, 0)}</span>
    </span>
  );
}

function Group({
  title,
  note,
  t,
  spend,
  banded,
  meta,
}: {
  title: string;
  note: string;
  t: AttributedTotals | null;
  spend: number;
  banded: boolean;
  meta: MetaResponse;
}) {
  const tg = meta.targets;
  const cpa = attributedCpa(t, spend);
  const roas = attributedRoas(t, spend);
  return (
    <div className="min-w-0 bg-page px-4 py-4">
      <div className="kicker">{title}</div>
      <div className="mb-3 text-xs text-ink-3">{note}</div>
      <dl className="grid grid-cols-3 gap-x-4 gap-y-2">
        <div>
          <dt className="kicker">Purchases</dt>
          <dd className="num text-lg font-extrabold text-ink">{fmtPurchases(t)}</dd>
        </div>
        <div>
          <dt className="kicker">CPA</dt>
          <dd className="text-lg font-extrabold">
            {banded ? <CpaValue value={cpa} target={tg.targetCpa} warnMax={tg.cpaWarnMax} /> : <span className="num text-ink">{dollars(cpa)}</span>}
          </dd>
        </div>
        <div>
          <dt className="kicker">ROAS</dt>
          <dd className="text-lg font-extrabold">
            {banded ? <RoasValue value={roas} target={tg.targetRoas} /> : <span className="num text-ink">{ratio(roas)}</span>}
          </dd>
        </div>
      </dl>
    </div>
  );
}

type Sort = "spend" | "share";

export function IncrementalityPage({ meta, range, setRange }: { meta: MetaResponse; range: Range; setRange: (r: Range) => void }) {
  const [level, setLevel] = useState<AttributionLevel>("pod");
  const [sort, setSort] = useState<Sort>("spend");
  const { data, error } = useApi<AttributionResponse>(`/api/attribution?${qs({ range, level })}`);
  const t = data?.total;
  const share = t ? incrementalShare(t.incremental, t.click7) : null;
  const coverage = t && t.spendCents > 0 ? t.coveredSpendCents / t.spendCents : null;
  const rows = [...(data?.rows ?? [])].sort((a, b) =>
    sort === "spend" ? b.spendCents - a.spendCents : (incrementalShare(a.incremental, a.click7) ?? 9) - (incrementalShare(b.incremental, b.click7) ?? 9),
  );

  return (
    <div>
      <PageHeader
        title="Incrementality"
        subtitle="Would these purchases have happened without the ad? Meta's incremental attribution beside 7-day click and standard"
      >
        <HeaderControls meta={meta} range={range} setRange={setRange} />
      </PageHeader>
      <div className="flex flex-col gap-8 px-4 py-6 md:px-8">
        {error && <Empty>{error.message}</Empty>}
        {t && !t.incremental && (
          <p className="bg-warn-soft px-3 py-2 text-sm text-ink">
            ! No incremental data for this period yet. It arrives with each Meta sync from the first sync after this update; run Settings → Backfill 90 days
            once for history. If Meta doesn't return it for this account, the last sync message in Settings says so.
          </p>
        )}
        {t && (
          <section>
            <SectionTitle
              title="Whole account"
              right={
                coverage != null && coverage < 0.995 && t.incremental
                  ? `Incremental data covers ${pct(coverage, 0)} of spend in this period`
                  : "Meta · same spend for all three"
              }
            />
            <div className="grid gap-0.5 border-2 border-divider bg-divider lg:grid-cols-[1fr_1fr_1fr_auto]">
              <Group
                title="Standard"
                note="The ad set's own setting (used everywhere else in the hub)"
                t={t.standard}
                spend={t.spendCents}
                banded
                meta={meta}
              />
              <Group title="7-day click" note="Purchases within 7 days of a click" t={t.click7} spend={t.spendCents} banded={false} meta={meta} />
              <Group
                title="Incremental"
                note="Only purchases Meta estimates wouldn't have happened without the ad"
                t={t.incremental}
                spend={t.spendCents}
                banded={false}
                meta={meta}
              />
              <div className="bg-page px-4 py-4 lg:w-56">
                <div className="kicker">Incremental share</div>
                <div className="num mt-1 text-[40px] leading-none font-extrabold text-ink">{pct(share, 0)}</div>
                <p className="mt-2 text-xs text-ink-3">
                  {share == null
                    ? "Needs 7-day click and incremental data."
                    : `Of 7-day-click purchases, about ${pct(share, 0)} were caused by the ads; the rest would likely have happened anyway.`}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-3">
              Spend {money(t.spendCents)} (Meta). Target colors apply to Standard only: the ${meta.targets.targetCpa} / {meta.targets.targetRoas} targets were
              set for it, so incremental CPA and ROAS are shown without good/bad color.
            </p>
          </section>
        )}

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Tabs
              value={level}
              onChange={setLevel}
              options={[
                { value: "pod", label: "By pod" },
                { value: "concept", label: "By concept" },
                { value: "post", label: "By ad" },
              ]}
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-ink-2">
                Sort
                <select className="field" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="spend">Spend</option>
                  <option value="share">Least incremental first</option>
                </select>
              </label>
              <CsvButton disabled={!rows.length} onClick={() => data && exportCsv(data, rows)} />
            </div>
          </div>
          {data && rows.length === 0 && <Empty>No spend in this period.</Empty>}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="kicker text-right">
                  <tr>
                    <th />
                    <th />
                    <th colSpan={3} className="border-b border-divider pb-1 text-center font-normal">
                      Standard
                    </th>
                    <th colSpan={3} className="border-b border-divider pb-1 text-center font-normal">
                      7-day click
                    </th>
                    <th colSpan={3} className="border-b border-divider pb-1 text-center font-normal">
                      Incremental
                    </th>
                    <th />
                  </tr>
                  <tr className="border-b-2 border-divider">
                    <th className="py-2 pr-3 text-left font-normal">{level === "pod" ? "Pod" : level === "concept" ? "Concept" : "Ad"}</th>
                    <th className="py-2 pr-3 font-normal">Spend</th>
                    {[0, 1, 2].map((i) => (
                      <Cols key={i} />
                    ))}
                    <th className="py-2 font-normal">Incr. share</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Row key={r.key} r={r} level={level} meta={meta} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="max-w-[90ch] text-sm text-ink-2">
          <SectionTitle title="How to read this" />
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>Standard</b> and <b>7-day click</b> count every purchase that followed the ad. <b>Incremental</b> is Meta's model of how many of those wouldn't
              have happened without it, so it's always lower.
            </li>
            <li>A low incremental share means the ad mostly reached people who were going to buy anyway, such as retargeting or brand searchers.</li>
            <li>
              Incremental purchases are modelled and can be fractional. They come from Meta and are separate from Triple Whale; nothing here is blended with
              Triple Whale.
            </li>
            <li>Hit rate and targets stay on Standard attribution.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function Cols() {
  return (
    <>
      <th className="py-2 pr-3 font-normal">Purch.</th>
      <th className="py-2 pr-3 font-normal">CPA</th>
      <th className="py-2 pr-3 font-normal">ROAS</th>
    </>
  );
}

function Row({ r, level, meta }: { r: AttributionRow; level: AttributionLevel; meta: MetaResponse }) {
  const tg = meta.targets;
  const cell = (t: AttributedTotals | null, banded: boolean) => (
    <>
      <td className="num py-2.5 pr-3 text-right text-ink">{fmtPurchases(t)}</td>
      <td className="py-2.5 pr-3 text-right">
        {banded ? (
          <CpaValue value={attributedCpa(t, r.spendCents)} target={tg.targetCpa} warnMax={tg.cpaWarnMax} />
        ) : (
          <span className="num text-ink">{dollars(attributedCpa(t, r.spendCents))}</span>
        )}
      </td>
      <td className="py-2.5 pr-3 text-right">
        {banded ? (
          <RoasValue value={attributedRoas(t, r.spendCents)} target={tg.targetRoas} />
        ) : (
          <span className="num text-ink">{ratio(attributedRoas(t, r.spendCents))}</span>
        )}
      </td>
    </>
  );
  return (
    <tr className="border-b border-divider">
      <td className="max-w-72 py-2.5 pr-3">
        {level === "pod" ? (
          <PodChip podId={r.podId} />
        ) : (
          <div className="min-w-0">
            <a
              href={level === "post" ? `#/rankings?post=${encodeURIComponent(r.key)}` : undefined}
              className={`block truncate font-semibold text-ink ${level === "post" ? "hover:underline" : ""}`}
              title={r.label}
            >
              {r.label}
            </a>
            <PodChip podId={r.podId} />
          </div>
        )}
      </td>
      <td className="num py-2.5 pr-3 text-right font-bold text-ink">{money(r.spendCents, { compact: true })}</td>
      {cell(r.standard, true)}
      {cell(r.click7, false)}
      {cell(r.incremental, false)}
      <td className="py-2.5 text-right">
        <Share v={incrementalShare(r.incremental, r.click7)} />
      </td>
    </tr>
  );
}

function exportCsv(data: AttributionResponse, rows: AttributionRow[]) {
  const block = (t: AttributedTotals | null, spend: number) => [
    plain(t?.purchases, 1),
    plainDollars(t?.revenueCents),
    plain(attributedCpa(t, spend)),
    plain(attributedRoas(t, spend)),
  ];
  downloadCsv(
    `kojeva-incrementality-${data.level}-${data.from === "2000-01-01" ? "all" : data.from}-to-${data.to}.csv`,
    [
      data.level === "pod" ? "Pod" : data.level === "concept" ? "Concept" : "Ad",
      "Spend (Meta, $)",
      "Purchases (standard)",
      "Revenue (standard, $)",
      "CPA (standard, $)",
      "ROAS (standard)",
      "Purchases (7-day click)",
      "Revenue (7-day click, $)",
      "CPA (7-day click, $)",
      "ROAS (7-day click)",
      "Purchases (incremental)",
      "Revenue (incremental, $)",
      "CPA (incremental, $)",
      "ROAS (incremental)",
      "Incremental share (%)",
      "Spend with incremental data ($)",
    ],
    rows.map((r) => [
      r.label,
      plainDollars(r.spendCents),
      ...block(r.standard, r.spendCents),
      ...block(r.click7, r.spendCents),
      ...block(r.incremental, r.spendCents),
      plain(incrementalShare(r.incremental, r.click7) == null ? null : incrementalShare(r.incremental, r.click7)! * 100, 1),
      plainDollars(r.coveredSpendCents),
    ]),
  );
}
