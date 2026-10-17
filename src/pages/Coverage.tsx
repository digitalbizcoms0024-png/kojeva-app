import { useState } from "react";
import type { CoverageCell, CoverageResponse, MetaResponse } from "../../shared/api.ts";
import { cpa, roas, twRoas } from "../../shared/metrics.ts";
import { AWARENESS } from "../../shared/taxonomy.ts";
import { qs, useApi } from "../api.ts";
import { HeaderControls, type Range } from "../components/HeaderControls.tsx";
import { CpaValue, CsvButton, Empty, HitBadge, PageHeader, PodChip, RoasValue, SectionTitle, Select, Thumb } from "../components/ui.tsx";
import { downloadCsv, money, pct, plain, plainDollars } from "../format.ts";
import { ConceptsTable } from "./PodsView.tsx";

const LEVELS = Object.keys(AWARENESS);
const key = (personaId: string | null, awareness: string | null) => `${personaId ?? "-"}|${awareness ?? "-"}`;

/** Neutral shading by spend share: status colors stay reserved for good/bad. */
const shade = (share: number) => (share > 0 ? `color-mix(in srgb, var(--ink) ${Math.round(4 + Math.min(1, share / 0.5) * 22)}%, transparent)` : undefined);

export function CoveragePage({ meta }: { meta: MetaResponse }) {
  // "Running" means spent in the period; the map opens on the last 7 days.
  const [range, setRange] = useState<Range>("week");
  const [pod, setPod] = useState("");
  const [open, setOpen] = useState<{ personaId: string | null; awareness: string | null } | null>(null);
  const { data, error } = useApi<CoverageResponse>(`/api/coverage?${qs({ range, pod })}`);
  const personas = data?.personas ?? [];
  const drafts = meta.personas.filter((p) => p.status === "draft").length;
  const cells = new Map((data?.cells ?? []).map((c) => [key(c.personaId, c.awareness), c]));
  const total = data?.totals.spendCents ?? 0;
  const nameOf = (id: string | null) => (id ? (personas.find((p) => p.id === id)?.name ?? "—") : "No persona yet");
  const levelOf = (a: string | null) => (a ? (AWARENESS[a] ?? a) : "Not labelled");
  const hasUnlabelled = (data?.cells ?? []).some((c) => c.awareness == null && c.ads > 0);
  const hasNoPersona = (data?.cells ?? []).some((c) => c.personaId == null && c.ads > 0);
  const rows: (string | null)[] = [...personas.map((p) => p.id), ...(hasNoPersona ? [null] : [])];
  const cols: (string | null)[] = [...LEVELS, ...(hasUnlabelled ? [null] : [])];
  const openCell = open ? cells.get(key(open.personaId, open.awareness)) : undefined;

  return (
    <div>
      <PageHeader
        title="Coverage map"
        subtitle="Every running ad placed by who it speaks to and what they already know. The empty cells are buyers the account has never spoken to."
      >
        <HeaderControls meta={meta} range={range} setRange={setRange} />
      </PageHeader>
      <div className="flex flex-col gap-8 px-4 py-6 md:px-8">
        {error && <Empty>Couldn't load: {error.message}</Empty>}
        {data && personas.length === 0 && (
          <div className="border-2 border-divider px-5 py-5 text-sm text-ink-2">
            <h2 className="mb-1 text-lg font-extrabold text-ink">The persona list isn't confirmed yet</h2>
            {drafts > 0 ? (
              <p>
                Claude drafted {drafts} {drafts === 1 ? "persona" : "personas"} from Atria's tags.{" "}
                <a href="#/settings" className="link">
                  Review and confirm them in Settings →
                </a>{" "}
                Claude places every ad on the next nightly run after that.
              </p>
            ) : (
              <p>
                Claude drafts a list of personas from Atria's persona tags on its next nightly run. You'll then edit and confirm them in Settings, or{" "}
                <a href="#/settings" className="link">
                  add your own now
                </a>
                .
              </p>
            )}
          </div>
        )}

        {data && personas.length > 0 && (
          <>
            <section className="grid gap-0.5 border-2 border-divider bg-divider sm:grid-cols-3">
              <div className="bg-page px-4 py-4">
                <div className="kicker">Cells with ads running</div>
                <div className="num mt-1 text-[40px] leading-none font-extrabold text-ink">
                  {data.filled}
                  <span className="text-2xl text-ink-3"> of {data.defined}</span>
                </div>
                <div className="mt-1 text-xs text-ink-3">
                  {personas.length} personas × 5 awareness levels · {data.posts.length} ads spent in this period
                </div>
              </div>
              <div className="bg-page px-4 py-4">
                <div className="kicker">Biggest cell</div>
                {data.top ? (
                  <>
                    <div className="num mt-1 text-[40px] leading-none font-extrabold text-ink">{pct(data.top.share, 0)}</div>
                    <div className="mt-1 text-xs text-ink-3">
                      of spend in <b className="text-ink">{nameOf(data.top.personaId)}</b> × <b className="text-ink">{levelOf(data.top.awareness)}</b>
                      {data.top.offerShare != null && ` · ${pct(data.top.offerShare, 0)} of it with a discount or offer`}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-sm text-ink-3">No placed ads yet.</div>
                )}
              </div>
              <div className="bg-page px-4 py-4">
                <div className="kicker">Not on the map</div>
                <div className="num mt-1 text-[40px] leading-none font-extrabold text-ink">{data.unplaced}</div>
                <div className="mt-1 text-xs text-ink-3">
                  running {data.unplaced === 1 ? "ad has" : "ads have"} no persona or awareness level yet ·{" "}
                  <a href="#/tagging" className="link">
                    place them
                  </a>
                </div>
              </div>
            </section>

            <section>
              <SectionTitle
                title="Persona × awareness"
                right={
                  <span className="flex flex-wrap items-center gap-3">
                    <Select
                      label="Pod"
                      value={pod}
                      onChange={(v) => {
                        setPod(v);
                        setOpen(null);
                      }}
                      options={[
                        { value: "", label: "All pods" },
                        ...meta.pods.map((p) => ({ value: p.id, label: p.name })),
                        { value: "unassigned", label: "No pod" },
                      ]}
                    />
                    <CsvButton onClick={() => exportCsv(data, nameOf, levelOf)} />
                  </span>
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] table-fixed border-collapse text-sm">
                  <thead className="kicker">
                    <tr>
                      <th className="w-44 py-2 pr-2 text-left font-normal">Persona ↓ · Awareness →</th>
                      {cols.map((a) => (
                        <th key={a ?? "none"} className="px-1 py-2 text-left font-normal">
                          {levelOf(a)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((pid) => {
                      const persona = personas.find((p) => p.id === pid);
                      return (
                        <tr key={pid ?? "none"}>
                          <th className="border-t border-divider py-2 pr-2 text-left align-top font-normal">
                            <div className={`font-bold ${pid ? "text-ink" : "text-ink-3"}`}>{nameOf(pid)}</div>
                            {persona?.description && <div className="line-clamp-2 text-[11px] text-ink-3">{persona.description}</div>}
                          </th>
                          {cols.map((a) => {
                            const c = cells.get(key(pid, a));
                            const active = open?.personaId === pid && open.awareness === a;
                            return (
                              <td key={a ?? "none"} className="border-t border-divider p-1 align-top">
                                <Cell
                                  c={c}
                                  share={c && total > 0 ? c.totals.spendCents / total : 0}
                                  meta={meta}
                                  active={active}
                                  onClick={() => setOpen(active ? null : { personaId: pid, awareness: a })}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 max-w-[100ch] text-xs text-ink-3">
                Shading = share of spend in the period (Meta). CPA and ROAS are Meta's over the period; hit rate is every concept ever tested in the cell, so
                empty cells still show what was tried. Persona and awareness are Claude's labels unless set by hand in Needs Tagging.
              </p>
            </section>

            {open && (
              <section className="flex flex-col gap-4">
                <SectionTitle
                  title={`${nameOf(open.personaId)} × ${levelOf(open.awareness)}`}
                  right={
                    <button className="btn btn-ghost text-sm" onClick={() => setOpen(null)}>
                      Close
                    </button>
                  }
                />
                <CellAds data={data} open={open} meta={meta} />
                {(openCell?.concepts ?? 0) > 0 && (
                  <ConceptsTable
                    key={key(open.personaId, open.awareness) + pod}
                    range="all"
                    targets={meta.targets}
                    pods={meta.pods.map((p) => ({ podId: p.id, name: p.name }))}
                    filter={{ persona: open.personaId ?? "none", awareness: open.awareness ?? "none", pod: pod === "unassigned" ? "" : pod }}
                    title="Every concept tested in this cell"
                  />
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Cell({ c, share, meta, active, onClick }: { c: CoverageCell | undefined; share: number; meta: MetaResponse; active: boolean; onClick: () => void }) {
  const t = meta.targets;
  const base = `block h-full min-h-24 w-full px-2 py-2 text-left transition hover:outline-2 hover:outline-ink ${active ? "outline-2 outline-accent" : ""}`;
  const record = c && c.concepts > 0 ? `${c.hits}/${c.hits + c.misses} hits${c.testing ? ` · ${c.testing} testing` : ""}` : null;
  if (!c || c.ads === 0)
    return (
      <button className={`${base} border border-dashed border-line`} onClick={onClick} disabled={!c}>
        <div className="text-xs font-bold text-ink-3">{c ? "Nothing running" : "Never entered"}</div>
        {c && (
          <div className="mt-1 text-[11px] text-ink-3">
            Tested before: {c.concepts} {c.concepts === 1 ? "concept" : "concepts"} · {record}
          </div>
        )}
      </button>
    );
  const offer = c.offerKnownSpendCents > 0 ? c.offerSpendCents / c.offerKnownSpendCents : null;
  return (
    <button className={`${base} border border-divider`} style={{ background: shade(share) }} onClick={onClick}>
      <div className="flex items-baseline justify-between gap-1">
        <span className="num text-lg font-extrabold text-ink">{pct(share, 0)}</span>
        <span className="num text-[11px] text-ink-2">
          {c.ads} {c.ads === 1 ? "ad" : "ads"}
        </span>
      </div>
      <div className="num text-[11px] text-ink-2">{money(c.totals.spendCents, { compact: true })}</div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-xs">
        <CpaValue value={cpa(c.totals)} target={t.targetCpa} warnMax={t.cpaWarnMax} />
        <RoasValue value={roas(c.totals)} target={t.targetRoas} />
      </div>
      <div className="mt-1 text-[11px] text-ink-3">
        {record ?? "No concept tests"}
        {offer != null && offer > 0 && ` · ${pct(offer, 0)} offer`}
      </div>
    </button>
  );
}

function CellAds({ data, open, meta }: { data: CoverageResponse; open: { personaId: string | null; awareness: string | null }; meta: MetaResponse }) {
  const t = meta.targets;
  const ads = data.posts.filter((p) => p.personaId === open.personaId && p.awareness === open.awareness);
  if (!ads.length) return <p className="text-sm text-ink-3">No ads in this cell spent in the selected period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="kicker text-left">
          <tr className="border-b-2 border-divider">
            <th className="py-2 pr-3 font-normal">Ad</th>
            <th className="py-2 pr-3 text-right font-normal">Spend</th>
            <th className="py-2 pr-3 text-right font-normal">CPA · Meta</th>
            <th className="py-2 pr-3 text-right font-normal">ROAS · Meta</th>
            <th className="py-2 pr-3 text-right font-normal">ROAS · TW</th>
            <th className="py-2 pr-3 font-normal">Offer</th>
            <th className="py-2 font-normal">Test</th>
          </tr>
        </thead>
        <tbody>
          {ads.map((p) => (
            <tr key={p.postId} className="border-b border-divider">
              <td className="py-2 pr-3">
                <a href={`#/rankings?post=${encodeURIComponent(p.postId)}`} className="flex items-center gap-2.5 hover:underline">
                  <Thumb mediaType={p.mediaType} label="" url={p.thumbnailUrl} className="h-11 w-8 shrink-0" />
                  <span className="min-w-0">
                    <span className="block max-w-72 truncate font-bold text-ink" title={p.name}>
                      {p.name}
                    </span>
                    <PodChip podId={p.podId} />
                  </span>
                </a>
              </td>
              <td className="num py-2 pr-3 text-right font-bold text-ink">{money(p.totals.spendCents)}</td>
              <td className="py-2 pr-3 text-right">
                <CpaValue value={cpa(p.totals)} target={t.targetCpa} warnMax={t.cpaWarnMax} />
              </td>
              <td className="py-2 pr-3 text-right">
                <RoasValue value={roas(p.totals)} target={t.targetRoas} />
              </td>
              <td className="py-2 pr-3 text-right">
                <RoasValue value={twRoas(p.tw, p.totals.spendCents)} target={t.targetRoas} />
              </td>
              <td className="py-2 pr-3 text-ink-2">{p.offer == null ? "—" : p.offer ? "Discount / offer" : "No offer"}</td>
              <td className="py-2">
                <HitBadge status={p.hit} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function exportCsv(data: CoverageResponse, nameOf: (id: string | null) => string, levelOf: (a: string | null) => string) {
  const total = data.totals.spendCents;
  downloadCsv(
    `kojeva-coverage-${data.from === "2000-01-01" ? "all" : data.from}-to-${data.to}.csv`,
    [
      "Persona",
      "Awareness",
      "Ads running",
      "Spend (Meta, $)",
      "Share of spend (%)",
      "CPA (Meta, $)",
      "ROAS (Meta)",
      "ROAS (Triple Whale)",
      "Offer share of spend (%)",
      "Concepts tested (all time)",
      "Hits",
      "Misses",
      "Hit rate (%)",
    ],
    data.cells
      .slice()
      .sort((a, b) => b.totals.spendCents - a.totals.spendCents)
      .map((c) => [
        nameOf(c.personaId),
        levelOf(c.awareness),
        c.ads,
        plainDollars(c.totals.spendCents),
        plain(total > 0 ? (c.totals.spendCents / total) * 100 : null, 1),
        plain(cpa(c.totals)),
        plain(roas(c.totals)),
        plain(twRoas(c.tw, c.totals.spendCents)),
        plain(c.offerKnownSpendCents > 0 ? (c.offerSpendCents / c.offerKnownSpendCents) * 100 : null, 1),
        c.concepts,
        c.hits,
        c.misses,
        plain(c.hitRate == null ? null : c.hitRate * 100, 1),
      ]),
  );
}
