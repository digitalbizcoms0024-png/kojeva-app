import { useState } from "react";
import { Info } from "../glossary.tsx";
import type { InsightDimension, InsightRow, InsightsMatrix, InsightsOverview, InsightsResponse, MatrixDimension, MetaResponse } from "../../shared/api.ts";
import { cpa, hitRateFloor, MIN_DECIDED, type Targets } from "../../shared/metrics.ts";
import { ANGLES, AWARENESS, FORMATS, MOTIVATIONS, podById } from "../../shared/taxonomy.ts";
import { qs, useApi } from "../api.ts";
import { HeaderControls, type Range } from "../components/HeaderControls.tsx";
import { CpaValue, Empty, PageHeader, Pager, PodSwatch, SectionTitle, Segmented, Select, Tabs, LoadError } from "../components/ui.tsx";
import { money, pct } from "../format.ts";
import { hitRuleText } from "./PodsView.tsx";
import { openDrill } from "../drill.ts";

const LABELS: Record<InsightDimension, Record<string, string>> = {
  angle: ANGLES,
  format: FORMATS,
  awareness: AWARENESS,
  persona: {},
  motivation: MOTIVATIONS,
  atria_hook: {},
  atria_persona: {},
  atria_desire: {},
  belief: {},
  atria_theme: {},
};
/** What one value of a dimension is called ("Angle: Scarcity"). */
export const DIM_LABEL: Record<InsightDimension, string> = {
  angle: "Angle",
  format: "Format",
  awareness: "Awareness level",
  persona: "Persona",
  motivation: "Motivation",
  atria_hook: "Hook type",
  atria_persona: "Avatar",
  atria_desire: "Mass desire",
  belief: "Belief shifted",
  atria_theme: "Atria theme",
};
/** Where each dimension comes from, shown under its title. */
const DIM_SOURCE: Partial<Record<InsightDimension, string>> = {
  awareness: "Labelled by Claude from Atria's tags; hand-set values win",
  persona: "Your persona list (Settings); placed by Claude, hand-set values win",
  motivation: "Labelled by Claude from Atria's tags; hand-set lists win; an ad can lean on several",
  atria_hook: "Atria · visual hook",
  atria_persona: "Atria · persona",
  atria_desire: "Atria · core desire",
  belief: "Written and grouped by Claude from Atria's tags; hand-set groups win",
  atria_theme: "Atria · theme",
};
/** Dimensions where a concept can carry several values, so rows overlap. */
const isMulti = (d: InsightDimension) => d.startsWith("atria_") || d === "belief" || d === "motivation";
const isLabel = (d: InsightDimension) => d === "awareness" || d === "belief" || d === "persona" || d === "motivation";

type Tab = "creative" | "audience" | "message" | "combos";
const TABS: { value: Tab; label: string }[] = [
  { value: "creative", label: "Creative" },
  { value: "audience", label: "Audience" },
  { value: "message", label: "Message" },
  { value: "combos", label: "Combinations" },
];
const PANELS: Record<Exclude<Tab, "combos">, InsightDimension[]> = {
  creative: ["angle", "format", "atria_hook"],
  audience: ["persona", "motivation", "awareness", "atria_desire"],
  message: ["belief", "atria_theme"],
};
const TAB_OF: Record<InsightDimension, Exclude<Tab, "combos">> = {
  angle: "creative",
  format: "creative",
  atria_hook: "creative",
  persona: "audience",
  atria_persona: "audience",
  motivation: "audience",
  awareness: "audience",
  atria_desire: "audience",
  belief: "message",
  atria_theme: "message",
};
const MATRIX_OPTIONS: { value: MatrixDimension; label: string }[] = [
  { value: "angle", label: "Angle" },
  { value: "format", label: "Format" },
  { value: "motivation", label: "Motivation" },
  { value: "awareness", label: "Awareness level" },
  { value: "persona", label: "Persona" },
];

type Sort = "best" | "spend" | "concepts";
const SORTS: { value: Sort; label: string }[] = [
  { value: "best", label: "Best first" },
  { value: "spend", label: "Most spend" },
  { value: "concepts", label: "Most concepts" },
];

type Open = { filter: Partial<Record<InsightDimension, string>>; title: string; tab: Tab } | null;

const decidedOf = (r: InsightRow) => r.hits + r.misses;
const isThin = (r: InsightRow) => decidedOf(r) < MIN_DECIDED;
const floorOf = (r: InsightRow) => hitRateFloor(r.hits, decidedOf(r)) ?? -1;

