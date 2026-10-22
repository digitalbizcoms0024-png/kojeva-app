import { useState } from "react";
import { Info, type TermId } from "../glossary.tsx";
import type { ConceptResult, ConceptsResponse, MetaResponse, PodRow, PodsResponse } from "../../shared/api.ts";
import { qs, useApi } from "../api.ts";
import { conceptHref } from "../components/ConceptDrawer.tsx";
import { openDrill } from "../drill.ts";
import { LaunchCadence } from "../components/LaunchCadence.tsx";
import { PodSpend, type SpendView } from "../components/PodSpend.tsx";
import { shiftDay } from "../components/HeaderControls.tsx";
import { HeaderControls, type Range } from "../components/HeaderControls.tsx";
import { addTotals, cpa, isHit, roas, ZERO_TOTALS, type Targets } from "../../shared/metrics.ts";
import { ANGLES, AWARENESS, FORMATS, GROUPS, podById } from "../../shared/taxonomy.ts";
import { byStrategist } from "../../shared/strategists.ts";
import { CpaValue, CsvButton, Empty, HitBadge, Icon, PageHeader, PodChip, RoasValue, SectionTitle, Segmented, Select, LoadError, Skeleton } from "../components/ui.tsx";
import { dollars, downloadCsv, int, money, pct, plain, plainDollars, shortDate } from "../format.ts";

type Props = {
  data: PodsResponse | null;
  error: Error | null;
  targets: Targets;
};

/** Harris, Dhia, Shameer, Ali, then the agency: the order pods are always shown in. */
export const podOrder = (id: string | null) => {
  const i = GROUPS.findIndex((g) => g.id === id);
  return i < 0 ? GROUPS.length : i;
};

export function hitRuleText(t: Targets): string {
  return `A concept qualifies once one of its ads has spent $${t.minTestSpend}, and is judged from first spend to day ${t.testWindowDays} or the day it qualified, whichever is later. Hit = CPA ≤ $${t.targetCpa} ${t.hitRule === "both" ? "and" : "or"} ROAS ≥ ${t.targetRoas} (Meta) over that window.${t.lateWindowDays > 0 ? ` A miss that keeps spending becomes a late hit if, from day ${t.lateWindowDays} on, its totals since launch or any ${t.lateWindowDays} days in a row reach target (at least $${t.minTestSpend} spent); late hits count in the hit rate.` : ""}`;
}

/** The tag value with the most hits among a pod's concepts (ties: more test spend). */
function best(concepts: ConceptResult[], key: "angle" | "format"): string | null {
  const by = new Map<string, { hits: number; spend: number }>();
  for (const k of concepts) {
    const v = k[key];
    if (!v) continue;
    const e = by.get(v) ?? { hits: 0, spend: 0 };
    if (isHit(k.status)) e.hits++;
    e.spend += k.window.spendCents;
    by.set(v, e);
  }
  const top = [...by].filter(([, e]) => e.hits > 0).sort((a, b) => b[1].hits - a[1].hits || b[1].spend - a[1].spend)[0];
  if (!top) return null;
  return (key === "angle" ? ANGLES : FORMATS)[top[0]] ?? top[0];
}

/**
 * The pods side by side: one column each (the agency last, dashed), one row per measure. It replaced a
 * tall card per pod, so the same number sits on the same line for every pod.
 */
