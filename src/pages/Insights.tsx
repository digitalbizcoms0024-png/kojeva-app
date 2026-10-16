import { useState } from "react";
import type { InsightDimension, InsightRow, InsightsResponse, MetaResponse } from "../../shared/api.ts";
import { cpa, cpaBand, type Targets } from "../../shared/metrics.ts";
import { ANGLES, FORMATS, podById } from "../../shared/taxonomy.ts";
import { qs, useApi } from "../api.ts";
import { HeaderControls, type Range } from "../components/HeaderControls.tsx";
import { CpaValue, Empty, PageHeader, PodSwatch, SectionTitle, Select } from "../components/ui.tsx";
import { money, pct } from "../format.ts";
import { ConceptsTable, hitRuleText } from "./PodsView.tsx";

const LABELS: Record<InsightDimension, Record<string, string>> = { angle: ANGLES, format: FORMATS, atria_theme: {}, atria_desire: {} };
const DIM_NAME: Record<InsightDimension, string> = { angle: "By angle", format: "By format", atria_theme: "By Atria theme", atria_desire: "By core desire" };
const isAtria = (d: InsightDimension) => d === "atria_theme" || d === "atria_desire";

/** Fewer decided tests than this and a hit rate is shown as a hint, not a verdict. */
const MIN_DECIDED = 3;

const BAND_FILL = { good: "var(--good)", warn: "var(--warn-line)", bad: "var(--bad)", none: "var(--line)" } as const;

function name(dimension: InsightDimension, v: string | null) {
  if (v == null) return isAtria(dimension) ? "Not tagged by Atria" : `No ${dimension}`;
  return LABELS[dimension][v] ?? v;
}

function Panel({
  dimension,
  range,
  pod,
  targets,
  open,
  onOpen,
}: {
  dimension: InsightDimension;
  range: Range;
  pod: string;
  targets: Targets;
  open: { dimension: InsightDimension; value: string | null } | null;
  onOpen: (value: string | null) => void;
}) {
  const { data, error } = useApi<InsightsResponse>(`/api/insights?${qs({ range, dimension, pod })}`);
  const rows = data?.rows ?? [];
  const cpas = rows.map((r) => cpa(r.window) ?? 0);
  const scale = Math.max(targets.targetCpa * 1.7, ...cpas) * 1.05;
  const maxSpend = Math.max(1, ...rows.map((r) => r.window.spendCents));
  const total = isAtria(dimension) ? null : rows.reduce((n, r) => n + r.concepts, 0);
  const untagged = rows.find((r) => r.value === null)?.concepts ?? 0;

  return (
    <section className="min-w-0">
      <SectionTitle
        title={DIM_NAME[dimension]}
        right={
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-3 bg-good" aria-hidden />
              <span className="-ml-1 inline-block h-2.5 w-3 bg-warn-line" aria-hidden /> Test CPA · Meta
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-1 w-3" style={{ background: "var(--chart-bar)" }} aria-hidden /> Test spend
            </span>
          </span>
        }
      />
      {error && <Empty>Couldn't load: {error.message}</Empty>}
      {data && rows.length === 0 && <p className="py-3 text-sm text-ink-3">No concepts started testing in this period.</p>}
      {rows.length > 0 && (
        <table className="w-full table-fixed text-sm">
          <thead className="kicker text-left">
            <tr>
              <th className="w-[34%] py-1.5 font-normal"></th>
              <th className="py-1.5 font-normal">
                <div className="relative flex justify-between">
                  <span>$0</span>
                  <span className="absolute font-bold whitespace-nowrap text-accent-ink" style={{ left: `${(targets.targetCpa / scale) * 100}%`, transform: "translateX(-50%)" }}>
                    Target ${targets.targetCpa}
                  </span>
                  <span>${Math.round(scale)}</span>
                </div>
              </th>
              <th className="w-16 py-1.5 text-right font-normal">Hit rate</th>
              <th className="w-20 py-1.5 text-right font-normal">CPA</th>
              <th className="hidden w-16 py-1.5 text-right font-normal sm:table-cell">Spend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row
                key={r.value ?? "none"}
                r={r}
                dimension={dimension}
                targets={targets}
                scale={scale}
                maxSpend={maxSpend}
                active={open?.dimension === dimension && open.value === r.value}
                onClick={() => onOpen(r.value)}
              />
            ))}
          </tbody>
        </table>
      )}
      {total != null && total > 0 && (
        <p className="num mt-2 text-xs text-ink-3">
          {total} concepts · {pct((total - untagged) / total, 0)} have {dimension === "angle" ? "an angle" : "a format"} · click a row for its concepts
        </p>
      )}
      {isAtria(dimension) && rows.length > 0 && <p className="mt-2 text-xs text-ink-3">A concept appears under each of its Atria tags, so rows overlap and don't add up.</p>}
    </section>
  );
}