/** Rows with enough decided tests first, by how sure we are of their hit rate; then the hints. */
function sortRows(rows: InsightRow[], sort: Sort): InsightRow[] {
  const by: Record<Sort, (a: InsightRow, b: InsightRow) => number> = {
    best: (a, b) => Number(isThin(a)) - Number(isThin(b)) || floorOf(b) - floorOf(a) || b.concepts - a.concepts,
    spend: (a, b) => b.window.spendCents - a.window.spendCents,
    concepts: (a, b) => b.concepts - a.concepts || b.window.spendCents - a.window.spendCents,
  };
  return [...rows].sort(by[sort]);
}

export function insightValueName(dimension: InsightDimension, v: string | null, personas: Record<string, string> = {}) {
  if (v == null) return isLabel(dimension) ? "Not labelled yet" : isMulti(dimension) ? "Not tagged by Atria" : `No ${DIM_LABEL[dimension].toLowerCase()}`;
  return (dimension === "persona" ? personas[v] : LABELS[dimension][v]) ?? v;
}

/** "7 concepts without an angle", "2 concepts not tagged by Atria". */
function untaggedText(d: InsightDimension, n: number) {
  const c = `${n} ${n === 1 ? "concept" : "concepts"}`;
  if (isLabel(d)) return `${c} not labelled yet`;
  if (isMulti(d)) return `${c} not tagged by Atria`;
  return `${c} without ${d === "angle" ? "an angle" : `a ${DIM_LABEL[d].toLowerCase()}`}`;
}

/** Hit rate as a bar against a 0–100% scale, with the average dashed. Grey when there are too few tests to judge. */
function HitBar({ rate, avg, thin, label }: { rate: number | null; avg: number | null; thin: boolean; label: string }) {
  return (
    <div className="relative h-3 bg-surface-2" title={label}>
      <div className="h-full" style={{ width: `${(rate ?? 0) * 100}%`, background: thin ? "var(--chart-bar)" : "var(--ink)" }} />
      {avg != null && <div className="absolute -inset-y-1 border-l-2 border-dashed border-ink-3" style={{ left: `${avg * 100}%` }} aria-hidden />}
    </div>
  );
}