function PodsCompare({
  columns,
  concepts,
  targets,
  editorsOf,
  topRate,
  onOpen,
}: {
  columns: PodRow[];
  concepts: ConceptResult[];
  targets: Targets;
  editorsOf: (podId: string | null) => string[];
  topRate: number;
  onOpen: (podId: string) => void;
}) {
  const data = columns.map((r) => {
    const mine = concepts.filter((k) => k.podId === r.podId);
    return { r, mine, decided: r.hits + r.misses, testSpend: mine.reduce((acc, k) => addTotals(acc, k.window), ZERO_TOTALS).spendCents };
  });
  const rows: [string, (d: (typeof data)[number]) => React.ReactNode, TermId?][] = [
    ["Concepts launched", (d) => int(d.r.concepts), "concept"],
    ["Concepts decided", (d) => int(d.decided), "hitRate"],
    ["Hits", (d) => (d.r.lateHits ? `${int(d.r.hits)} (${d.r.lateHits} late)` : int(d.r.hits)), "hit"],
    ["Testing now", (d) => int(d.r.testing), "testing"],
    ["Test spend", (d) => money(d.testSpend, { compact: true }), "testSpend"],
    ["Spend", (d) => money(d.r.totals.spendCents, { compact: true })],
    ["CPA · Meta", (d) => <CpaValue value={cpa(d.r.totals)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />, "cpa"],
    ["ROAS · Meta", (d) => <RoasValue value={roas(d.r.totals)} target={targets.targetRoas} />, "roas"],
    ["Best angle", (d) => best(d.mine, "angle") ?? "—"],
    ["Best format", (d) => best(d.mine, "format") ?? "—"],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="pin-first w-full min-w-[720px] table-fixed text-sm">
        <thead>
          <tr>
            <th className="w-40" />
            {data.map(({ r }) => (
              <th
                key={r.podId}
                className={`px-3 pt-3 pb-2 text-left align-top font-normal ${r.kind === "agency" ? "" : "bg-surface"}`}
                style={{ borderTop: `4px ${r.kind === "agency" ? "dashed" : "solid"} var(--pod-${r.podId})` }}
              >
                <span className="flex items-center gap-2 text-base font-extrabold text-ink">
                  <span className="size-2.5 shrink-0" style={{ background: `var(--pod-${r.podId})` }} aria-hidden />
                  {r.name}
                </span>
                <span className="block truncate text-xs text-ink-3" title={editorsOf(r.podId).join(", ")}>
                  {r.kind === "agency" ? "Not counted in the pods" : editorsOf(r.podId).length ? editorsOf(r.podId).join(", ") : "No editors yet"}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-divider">
            <th className="kicker py-3 pr-3 text-left align-top font-normal">
              Hit rate <Info id="hitRate" />
            </th>
            {data.map(({ r, decided }) => (
              <td key={r.podId} className={`px-3 py-3 align-top ${r.kind === "agency" ? "" : "bg-surface"}`}>
                <div className="num text-[34px] leading-none font-extrabold tracking-[-0.03em] text-ink">{pct(r.hitRate, 0)}</div>
                <div className="num mt-1 text-xs text-ink-3">{decided ? `${r.hits} of ${decided} decided` : "None decided yet"}</div>
                {r.kind === "pod" && r.hitRate != null && r.hitRate === topRate && (
                  <span className="mt-1 inline-block bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent-ink">Top hit rate</span>
                )}
              </td>
            ))}
          </tr>
          {rows.map(([label, value, term]) => (
            <tr key={label} className="border-t border-divider">
              <th className="py-2 pr-3 text-left font-normal text-ink-2">
                {label} {term && <Info id={term} />}
              </th>
              {data.map((d) => (
                <td key={d.r.podId} className={`num px-3 py-2 font-bold text-ink ${d.r.kind === "agency" ? "" : "bg-surface"}`}>
                  {value(d)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="border-t border-divider">
            <th />
            {data.map(({ r }) => (
              <td key={r.podId} className={`px-3 py-3 ${r.kind === "agency" ? "" : "bg-surface"}`}>
                <button onClick={() => onOpen(r.podId ?? "")} className="link inline-flex items-center gap-1 text-sm">
                  Concepts <Icon name="arrow" size={14} />
                </button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function PodsPage({ meta, range, setRange }: { meta: MetaResponse; range: Range; setRange: (r: Range) => void }) {
  const pods = useApi<PodsResponse>(`/api/pods?${qs({ range })}`);
  const concepts = useApi<ConceptsResponse>(`/api/concepts?${qs({ range })}`);
  const t = meta.targets;
  const rows = pods.data?.rows ?? [];
  const inHouse = rows.filter((r) => r.kind === "pod").sort((a, b) => podOrder(a.podId) - podOrder(b.podId));
  const agency = rows.find((r) => r.kind === "agency");
  const unassigned = rows.find((r) => r.kind === "unassigned");
  // In-house (default): only Kojeva's own pods, in every section; All adds partners (Trybe) and the agency.
  const [view, setView] = useState<SpendView>("inhouse");
  const inhouseIds = meta.pods.filter((p) => p.inhouse).map((p) => p.id);
  const shown = view === "inhouse" ? inHouse.filter((r) => r.podId != null && inhouseIds.includes(r.podId)) : inHouse;
  const topRate = Math.max(...shown.map((r) => r.hitRate ?? -1));
  const columns = [...shown, ...(view === "all" && agency && (agency.totals.spendCents > 0 || agency.concepts > 0) ? [agency] : [])];
  const editorsOf = (podId: string | null) => meta.editors.filter((e) => e.podId === podId).map((e) => e.name);

  return (
    <div>
      <PageHeader
        title="Pods"
        subtitle={`${meta.pods
          .filter((p) => p.kind === "pod" && (view === "all" || p.inhouse))
          .map((p) => p.name)
          .join(" vs ")} · hit rate per concept`}
      >
        <HeaderControls meta={meta} range={range} setRange={setRange} />
      </PageHeader>
      <div className="flex flex-col gap-6 px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-ink-2">Show</span>
          <Segmented
            label="Pods shown"
            value={view}
            onChange={setView}
            options={[
              { value: "inhouse", label: "In-house pods" },
              { value: "all", label: "All, with agency & partners" },
            ]}
          />
        </div>
        <PodSpend range={range} latest={meta.latestDate} targets={t} inhouseIds={inhouseIds} view={view} />
        <SectionTitle title="Hit rate by pod" className="mb-0" />
        <details className="text-sm text-ink-3">
          <summary className="cursor-pointer text-ink-2">How it's measured</summary>
          <p className="mt-2 max-w-[110ch]">{hitRuleText(t)} Concepts count toward the period in which they first spent.</p>
        </details>
        <LoadError error={pods.error} retry={pods.retry} what="the pods" loading={!pods.data} rows={8} />
        {pods.data && (
          <PodsCompare
            columns={columns}
            concepts={concepts.data?.rows ?? []}
            targets={t}
            editorsOf={editorsOf}
            topRate={topRate}
            // A pod's concepts slide in from the right (src/drill.ts), like everywhere else.
            onOpen={(podId) => openDrill({ title: `${podById(podId)?.name ?? "Agency"} concepts`, range, filter: { pod: podId } })}
          />
        )}
        {meta.pods
          .filter((p) => p.members.length > 0)
          .map((p) => (
            <StrategistSplit key={p.id} podId={p.id} members={p.members} concepts={(concepts.data?.rows ?? []).filter((k) => k.podId === p.id)} targets={t} />
          ))}
        {unassigned && unassigned.totals.spendCents > 0 && (
          <p className="text-sm text-ink-2">
            <b className="text-ink">{money(unassigned.totals.spendCents, { compact: true })}</b> of spend in this period is on ads the hub can't credit to a pod
            or the agency ({int(unassigned.concepts)} concepts).{" "}
            <a href="#/tagging" className="link">
              Tag them →
            </a>
          </p>
        )}
        <LaunchCadence
          selected={null}
          // A week opens its launches in a side card (src/drill.ts); the table below stays as it is.
          onSelect={(c) =>
            c &&
            openDrill({
              title: `${rows.find((p) => p.podId === c.podId)?.name ?? "Pod"} · launched week of ${shortDate(c.week)}`,
              range: `custom:${c.week}:${shiftDay(c.week, 6)}`,
              filter: { pod: c.podId },
            })
          }
        />
        <div id="concepts" className="scroll-mt-4">
          <ConceptsTable range={range} targets={t} pods={rows} filter={{ pod: "" }} />
        </div>
      </div>
    </div>
  );
}

export function ConceptsTable({
  range,
  targets,
  pods,
  filter = {},
  title = "Concepts tested",
  inPanel = false,
}: {
  range: string;
  targets: Targets;
  pods: { podId: string | null; name: string }[];
  /** Any /api/concepts filter: pod, angle, format, awareness, atria_theme, atria_desire, atria_hook, atria_persona, belief. */
  filter?: Record<string, string | undefined>;
  title?: string;
  /** Inside a side card: no height cap (the card scrolls) and no "Judged on" column (narrower). */
  inPanel?: boolean;
}) {
  const [pod, setPod] = useState(filter.pod ?? "");
  const [result, setResult] = useState("");
  const { data: all, error, retry } = useApi<ConceptsResponse>(`/api/concepts?${qs({ ...filter, range, pod })}`);
  const keep = (s: ConceptsResponse["rows"][number]["status"]) =>
    !result || (result === "hits" ? isHit(s) : result === "ineligible" ? s === "ineligible" : s === result);
  const data = all && { ...all, rows: all.rows.filter((k) => keep(k.status)) };
  return (
    <section>
      <SectionTitle
        title={`${title}${data ? ` · ${data.rows.length}` : ""}`}
        right={
          <span className="flex flex-wrap items-center gap-3">
            <Select
              label="Result"
              value={result}
              onChange={setResult}
              options={[
                { value: "", label: "All" },
                { value: "hits", label: "Hits & late hits" },
                { value: "miss", label: "Misses" },
                { value: "testing", label: "Testing" },
                { value: "ineligible", label: "Not at $100 yet" },
              ]}
            />
            <Select
              label="Pod"
              value={pod}
              onChange={setPod}
              options={[{ value: "", label: "All" }, ...pods.filter((p) => p.podId).map((p) => ({ value: p.podId!, label: p.name }))]}
            />
            <CsvButton
              disabled={!data?.rows.length}
              onClick={() =>
                data &&
                downloadCsv(
                  `kojeva-concepts-${data.from === "2000-01-01" ? "all" : data.from}-to-${data.to}.csv`,
                  [
                    "Pod",
                    "Concept",
                    "Ad set",
                    "Ads",
                    "First spend",
                    "Qualified on",
                    "Judged until",
                    "Test spend (Meta, $)",
                    "Test purchases (Meta)",
                    "Test CPA (Meta, $)",
                    "Test ROAS (Meta)",
                    "Result",
                    "Angle",
                    "Format",
                    "Atria themes",
                  ],
                  data.rows.map((k) => [
                    podById(k.podId)?.name ?? k.podId,
                    k.label,
                    k.adsetName,
                    k.ads,
                    k.firstSpend,
                    k.qualifiedOn,
                    k.windowEnd,
                    plainDollars(k.window.spendCents),
                    k.window.purchases,
                    plain(cpa(k.window)),
                    plain(roas(k.window)),
                    k.status,
                    k.angle ? (ANGLES[k.angle] ?? k.angle) : "",
                    k.format ? (FORMATS[k.format] ?? k.format) : "",
                    k.awareness ? (AWARENESS[k.awareness] ?? k.awareness) : "",
                    k.beliefGroups.join("; "),
                    k.atriaHooks.join("; "),
                    k.atriaPersonas.join("; "),
                    k.atriaDesires.join("; "),
                    k.atriaThemes.join("; "),
                  ]),
                )
              }
            />
          </span>
        }
      />
      <LoadError error={error} retry={retry} what="concepts" loading={!all} rows={6} />
      {data && data.rows.length === 0 && <Empty>No concepts started testing in this period.</Empty>}
      {data && data.rows.length > 0 && (
        <div className={inPanel ? "overflow-x-auto" : "max-h-[36rem] overflow-auto"}>
          <table className={`w-full text-sm ${inPanel ? "min-w-[600px]" : ""}`}>
            <thead className="kicker sticky top-0 bg-page text-left">
              <tr className="border-b-2 border-divider">
                <th className="py-2 pr-3 font-normal">Pod</th>
                <th className="py-2 pr-3 font-normal">Concept</th>
                {!inPanel && <th className="py-2 pr-3 font-normal">Judged on</th>}
                <th className="py-2 pr-3 text-right font-normal">Spend</th>
                <th className="py-2 pr-3 text-right font-normal">CPA</th>
                <th className="py-2 pr-3 text-right font-normal">ROAS</th>
                <th className="py-2 font-normal">Result</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((k) => (
                <tr key={k.conceptId} className="border-b border-divider">
                  <td className="py-2.5 pr-3">
                    <PodChip podId={k.podId} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <a href={conceptHref(k.conceptId)} className="font-semibold text-ink hover:underline">
                      {k.label}
                    </a>
                    <div className="text-xs text-ink-3">
                      {k.adsetName} · {k.ads} {k.ads === 1 ? "ad" : "ads"} · {money(k.allTime.spendCents, { compact: true })} all-time
                    </div>
                    {(k.angle || k.format || k.awareness || k.atriaThemes.length > 0 || k.beliefGroups.length > 0) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {k.angle && <span className="bg-accent-soft px-1.5 py-px text-[11px] text-accent-ink">{ANGLES[k.angle] ?? k.angle}</span>}
                        {k.format && <span className="bg-surface-2 px-1.5 py-px text-[11px] text-ink-2">{FORMATS[k.format] ?? k.format}</span>}
                        {k.awareness && (
                          <span
                            className="bg-ink px-1.5 py-px text-[11px] text-page"
                            title={k.awarenessSource === "manual" ? "Awareness, set by hand" : "Awareness, labelled by Claude"}
                          >
                            {AWARENESS[k.awareness] ?? k.awareness}
                          </span>
                        )}
                        {k.atriaThemes.slice(0, 3).map((t) => (
                          <span key={t} className="border border-divider px-1.5 py-px text-[11px] text-ink-3" title="Atria theme">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {k.beliefGroups.length > 0 && (
                      <div className="mt-1 text-[11px] text-ink-2" title={k.beliefs.join("\n")}>
                        Belief: <b className="text-ink">{k.beliefGroups.join(" · ")}</b>
                      </div>
                    )}
                  </td>
                  {!inPanel && (
                    <td className="num py-2.5 pr-3 whitespace-nowrap text-ink-2">
                      {shortDate(k.firstSpend)} – {shortDate(k.windowEnd)}
                    </td>
                  )}
                  <td className="num py-2.5 pr-3 text-right text-ink">{money(k.window.spendCents)}</td>
                  <td className="py-2.5 pr-3 text-right">
                    <CpaValue value={cpa(k.window)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    <RoasValue value={roas(k.window)} target={targets.targetRoas} />
                  </td>
                  <td className="py-2.5">
                    <HitBadge status={k.status} stillRunning={k.stillRunning} />
                    {k.lateWindow && (
                      <div className="num mt-0.5 text-[11px] text-ink-3">
                        {shortDate(k.lateWindow.from)} – {shortDate(k.lateWindow.to)} · CPA {dollars(cpa(k.lateWindow.totals))} · ROAS{" "}
                        {roas(k.lateWindow.totals)?.toFixed(2) ?? "—"}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Pods, the agency and unassigned spend ranked by spend (the Rankings "Pods" tab). */
export function PodsTable({ data, error, targets }: Props) {
  if (error) return <Empty>Couldn't load pods: {error.message}</Empty>;
  if (!data) return <Skeleton rows={6} />;
  const rows = data.rows.filter((r) => r.totals.spendCents > 0).sort((a, b) => b.totals.spendCents - a.totals.spendCents);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <CsvButton
          onClick={() =>
            downloadCsv(
              `kojeva-pods-${data.from === "2000-01-01" ? "all" : data.from}-to-${data.to}.csv`,
              [
                "Group",
                "Spend (Meta, $)",
                "Purchases (Meta)",
                "CPA (Meta, $)",
                "ROAS (Meta)",
                "Hit rate (%)",
                "Hits",
                "Decided",
                "Testing",
                "Concepts",
              ],
              rows.map((r) => [
                r.name,
                plainDollars(r.totals.spendCents),
                r.totals.purchases,
                plain(cpa(r.totals)),
                plain(roas(r.totals)),
                plain(r.hitRate == null ? null : r.hitRate * 100, 1),
                r.hits,
                r.hits + r.misses,
                r.testing,
                r.concepts,
              ]),
            )
          }
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="kicker text-left">
            <tr className="border-b-2 border-divider">
              <th className="py-2 pr-3 font-normal">Group</th>
              <th className="py-2 pr-3 text-right font-normal">Spend</th>
              <th className="py-2 pr-3 text-right font-normal">Purchases</th>
              <th className="py-2 pr-3 text-right font-normal">CPA · Meta</th>
              <th className="py-2 pr-3 text-right font-normal">ROAS · Meta</th>
              <th className="py-2 pr-3 text-right font-normal">
                Hit rate <Info id="hitRate" />
              </th>
              <th className="py-2 text-right font-normal">Concepts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.podId ?? "none"} className="border-b border-divider">
                <td className="py-2.5 pr-3">
                  <PodChip podId={r.podId} />
                  {r.kind === "agency" && <span className="ml-2 text-xs text-ink-3">not counted in pods</span>}
                </td>
                <td className="num py-2.5 pr-3 text-right font-bold text-ink">{money(r.totals.spendCents, { compact: true })}</td>
                <td className="num py-2.5 pr-3 text-right text-ink">{int(r.totals.purchases)}</td>
                <td className="py-2.5 pr-3 text-right">
                  <CpaValue value={cpa(r.totals)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <RoasValue value={roas(r.totals)} target={targets.targetRoas} />
                </td>
                <td className="num py-2.5 pr-3 text-right text-ink">
                  {pct(r.hitRate, 0)}{" "}
                  <span className="text-xs text-ink-3">
                    {r.hits}/{r.hits + r.misses}
                  </span>
                </td>
                <td className="num py-2.5 text-right text-ink">{int(r.concepts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EditorsTab({ data, error, targets }: Props) {
  if (error) return <Empty>Couldn't load editors: {error.message}</Empty>;
  if (!data) return <Skeleton rows={6} />;
  const rows = data.rows
    .flatMap((p) => p.editors.filter((e) => e.editorId).map((e) => ({ ...e, podId: p.podId })))
    .sort((a, b) => b.totals.spendCents - a.totals.spendCents);
  if (rows.length === 0)
    return (
      <Empty>
        No editors have assigned ads in this period. Add editors in{" "}
        <a href="#/settings?tab=pods" className="link">
          Settings
        </a>{" "}
        and assign them in To review.
      </Empty>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="kicker text-left">
          <tr className="border-b-2 border-divider">
            <th className="py-2 pr-3 font-normal">#</th>
            <th className="py-2 pr-3 font-normal">Editor</th>
            <th className="py-2 pr-3 font-normal">Pod</th>
            <th className="py-2 pr-3 text-right font-normal">Spend</th>
            <th className="py-2 pr-3 text-right font-normal">Purchases</th>
            <th className="py-2 pr-3 text-right font-normal">CPA</th>
            <th className="py-2 pr-3 text-right font-normal">ROAS</th>
            <th className="py-2 text-right font-normal">New ads</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={e.editorId} className="border-b border-divider">
              <td className="num py-2.5 pr-3 text-ink-3">{i + 1}</td>
              <td className="py-2.5 pr-3 font-bold text-ink">{e.name}</td>
              <td className="py-2.5 pr-3">
                <PodChip podId={e.podId} />
              </td>
              <td className="num py-2.5 pr-3 text-right text-ink">{money(e.totals.spendCents, { compact: true })}</td>
              <td className="num py-2.5 pr-3 text-right text-ink">{int(e.totals.purchases)}</td>
              <td className="py-2.5 pr-3 text-right">
                <CpaValue value={cpa(e.totals)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
              </td>
              <td className="py-2.5 pr-3 text-right">
                <RoasValue value={roas(e.totals)} target={targets.targetRoas} />
              </td>
              <td className="num py-2.5 text-right text-ink">{int(e.concepts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A pod run by several strategists: each one's concepts and hit rate in the range (named in their ad sets). */
function StrategistSplit({ podId, members, concepts, targets }: { podId: string; members: string[]; concepts: ConceptResult[]; targets: Targets }) {
  const rows = byStrategist(concepts, members).map(({ name, concepts: list }) => {
    const hits = list.filter((k) => isHit(k.status)).length;
    const decided = hits + list.filter((k) => k.status === "miss").length;
    const test = list.reduce((acc, k) => addTotals(acc, k.window), ZERO_TOTALS);
    return { name, launched: list.length, decided, hits, rate: decided ? hits / decided : null, test };
  });
  return (
    <section>
      <SectionTitle
        title={
          <span className="inline-flex items-center gap-2">
            <PodChip podId={podId} /> by strategist
          </span>
        }
        right={<span className="text-xs text-ink-3">From the strategist named in each ad set ("POD0 | Andrei | …")</span>}
      />
      <div className="overflow-x-auto">
        <table className="pin-first w-full min-w-[560px] text-sm">
          <thead className="kicker text-left">
            <tr className="border-b border-divider">
              <th className="py-2 pr-3 font-normal">Strategist</th>
              <th className="py-2 pr-3 text-right font-normal">
                Hit rate <Info id="hitRate" />
              </th>
              <th className="py-2 pr-3 text-right font-normal">Hits / decided</th>
              <th className="py-2 pr-3 text-right font-normal">Launched</th>
              <th className="py-2 pr-3 text-right font-normal">Test spend</th>
              <th className="py-2 text-right font-normal">Test CPA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-b border-divider">
                <td className={`py-2.5 pr-3 font-semibold ${r.name === "Not named" ? "text-ink-3" : "text-ink"}`}>{r.name}</td>
                <td className="num py-2.5 pr-3 text-right font-bold text-ink">{r.rate == null ? "—" : pct(r.rate, 0)}</td>
                <td className="num py-2.5 pr-3 text-right text-ink-2">
                  {r.hits} / {r.decided}
                </td>
                <td className="num py-2.5 pr-3 text-right text-ink-2">{r.launched}</td>
                <td className="num py-2.5 pr-3 text-right text-ink-2">{money(r.test.spendCents, { compact: true })}</td>
                <td className="py-2.5 text-right">
                  <CpaValue value={cpa(r.test)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
