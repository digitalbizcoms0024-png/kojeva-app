import { useState } from "react";
import type { ConceptResult, ConceptsResponse, MetaResponse, PodRow, PodsResponse } from "../../shared/api.ts";
import { qs, useApi } from "../api.ts";
import { conceptHref } from "../components/ConceptDrawer.tsx";
import { openDrill } from "../drill.ts";
import { LaunchCadence } from "../components/LaunchCadence.tsx";
import { PodSpend } from "../components/PodSpend.tsx";
import { shiftDay } from "../components/HeaderControls.tsx";
import { HeaderControls, type Range } from "../components/HeaderControls.tsx";
import { addTotals, cpa, isHit, roas, ZERO_TOTALS, type Targets } from "../../shared/metrics.ts";
import { ANGLES, AWARENESS, FORMATS, GROUPS, podById } from "../../shared/taxonomy.ts";
import { CpaValue, CsvButton, Empty, HitBadge, Icon, PageHeader, PodChip, RoasValue, SectionTitle, Select } from "../components/ui.tsx";
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

function PodColumn({
  r,
  concepts,
  targets,
  editors,
  top,
  onOpen,
}: {
  r: PodRow;
  concepts: ConceptResult[];
  targets: Targets;
  editors: string[];
  top: boolean;
  onOpen: () => void;
}) {
  const mine = concepts.filter((k) => k.podId === r.podId);
  const decided = r.hits + r.misses;
  const testSpend = mine.reduce((acc, k) => addTotals(acc, k.window), ZERO_TOTALS).spendCents;
  const agency = r.kind === "agency";
  const rows: [string, React.ReactNode][] = [
    ["Concepts launched", int(r.concepts)],
    ["Concepts decided", int(decided)],
    ["Hits", r.lateHits ? `${int(r.hits)} (${r.lateHits} late)` : int(r.hits)],
    ["Test spend", money(testSpend, { compact: true })],
    ["Spend", money(r.totals.spendCents, { compact: true })],
    ["CPA · Meta", <CpaValue key="c" value={cpa(r.totals)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />],
    ["ROAS · Meta", <RoasValue key="r" value={roas(r.totals)} target={targets.targetRoas} />],
    ["Best angle", best(mine, "angle") ?? "—"],
    ["Best format", best(mine, "format") ?? "—"],
  ];
  return (
    <div
      className={`flex min-w-0 flex-col p-4 ${agency ? "bg-page" : "bg-surface"}`}
      style={{
        borderTop: `4px ${agency ? "dashed" : "solid"} var(--pod-${r.podId})`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-xl font-extrabold text-ink">
          <span className="size-2.5" style={{ background: `var(--pod-${r.podId})` }} aria-hidden />
          {r.name}
        </div>
        {top && <span className="bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent-ink">Top hit rate</span>}
      </div>
      <div className="mt-0.5 min-h-4 text-xs text-ink-3">
        {agency ? "Before the in-house pods · not counted in them" : editors.length ? `Strategist · ${editors.join(", ")}` : "Strategist"}
      </div>
      <div className="mt-4 border-t border-divider pt-3">
        <div className="kicker">Hit rate</div>
        <div className="num text-[52px] leading-none font-extrabold tracking-[-0.03em] text-ink">{pct(r.hitRate, 0)}</div>
        <div className="mt-1 text-xs text-ink-3">
          {decided
            ? `${r.hits} ${r.hits === 1 ? "hit" : "hits"} from ${decided} decided concepts${r.lateHits ? ` (${r.lateHits} late)` : ""}`
            : "No decided concepts yet"}
          {r.testing > 0 && ` · ${r.testing} testing`}
        </div>
      </div>
      <dl className="mt-4 flex-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 border-t border-divider py-2">
            <dt className="text-ink-2">{k}</dt>
            <dd className="num text-right font-bold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <button onClick={onOpen} className="btn btn-secondary mt-3 w-full">
        Open {r.name} {agency ? "" : "pod"} <Icon name="arrow" size={14} />
      </button>
    </div>
  );
}

export function PodsPage({ meta, range, setRange }: { meta: MetaResponse; range: Range; setRange: (r: Range) => void }) {
  const pods = useApi<PodsResponse>(`/api/pods?${qs({ range })}`);
  const concepts = useApi<ConceptsResponse>(`/api/concepts?${qs({ range })}`);
  const [open, setOpen] = useState("");
  const t = meta.targets;
  const rows = pods.data?.rows ?? [];
  const inHouse = rows.filter((r) => r.kind === "pod").sort((a, b) => podOrder(a.podId) - podOrder(b.podId));
  const agency = rows.find((r) => r.kind === "agency");
  const unassigned = rows.find((r) => r.kind === "unassigned");
  const topRate = Math.max(...inHouse.map((r) => r.hitRate ?? -1));
  const columns = [...inHouse, ...(agency && (agency.totals.spendCents > 0 || agency.concepts > 0) ? [agency] : [])];
  const editorsOf = (podId: string | null) => meta.editors.filter((e) => e.podId === podId).map((e) => e.name);

  return (
    <div>
      <PageHeader
        title="Pods"
        subtitle={`${GROUPS.filter((g) => g.id !== "agency")
          .map((p) => p.name)
          .join(" vs ")} · hit rate per concept`}
      >
        <HeaderControls meta={meta} range={range} setRange={setRange} />
      </PageHeader>
      <div className="flex flex-col gap-6 px-4 py-6 md:px-8">
        <PodSpend range={range} latest={meta.latestDate} targets={t} />
        <SectionTitle title="Hit rate by pod" className="mb-0" />
        <p className="max-w-[110ch] text-sm text-ink-3">{hitRuleText(t)} Concepts count toward the period in which they first spent.</p>
        {pods.error && <Empty>Couldn't load pods: {pods.error.message}</Empty>}
        {pods.data && (
          <div className={`grid gap-0.5 border-2 border-divider bg-divider sm:grid-cols-2 ${columns.length > 4 ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
            {columns.map((r) => (
              <PodColumn
                key={r.podId}
                r={r}
                concepts={concepts.data?.rows ?? []}
                targets={t}
                editors={editorsOf(r.podId)}
                top={r.kind === "pod" && r.hitRate != null && r.hitRate === topRate}
                onOpen={() => {
                  setOpen(r.podId ?? "");
                  document.getElementById("concepts")?.scrollIntoView({ behavior: "smooth" });
                }}
              />
            ))}
          </div>
        )}
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
          <ConceptsTable
            key={open}
            range={range}
            targets={t}
            pods={rows}
            filter={{ pod: open }}
          />
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
  const { data: all, error } = useApi<ConceptsResponse>(`/api/concepts?${qs({ ...filter, range, pod })}`);
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
      {error && <Empty>Couldn't load concepts: {error.message}</Empty>}
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
  if (!data) return <Empty>Loading…</Empty>;
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
              <th className="py-2 pr-3 text-right font-normal">Hit rate</th>
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
  if (!data) return <Empty>Loading…</Empty>;
  const rows = data.rows
    .flatMap((p) => p.editors.filter((e) => e.editorId).map((e) => ({ ...e, podId: p.podId })))
    .sort((a, b) => b.totals.spendCents - a.totals.spendCents);
  if (rows.length === 0)
    return (
      <Empty>
        No editors have assigned ads in this period. Add editors in{" "}
        <a href="#/settings" className="link">
          Settings
        </a>{" "}
        and assign them in Needs Tagging.
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
