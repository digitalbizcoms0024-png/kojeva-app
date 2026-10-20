import { useEffect, useRef, useState } from "react";
import type { ConceptDetail, MetaResponse } from "../../shared/api.ts";
import { cpa, roas, type Totals } from "../../shared/metrics.ts";
import { ANGLES, AWARENESS, FORMATS, MOTIVATIONS } from "../../shared/taxonomy.ts";
import { useApi } from "../api.ts";
import { dollars, int, money, ratio, shortDate } from "../format.ts";
import { PlayableThumb } from "./AdPreview.tsx";
import { WinnerCall } from "./WinnerCall.tsx";
import { DailyCharts } from "./DailyCharts.tsx";
import { CpaValue, HitBadge, PodChip, RoasValue, Tag, Thumb } from "./ui.tsx";

/** Opens a concept's card over the current page ("#/<page>?concept=<id>"). */
export function conceptHref(conceptId: string): string {
  const page = window.location.hash.replace(/^#\/?/, "").split("?")[0] || "dashboard";
  return `#/${page}?concept=${encodeURIComponent(conceptId)}`;
}

const range = (from: string, to: string) => (from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`);

/** Spend, purchases, CPA and ROAS for one window, colored against the targets. */
function Numbers({ t, meta }: { t: Totals; meta: MetaResponse }) {
  return (
    <dl className="grid grid-cols-2 gap-0.5 sm:grid-cols-4 border-2 border-divider bg-divider [&>div]:bg-page [&>div]:px-3 [&>div]:py-2">
      <div>
        <dt className="kicker">Spend</dt>
        <dd className="num font-bold text-ink">{money(t.spendCents)}</dd>
      </div>
      <div>
        <dt className="kicker">Purchases</dt>
        <dd className="num font-bold text-ink">{int(t.purchases)}</dd>
      </div>
      <div>
        <dt className="kicker">CPA</dt>
        <dd className="font-bold">
          <CpaValue value={cpa(t)} target={meta.targets.targetCpa} warnMax={meta.targets.cpaWarnMax} />
        </dd>
      </div>
      <div>
        <dt className="kicker">ROAS</dt>
        <dd className="font-bold">
          <RoasValue value={roas(t)} target={meta.targets.targetRoas} />
        </dd>
      </div>
    </dl>
  );
}

/**
 * A concept's card, sliding in from the right over whatever page is open: its result and why,
 * the numbers it was judged on, its tags, its ads and its daily spend. Esc or the backdrop closes it.
 */
export function ConceptDrawer({ conceptId, meta, onClose }: { conceptId: string; meta: MetaResponse; onClose: () => void }) {
  const [reload, setReload] = useState(0);
  const { data, error } = useApi<ConceptDetail>(`/api/concepts/${encodeURIComponent(conceptId)}${reload ? `?r=${reload}` : ""}`);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const k = data?.concept;
  const t = meta.targets;
  const top = data?.ads[0];
  const persona = k?.personaId ? meta.personas.find((p) => p.id === k.personaId)?.name : null;
  const sinceLaunch = k?.lateWindow && k.lateWindow.from === k.firstSpend;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={k ? `Concept ${k.label}` : "Concept"}>
      <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className="relative flex h-full w-full max-w-[640px] flex-col overflow-y-auto bg-page shadow-xl outline-none">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b-2 border-divider bg-page px-5 py-4">
          <div className="min-w-0">
            <div className="kicker">Concept</div>
            <h2 className="truncate text-xl font-extrabold text-ink" title={k?.label}>
              {k?.label ?? "Loading…"}
            </h2>
            {k && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <PodChip podId={k.podId} />
                <HitBadge status={k.status} stillRunning={k.stillRunning} />
                <span className="text-xs text-ink-3">{k.adsetName}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="btn btn-secondary shrink-0" aria-label="Close concept">
            ✕
          </button>
        </div>

        {error && <p className="px-5 py-6 text-sm text-ink-3">Couldn't load this concept: {error.message}</p>}
        {k && data && (
          <div className="flex flex-col gap-6 px-5 py-5">
            {top && (
              <div className="flex gap-4">
                <PlayableThumb
                  postId={top.postId}
                  name={top.name}
                  mediaType={top.mediaType}
                  label={top.mediaType === "image" ? "Image" : "Video"}
                  url={top.thumbnailUrl}
                  className="h-48 w-36 shrink-0"
                />
                <a href={`#/rankings?post=${encodeURIComponent(top.postId)}`} className="min-w-0 text-sm text-ink-2 hover:underline" title="Open the ad">
                  <div className="font-bold text-ink">{top.name}</div>
                  <div className="mt-1">
                    {k.ads} {k.ads === 1 ? "ad" : "ads"} · first spend {shortDate(k.firstSpend)}
                    {k.lastSpend && ` · last spend ${shortDate(k.lastSpend)}`}
                  </div>
                  <div className="mt-1">{money(k.allTime.spendCents)} spent since launch</div>
                </a>
              </div>
            )}

            <WinnerCall k={k} meta={meta} onChanged={() => setReload((n) => n + 1)} />

            <section>
              <h3 className="mb-1 font-extrabold text-ink">Test · {range(k.firstSpend, k.windowEnd)}</h3>
              <p className="mb-2 text-xs text-ink-3">
                {k.qualifiedOn
                  ? `Judged from first spend to day ${t.testWindowDays}${k.windowEnd === k.qualifiedOn && k.qualifiedOn > k.firstSpend ? `, extended to ${shortDate(k.qualifiedOn)} when an ad reached $${t.minTestSpend}` : ""}.`
                  : `No single ad has spent $${t.minTestSpend} yet, so it isn't judged.`}{" "}
                Hit = CPA ≤ ${t.targetCpa} {t.hitRule === "both" ? "and" : "or"} ROAS ≥ {t.targetRoas}.
              </p>
              <Numbers t={k.window} meta={meta} />
            </section>

            {k.lateWindow && (
              <section>
                <h3 className="mb-1 font-extrabold text-ink">
                  Late hit · {range(k.lateWindow.from, k.lateWindow.to)}
                </h3>
                <p className="mb-2 text-xs text-ink-3">
                  {sinceLaunch ? "Its totals since launch reached target." : `${t.lateWindowDays} days in a row reached target after the test missed.`}
                </p>
                <Numbers t={k.lateWindow.totals} meta={meta} />
              </section>
            )}

            <section>
              <h3 className="mb-2 font-extrabold text-ink">Since launch</h3>
              <Numbers t={k.allTime} meta={meta} />
            </section>

            {(k.angle || k.format || k.awareness || persona || k.atriaThemes.length > 0 || k.beliefGroups.length > 0 || k.motivations.length > 0) && (
              <section>
                <h3 className="mb-2 font-extrabold text-ink">Tags</h3>
                <div className="flex flex-wrap gap-1.5">
                  {k.angle && <Tag>Angle: {ANGLES[k.angle] ?? k.angle}</Tag>}
                  {k.format && <Tag>Format: {FORMATS[k.format] ?? k.format}</Tag>}
                  {k.awareness && <Tag tone="ink">{AWARENESS[k.awareness] ?? k.awareness}</Tag>}
                  {persona && <Tag tone="outline">Persona: {persona}</Tag>}
                  {k.beliefGroups.map((b) => (
                    <Tag key={b} tone="outline">
                      {b}
                    </Tag>
                  ))}
                  {k.motivations.map((m) => (
                    <Tag key={m} tone="accent">
                      {MOTIVATIONS[m] ?? m}
                    </Tag>
                  ))}
                  {k.atriaThemes.map((th) => (
                    <Tag key={th}>{th}</Tag>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-2 font-extrabold text-ink">Ads · {data.ads.length}</h3>
              <ul className="flex flex-col">
                {data.ads.map((a) => (
                  <li key={a.adId} className="border-b border-divider py-2.5">
                    <a href={`#/rankings?post=${encodeURIComponent(a.postId)}`} className="flex items-center gap-3 hover:underline">
                      <Thumb mediaType={a.mediaType} label="" url={a.thumbnailUrl} className="h-14 w-11 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink" title={a.name}>
                          {a.name}
                        </span>
                        <span className="num block text-xs text-ink-3">
                          {a.status === "ACTIVE" ? "Active" : a.status.toLowerCase().replace(/_/g, " ")} · test {money(a.window.spendCents)},{" "}
                          {int(a.window.purchases)} purch. · since launch {money(a.allTime.spendCents)}, CPA {dollars(cpa(a.allTime))}, ROAS{" "}
                          {ratio(roas(a.allTime))}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>

            {data.daily.length > 0 && (
              <section>
                <h3 className="mb-2 font-extrabold text-ink">Daily</h3>
                <DailyCharts daily={data.daily} targetCpa={t.targetCpa} />
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