/** "What to make more of": the best value per dimension, and the test spend that found nothing. */
function Overview({ range, pod, targets, personas, onOpen }: { range: Range; pod: string; targets: Targets; personas: Record<string, string>; onOpen: (o: NonNullable<Open>) => void }) {
  const { data, error } = useApi<InsightsOverview>(`/api/insights/overview?${qs({ range, pod })}`);
  if (error) return <Empty>Couldn't load: {error.message}</Empty>;
  if (!data) return <div className="h-40" />;
  const avg = data.baseline.hitRate;
  const open = (d: InsightDimension, v: string) => onOpen({ filter: { [d]: v }, title: `${DIM_LABEL[d]}: ${insightValueName(d, v, personas)}`, tab: TAB_OF[d] });
  const untagged = data.untagged.filter((u) => u.concepts > 0);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-extrabold text-ink">Make more of</h2>
        <p className="num text-sm text-ink-3">
          Account hit rate {avg == null ? "—" : pct(avg, 0)} · {data.baseline.hits} of {data.baseline.decided} decided tests
        </p>
      </div>
      {data.winners.length === 0 ? (
        <p className="border-2 border-divider px-4 py-5 text-sm text-ink-3">
          Nothing beats the account hit rate with at least {MIN_DECIDED} decided tests yet. Try a longer period.
        </p>
      ) : (
        <ul className="grid gap-0.5 border-2 border-divider bg-divider sm:grid-cols-2 xl:grid-cols-4">
          {data.winners.slice(0, 4).map((w) => {
            const c = cpa(w.row.window);
            return (
              <li key={w.dimension} className="bg-page">
                <button type="button" onClick={() => open(w.dimension, w.row.value)} className="flex h-full w-full flex-col gap-2 px-4 py-3.5 text-left transition hover:bg-surface">
                  <span className="kicker">{DIM_LABEL[w.dimension]}</span>
                  <span className="truncate text-lg font-extrabold text-ink" title={insightValueName(w.dimension, w.row.value, personas)}>
                    {insightValueName(w.dimension, w.row.value, personas)}
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="num text-3xl font-extrabold text-ink">{pct(w.row.hitRate, 0)}</span>
                    <span className="num text-xs text-ink-3">
                      hit rate · {w.row.hits}/{decidedOf(w.row)}
                      {avg != null && ` · avg ${pct(avg, 0)}`}
                    </span>
                  </span>
                  <HitBar rate={w.row.hitRate} avg={avg} thin={false} label={`${w.row.hits} hits of ${decidedOf(w.row)} decided`} />
                  <span className="num flex gap-3 text-xs text-ink-3">
                    <span>
                      Test CPA <CpaValue value={c} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
                    </span>
                    <span>{money(w.row.window.spendCents, { compact: true })} tested</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {(data.sinks.length > 0 || untagged.length > 0) && (
        <div className="flex flex-col gap-1.5 text-sm text-ink-2">
          {data.sinks.length > 0 && (
            <p>
              <span className="font-bold text-ink">No hits yet: </span>
              {data.sinks.map((s, i) => (
                <span key={`${s.dimension}:${s.row.value}`}>
                  {i > 0 && " · "}
                  <button type="button" className="link" onClick={() => open(s.dimension, s.row.value)}>
                    {insightValueName(s.dimension, s.row.value, personas)}
                  </button>{" "}
                  <span className="num text-ink-3">
                    ({DIM_LABEL[s.dimension].toLowerCase()}, 0/{decidedOf(s.row)}, {money(s.row.window.spendCents, { compact: true })})
                  </span>
                </span>
              ))}
            </p>
          )}
          {untagged.length > 0 && (
            <p className="text-ink-3">
              {untagged.map((u) => `${u.concepts} of ${data.baseline.concepts} concepts have no ${u.dimension}`).join(" · ")}, so they're left out of those
              panels.{" "}
              <a className="link" href="#/tagging">
                Tag them
              </a>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Rows per page in a dimension's list. */
const PAGE = 10;

function Panel({
  dimension,
  range,
  pod,
  sort,
  targets,
  personas,
  active,
  onOpen,
}: {
  dimension: InsightDimension;
  range: Range;
  pod: string;
  sort: Sort;
  targets: Targets;
  personas: Record<string, string>;
  active: string | null | undefined;
  onOpen: (value: string | null) => void;
}) {
  const { data, error, retry } = useApi<InsightsResponse>(`/api/insights?${qs({ range, dimension, pod })}`);
  const tagged = sortRows((data?.rows ?? []).filter((r) => r.value !== null), sort);
  const untagged = data?.rows.find((r) => r.value === null);
  const avg = data?.baseline.hitRate ?? null;
  // A page at a time; back to the first page when the list changes (range, pod, sort).
  const [page, setPage] = useState({ key: "", n: 0 });
  const key = `${range}|${pod}|${sort}`;
  const n = page.key === key ? Math.min(page.n, Math.max(0, Math.ceil(tagged.length / PAGE) - 1)) : 0;
  const shown = tagged.slice(n * PAGE, (n + 1) * PAGE);

  return (
    <section className="min-w-0">
      <SectionTitle
        title={
          <>
            By {DIM_LABEL[dimension].toLowerCase()}
            {DIM_SOURCE[dimension] && <span className="mt-0.5 block text-xs font-normal tracking-normal text-ink-3">{DIM_SOURCE[dimension]}</span>}
          </>
        }
        right={
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 border-l-2 border-dashed border-ink-3" aria-hidden />
            Average {avg == null ? "—" : pct(avg, 0)}
          </span>
        }
      />
      <LoadError error={error} retry={retry} loading={!data} rows={8} />
      {data && data.rows.length === 0 && <p className="py-3 text-sm text-ink-3">No concepts started testing in this period.</p>}
      {tagged.length > 0 && (
        <table className="w-full table-fixed text-sm">
          <thead className="kicker text-left">
            <tr>
              <th className="w-[40%] py-1.5 font-normal"></th>
              <th className="py-1.5 font-normal">
                Hit rate <Info id="hitRate" />
              </th>
              <th className="w-16 py-1.5 text-right font-normal"></th>
              <th className="w-20 py-1.5 text-right font-normal">Test CPA</th>
              <th className="hidden w-16 py-1.5 text-right font-normal sm:table-cell">Spend</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <Row key={r.value} r={r} dimension={dimension} targets={targets} avg={avg} personas={personas} active={active === r.value} onClick={() => onOpen(r.value)} />
            ))}
          </tbody>
        </table>
      )}
      <Pager page={n} size={PAGE} total={tagged.length} onPage={(p) => setPage({ key, n: p })} />
      {data && data.rows.length > 0 && (
        <p className="mt-2 text-xs text-ink-3">
          {untagged && (
            <>
              <button type="button" className="link" onClick={() => onOpen(null)}>
                {untaggedText(dimension, untagged.concepts)}
              </button>
              {" · "}
            </>
          )}
          {isMulti(dimension) ? "A concept counts under each of its tags, so rows overlap." : "Click a row for its concepts."}
        </p>
      )}
    </section>
  );
}

function Row({
  r,
  dimension,
  targets,
  avg,
  active,
  onClick,
  personas,
}: {
  r: InsightRow;
  dimension: InsightDimension;
  targets: Targets;
  avg: number | null;
  active: boolean;
  onClick: () => void;
  personas: Record<string, string>;
}) {
  const decided = decidedOf(r);
  const thin = isThin(r);
  const shown = r.pods.slice(0, 2);
  return (
    <tr onClick={onClick} className={`cursor-pointer border-t border-divider align-middle transition hover:bg-surface ${active ? "bg-surface" : ""}`}>
      <td className="py-2.5 pr-3">
        <div className="truncate font-semibold text-ink" title={insightValueName(dimension, r.value, personas)}>
          {insightValueName(dimension, r.value, personas)}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-[11px] whitespace-nowrap text-ink-3">
          <span>
            {r.concepts} {r.concepts === 1 ? "concept" : "concepts"}
            {r.testing > 0 && ` · ${r.testing} testing`}
          </span>
          {shown.map((p) => (
            <span key={p.podId} className="hidden shrink-0 items-center gap-0.5 sm:inline-flex" title={`${p.concepts} from ${podById(p.podId)?.name ?? "this pod"}`}>
              <PodSwatch podId={p.podId} className="size-2" />
              {podById(p.podId)?.code ?? "—"} {p.concepts}
            </span>
          ))}
          {r.pods.length > shown.length && <span className="hidden sm:inline" title={r.pods.slice(2).map((p) => `${podById(p.podId)?.name ?? "—"} ${p.concepts}`).join(", ")}>+{r.pods.length - shown.length}</span>}
        </div>
      </td>
      <td className="py-2.5">
        <HitBar rate={r.hitRate} avg={avg} thin={thin} label={`${r.hits} hits of ${decided} decided${thin ? " (too few to judge)" : ""}`} />
      </td>
      <td className="num py-2.5 text-right" title={`${r.hits} hits of ${decided} decided`}>
        {r.hitRate == null ? <span className="text-ink-3">—</span> : <span className={thin ? "text-ink-3" : "font-bold text-ink"}>{pct(r.hitRate, 0)}</span>}
        <div className="text-[11px] text-ink-3">
          {r.hits}/{decided}
          {thin && decided > 0 ? " · few" : ""}
        </div>
      </td>
      <td className="py-2.5 text-right">
        <CpaValue value={cpa(r.window)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
      </td>
      <td className="num hidden py-2.5 text-right text-ink-2 sm:table-cell">{money(r.window.spendCents, { compact: true })}</td>
    </tr>
  );
}

/** Hit rate for each pair of two dimensions. Darker = higher; cells with too few tests stay blank. */
function Matrix({
  range,
  pod,
  personas,
  onOpen,
  active,
}: {
  range: Range;
  pod: string;
  personas: Record<string, string>;
  onOpen: (o: NonNullable<Open>) => void;
  active: Open;
}) {
  // "#/insights?tab=combos&rows=persona&cols=awareness" (the Coverage map's link) opens on that pair.
  const [rows, setRows] = useState<MatrixDimension>(() => hashDim("rows") ?? "angle");
  const [cols, setCols] = useState<MatrixDimension>(() => hashDim("cols") ?? "format");
  const { data, error, retry } = useApi<InsightsMatrix>(rows === cols ? null : `/api/insights/matrix?${qs({ range, pod, rows, cols })}`);
  const cell = new Map((data?.cells ?? []).map((c) => [`${c.row}\u0000${c.col}`, c]));
  const avg = data?.baseline.hitRate ?? null;
  // Awareness runs along the buying journey and personas follow their list (as on the Coverage map),
  // so the two read the same way; other dimensions keep the most-used values first.
  const ordered = (d: MatrixDimension, values: string[]) => {
    const order = d === "awareness" ? Object.keys(AWARENESS) : d === "persona" ? Object.keys(personas) : null;
    if (!order) return values;
    const at = (v: string) => (order.indexOf(v) < 0 ? order.length : order.indexOf(v));
    return [...values].sort((a, b) => at(a) - at(b));
  };
  const rowValues = ordered(rows, data?.rowValues.slice(0, 14) ?? []);
  const colValues = ordered(cols, data?.colValues.slice(0, 8) ?? []);
  const isActive = (r: string, c: string) => active?.filter[rows] === r && active.filter[cols] === c;

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        title={
          <>
            {DIM_LABEL[rows]} × {DIM_LABEL[cols].toLowerCase()}
            <span className="mt-0.5 block text-xs font-normal tracking-normal text-ink-3">Hit rate of the concepts that carry both. Click a cell for its concepts.</span>
          </>
        }
        right={
          <span className="flex flex-wrap items-center gap-3">
            <Select label="Rows" value={rows} onChange={(v) => setRows(v as MatrixDimension)} options={MATRIX_OPTIONS} />
            <Select label="Columns" value={cols} onChange={(v) => setCols(v as MatrixDimension)} options={MATRIX_OPTIONS} />
          </span>
        }
      />
      {rows === cols && <p className="text-sm text-ink-3">Pick two different dimensions.</p>}
      <LoadError error={error} retry={retry} loading={!data && rows !== cols} rows={6} />
      {data && rowValues.length === 0 && <p className="py-3 text-sm text-ink-3">No concepts carry both tags in this period.</p>}
      {rowValues.length > 0 && (
        <div className="overflow-x-auto">
          <table className="pin-first w-full min-w-[640px] table-fixed border-separate border-spacing-0.5 text-sm">
            <thead className="kicker">
              <tr>
                <th className="w-44 py-1.5 text-left font-normal"></th>
                {colValues.map((c) => (
                  <th key={c} className="truncate px-1 py-1.5 text-left font-normal" title={insightValueName(cols, c, personas)}>
                    {insightValueName(cols, c, personas)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowValues.map((r) => (
                <tr key={r}>
                  <th className="truncate py-1 pr-2 text-left font-semibold text-ink" title={insightValueName(rows, r, personas)}>
                    {insightValueName(rows, r, personas)}
                  </th>
                  {colValues.map((c) => {
                    const x = cell.get(`${r}\u0000${c}`);
                    if (!x) return <td key={c} className="bg-surface" aria-label="No concepts" />;
                    const decided = decidedOf(x);
                    const judged = decided >= MIN_DECIDED && x.hitRate != null;
                    const strength = judged ? 12 + Math.round(x.hitRate! * 78) : 0;
                    const dark = strength > 50;
                    return (
                      <td key={c} className="p-0">
                        <button
                          type="button"
                          onClick={() =>
                            onOpen({ filter: { [rows]: r, [cols]: c }, title: `${insightValueName(rows, r, personas)} × ${insightValueName(cols, c, personas)}`, tab: "combos" })
                          }
                          title={`${x.concepts} concepts · ${x.hits} hits of ${decided} decided${judged ? "" : " (too few to judge)"} · test spend ${money(x.window.spendCents)}`}
                          className={`num flex h-12 w-full flex-col items-start justify-center px-2 text-left transition hover:outline-2 hover:outline-ink ${isActive(r, c) ? "outline-2 outline-accent" : ""}`}
                          style={{
                            background: judged ? `color-mix(in oklab, var(--ink) ${strength}%, var(--page))` : "var(--surface)",
                            color: dark ? "var(--page)" : undefined,
                          }}
                        >
                          <span className={judged ? "font-bold" : "text-ink-3"}>{judged ? pct(x.hitRate, 0) : decided ? `${x.hits}/${decided}` : "testing"}</span>
                          <span className={`text-[11px] ${dark ? "opacity-80" : "text-ink-3"}`}>
                            {judged ? `${x.hits}/${decided}` : "few"}
                            {judged && avg != null && x.hitRate! > avg ? " ▲" : ""}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && rowValues.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-3">
          <span className="inline-flex items-center gap-2">
            0%
            <span className="inline-block h-2.5 w-32" style={{ background: "linear-gradient(to right, color-mix(in oklab, var(--ink) 12%, var(--page)), color-mix(in oklab, var(--ink) 90%, var(--page)))" }} aria-hidden />
            100% hit rate
          </span>
          <span>▲ above the average ({avg == null ? "—" : pct(avg, 0)})</span>
          <span>Pale: fewer than {MIN_DECIDED} decided tests</span>
          {data.skipped > 0 && <span>{data.skipped} concepts without both tags are left out</span>}
          {(data.rowValues.length > rowValues.length || data.colValues.length > colValues.length) && <span>Showing the most-used values</span>}
        </div>
      )}
    </section>
  );
}

/** A query parameter of the current hash route ("#/insights?tab=combos&rows=persona"). */
function hashParam(name: string): string | null {
  return new URLSearchParams(window.location.hash.split("?")[1] ?? "").get(name);
}

function hashDim(name: "rows" | "cols"): MatrixDimension | null {
  const v = hashParam(name);
  return v && MATRIX_OPTIONS.some((o) => o.value === v) ? (v as MatrixDimension) : null;
}

function readTab(): Tab {
  const fromLink = hashParam("tab");
  if (TABS.some((x) => x.value === fromLink)) return fromLink as Tab;
  try {
    const t = localStorage.getItem("insights-tab");
    return TABS.some((x) => x.value === t) ? (t as Tab) : "creative";
  } catch {
    return "creative";
  }
}

export function InsightsPage({ meta, range, setRange }: { meta: MetaResponse; range: Range; setRange: (r: Range) => void }) {
  const [pod, setPod] = useState("");
  const [tab, setTabState] = useState<Tab>(readTab);
  const [sort, setSort] = useState<Sort>("best");
  const t = meta.targets;
  const personas = Object.fromEntries(meta.personas.filter((p) => p.status === "active").map((p) => [p.id, p.name]));
  // Once the persona list is confirmed, "By persona" uses it instead of Atria's raw persona tags.
  const panelsOf = (k: Exclude<Tab, "combos">) => PANELS[k].map((d) => (d === "persona" && !Object.keys(personas).length ? "atria_persona" : d));
  const setTab = (v: Tab) => {
    setTabState(v);
    try {
      localStorage.setItem("insights-tab", v);
    } catch {
      /* per-browser convenience only */
    }
  };
  // A row, card or heatmap cell opens its concepts in a side card (src/drill.ts); the page stays put.
  const openFrom = (o: NonNullable<Open>) =>
    openDrill({ title: o.title, range, filter: { ...Object.fromEntries(Object.entries(o.filter).map(([k, v]) => [k, v ?? ""])), pod } });
  const toggle = (dimension: InsightDimension) => (value: string | null) =>
    openDrill({ title: `${DIM_LABEL[dimension]}: ${insightValueName(dimension, value, personas)}`, range, filter: { [dimension]: value ?? "none", pod } });

  return (
    <div>
      <PageHeader title="Creative Insights" subtitle="What to make more of, judged on concept tests">
        <HeaderControls meta={meta} range={range} setRange={setRange} />
      </PageHeader>
      <div className="flex flex-col gap-8 px-4 py-6 md:px-8">
        <Overview range={range} pod={pod} targets={t} personas={personas} onOpen={openFrom} />

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Tabs value={tab} onChange={setTab} options={TABS} />
            <div className="flex flex-wrap items-center gap-3">
              {tab !== "combos" && <Segmented label="Sort" value={sort} onChange={setSort} options={SORTS} />}
              <Select
                label="Pod"
                value={pod}
                onChange={setPod}
                options={[{ value: "", label: "All pods" }, ...meta.pods.map((p) => ({ value: p.id, label: p.name }))]}
              />
            </div>
          </div>
          <details className="text-sm text-ink-3">
            <summary className="cursor-pointer text-ink-2">How it's measured</summary>
            <p className="mt-2 max-w-[90ch]">
              Hit rate is hits (including late hits) out of decided tests. Test CPA and spend sum each concept's judging window. {hitRuleText(t)} "Best first"
              ranks by hit rate discounted for small samples, so 3 of 3 doesn't outrank 20 of 30; values with fewer than {MIN_DECIDED} decided tests are grey and
              sorted last. The dashed line is the hit rate of every concept in the period.
            </p>
          </details>
        </div>

        {tab === "combos" ? (
          <Matrix range={range} pod={pod} personas={personas} onOpen={openFrom} active={null} />
        ) : (
          <div className="grid gap-8 xl:grid-cols-2">
            {panelsOf(tab).map((d) => (
              <Panel
                key={d}
                dimension={d}
                range={range}
                pod={pod}
                sort={sort}
                targets={t}
                personas={personas}
                active={undefined}
                onOpen={toggle(d)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