function Row({
  r,
  dimension,
  targets,
  scale,
  maxSpend,
  active,
  onClick,
}: {
  r: InsightRow;
  dimension: InsightDimension;
  targets: Targets;
  scale: number;
  maxSpend: number;
  active: boolean;
  onClick: () => void;
}) {
  const c = cpa(r.window);
  const band = cpaBand(c, targets.targetCpa, targets.cpaWarnMax);
  const decided = r.hits + r.misses;
  const thin = decided < MIN_DECIDED;
  return (
    <tr onClick={onClick} className={`cursor-pointer border-t border-divider align-middle transition hover:bg-surface ${active ? "bg-surface" : ""}`}>
      <td className="py-2.5 pr-3">
        <div className={`truncate font-semibold ${r.value === null ? "text-ink-3" : "text-ink"}`} title={name(dimension, r.value)}>
          {name(dimension, r.value)}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-3">
          <span>
            {r.concepts} {r.concepts === 1 ? "concept" : "concepts"}
            {r.testing > 0 && ` · ${r.testing} testing`}
          </span>
          {r.pods.slice(0, 4).map((p) => (
            <span key={p.podId} className="inline-flex items-center gap-0.5" title={`${p.concepts} from this pod`}>
              <PodSwatch podId={p.podId} className="size-2" />
              {podById(p.podId)?.code ?? "—"} {p.concepts}
            </span>
          ))}
        </div>
      </td>
      <td className="py-2.5">
        <div className="relative flex flex-col gap-1">
          <div className="h-3" style={{ width: `${c == null ? 0 : Math.min(1, c / scale) * 100}%`, background: BAND_FILL[band] }} title={c == null ? "No purchases" : `Test CPA $${c.toFixed(2)}`} />
          <div className="h-1" style={{ width: `${(r.window.spendCents / maxSpend) * 100}%`, background: "var(--chart-bar)" }} title={`Test spend ${money(r.window.spendCents)}`} />
          <div className="absolute -inset-y-1.5 border-l-2 border-dashed border-accent" style={{ left: `${(targets.targetCpa / scale) * 100}%` }} aria-hidden />
        </div>
      </td>
      <td className="num py-2.5 text-right text-ink" title={`${r.hits} hits of ${decided} decided`}>
        {r.hitRate == null ? <span className="text-ink-3">—</span> : <span className={thin ? "text-ink-3" : "font-bold"}>{pct(r.hitRate, 0)}</span>}
        <div className="text-[11px] text-ink-3">
          {r.hits}/{decided}
          {thin && decided > 0 ? " · few" : ""}
        </div>
      </td>
      <td className="py-2.5 text-right">
        <CpaValue value={c} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
      </td>
      <td className="num hidden py-2.5 text-right text-ink-2 sm:table-cell">{money(r.window.spendCents, { compact: true })}</td>
    </tr>
  );
}

export function InsightsPage({ meta, range, setRange }: { meta: MetaResponse; range: Range; setRange: (r: Range) => void }) {
  const [pod, setPod] = useState("");
  const [open, setOpen] = useState<{ dimension: InsightDimension; value: string | null } | null>(null);
  const t = meta.targets;
  const toggle = (dimension: InsightDimension) => (value: string | null) =>
    setOpen((o) => (o && o.dimension === dimension && o.value === value ? null : { dimension, value }));

  return (
    <div>
      <PageHeader title="Creative Insights" subtitle="What angles and formats are doing against target, measured on concept tests">
        <HeaderControls meta={meta} range={range} setRange={setRange} />
      </PageHeader>
      <div className="flex flex-col gap-8 px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[90ch] text-sm text-ink-3">
            Test CPA and spend sum each concept's judging window. {hitRuleText(t)} Grey hit rates mark fewer than {MIN_DECIDED} decided tests: treat them as hints.
          </p>
          <Select
            label="Pod"
            value={pod}
            onChange={(v) => {
              setPod(v);
              setOpen(null);
            }}
            options={[{ value: "", label: "All pods" }, ...meta.pods.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </div>

        <div className="grid gap-8 xl:grid-cols-2">
          {(["angle", "format"] as const).map((d) => (
            <Panel key={d} dimension={d} range={range} pod={pod} targets={t} open={open} onOpen={toggle(d)} />
          ))}
        </div>

        {open && (
          <ConceptsTable
            key={`${open.dimension}:${open.value}:${pod}`}
            range={range}
            targets={t}
            pods={meta.pods.map((p) => ({ podId: p.id, name: p.name }))}
            filter={{ [open.dimension]: open.value ?? "none", pod }}
            title={`${DIM_NAME[open.dimension].replace("By ", "")}: ${name(open.dimension, open.value)}`}
          />
        )}

        <div className="grid gap-8 xl:grid-cols-2">
          {(["atria_theme", "atria_desire"] as const).map((d) => (
            <Panel key={d} dimension={d} range={range} pod={pod} targets={t} open={open} onOpen={toggle(d)} />
          ))}
        </div>
      </div>
    </div>
  );
}
