import { useEffect, useState } from "react";
import type { AssignmentPatch, CoverageResponse, MetaResponse, PodsResponse, PostSummary, RankingsResponse, SuggestionsResponse } from "../../shared/api.ts";
import { podById, ANGLES, AWARENESS, FORMAT_DEFINITIONS, FORMATS, HOOKS, LANDING_PAGES, MOTIVATIONS } from "../../shared/taxonomy.ts";
import { qs, useApi } from "../api.ts";
import { HeaderControls } from "../components/HeaderControls.tsx";
import { Empty, PageHeader, PodChip, SearchBox, Segmented, LoadError, ViewOnlyNote, Tabs } from "../components/ui.tsx";
import { money, pct, shortDate } from "../format.ts";
import { conceptHref } from "../drill.ts";
import { PlayableThumb } from "../components/AdPreview.tsx";
import { MIN_MAP_SPEND_CENTS } from "../../shared/metrics.ts";

async function send(path: string, method: string, body: unknown) {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json;
}

const vocabOptions = (v: Record<string, string>) => [{ value: "", label: "—" }, ...Object.entries(v).map(([value, label]) => ({ value, label }))];
const TAGS: { key: "angle" | "format" | "hook" | "landingPage"; label: string; options: { value: string; label: string }[] }[] = [
  { key: "angle", label: "Angle", options: vocabOptions(ANGLES) },
  { key: "format", label: "Format", options: vocabOptions(FORMATS) },
  { key: "hook", label: "Hook", options: vocabOptions(HOOKS) },
  { key: "landingPage", label: "Landing page", options: vocabOptions(LANDING_PAGES) },
];

const selectCls = "field w-full min-w-28 py-1.5";

const motivationText = (list: string[] | null) => (list?.length ? list.map((m) => MOTIVATIONS[m] ?? m).join(", ") : "none");

/** Motivation tags: Claude's until set by hand; a hand-set list (even empty) wins until cleared. */
function MotivationPicker({ manual, claude, disabled, onChange }: { manual: string[] | null; claude: string[] | null; disabled: boolean; onChange: (v: string[] | null) => void }) {
  const current = manual ?? claude ?? [];
  const toggle = (key: string) => onChange(current.includes(key) ? current.filter((m) => m !== key) : [...current, key]);
  return (
    <details className="relative min-w-40 text-sm">
      <summary className={`field cursor-pointer py-1.5 ${disabled ? "pointer-events-none opacity-60" : ""}`} title={manual ? "Set by hand" : "Claude's label"}>
        {manual ? motivationText(manual) : `Claude: ${claude == null ? "—" : motivationText(claude)}`}
      </summary>
      <div className="absolute right-0 z-20 mt-1 flex w-64 flex-col gap-1 border-2 border-divider bg-page p-2 shadow-lg">
        {Object.entries(MOTIVATIONS).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input type="checkbox" checked={current.includes(key)} onChange={() => toggle(key)} disabled={disabled} />
            {label}
          </label>
        ))}
        {manual && (
          <button type="button" className="link mt-1 self-start text-xs" onClick={() => onChange(null)} disabled={disabled}>
            Use Claude's label
          </button>
        )}
      </div>
    </details>
  );
}

type View = "unassigned" | "unplaced" | "suggestions" | "all";
type Period = "month" | "all";

const activePersonasCount = (meta: MetaResponse) => meta.personas.filter((p) => p.status === "active").length;

export function TaggingPage({ meta, onChanged }: { meta: MetaResponse; onChanged: () => void }) {
  // "#/tagging?view=unplaced" (the Coverage map's "place them") opens on that list.
  const [view, setView] = useState<View>(() => {
    const v = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("view");
    return v === "unplaced" || v === "suggestions" || v === "all" ? v : "unassigned";
  });
  const [period, setPeriod] = useState<Period>("month");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<PostSummary[]>([]);
  const [status, setStatus] = useState<Record<string, "saving" | "saved" | string>>({});
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [staged, setStaged] = useState<AssignmentPatch>({});

  useEffect(() => {
    const t = setTimeout(() => setQ(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // "Not placed": running in the last 7 days (the coverage map's default) without a persona or awareness level.
  const { data, error, retry } = useApi<RankingsResponse>(
    `/api/rankings?${qs({ range: view === "unplaced" ? "week" : period, pod: view === "unassigned" ? "unassigned" : "all", q, limit: view === "unplaced" ? 2000 : 300, r: reload })}`,
  );
  const coverage = useApi<PodsResponse>(`/api/pods?${qs({ range: "month", r: reload })}`);
  // The coverage map's own numbers (last 7 days, $50+): the "Not on the coverage map" tab's summary.
  const map = useApi<CoverageResponse>(activePersonasCount(meta) ? `/api/coverage?${qs({ range: "week", r: reload })}` : null);
  const sugg = useApi<SuggestionsResponse>(`/api/suggestions?r=${reload}`);
  const suggestions = sugg.data?.suggestions ?? {};
  const activePersonas = meta.personas.filter((p) => p.status === "active");
  const personaName = (id: string | null) => activePersonas.find((p) => p.id === id)?.name ?? null;
  // Claude's open suggestions for a post: a pod, and a format that differs from the one set.
  const formatSuggestion = (r: PostSummary) => (r.labels.format && r.labels.format !== r.assignment.format ? r.labels.format : null);
  const suggestionsOf = (r: PostSummary) => (suggestions[r.postId] ? 1 : 0) + (formatSuggestion(r) ? 1 : 0);
  const placed = (r: PostSummary) => !!personaName(r.assignment.personaId ?? r.labels.personaId) && !!(r.assignment.awareness ?? r.labels.awareness);
  useEffect(() => {
    // The map leaves out ads under MIN_MAP_SPEND_CENTS in the period, so this list does too.
    if (data)
      setRows(
        view === "unplaced"
          ? data.items.filter((r) => !placed(r) && r.totals.spendCents >= MIN_MAP_SPEND_CENTS)
          : view === "suggestions"
            ? data.items.filter((r) => suggestionsOf(r) > 0)
            : data.items,
      );
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, view === "suggestions" ? sugg.data : null]);

  const pods = meta.pods;
  const podOptions = [{ value: "", label: "No pod" }, ...pods.map((p) => ({ value: p.id, label: p.name }))];
  const editorsFor = (podId: string | null) => meta.editors.filter((e) => !podId || !e.podId || e.podId === podId);
  const disabled = !meta.canEdit;

  const covTotal = coverage.data?.rows.reduce((n, r) => n + r.totals.spendCents, 0) ?? 0;
  const covMissing = coverage.data?.rows.find((r) => r.kind === "unassigned")?.totals.spendCents ?? 0;
  const covShare = covTotal > 0 ? 1 - covMissing / covTotal : null;

  const done = () => {
    setReload((n) => n + 1);
    onChanged();
  };

  const patchRow = async (row: PostSummary, patch: AssignmentPatch) => {
    setStatus((s) => ({ ...s, [row.postId]: "saving" }));
    try {
      await send(`/api/posts/${encodeURIComponent(row.postId)}/assignment`, "PATCH", patch);
      setStatus((s) => ({ ...s, [row.postId]: "saved" }));
      if (patch.reset?.length || patch.podId !== undefined) done();
      else
        setRows((rs) =>
          rs.map((r) => {
            if (r.postId !== row.postId) return r;
            const a = { ...r.assignment };
            if (patch.editorId !== undefined)
              Object.assign(a, { editorId: patch.editorId, editorName: meta.editors.find((e) => e.id === patch.editorId)?.name ?? null });
            for (const t of TAGS) if (patch[t.key] !== undefined) Object.assign(a, { [t.key]: patch[t.key], tagsSource: "manual" });
            if (patch.awareness !== undefined) a.awareness = patch.awareness;
            if (patch.beliefGroup !== undefined) a.beliefGroup = patch.beliefGroup;
            if (patch.personaId !== undefined) a.personaId = patch.personaId;
            if (patch.offer !== undefined) a.offer = patch.offer;
            if (patch.motivations !== undefined) a.motivations = patch.motivations;
            return { ...r, assignment: a };
          }),
        );
    } catch (e) {
      setStatus((s) => ({ ...s, [row.postId]: (e as Error).message }));
    }
  };

  const bulk = async (postIds: string[], patch: AssignmentPatch) => {
    // The bulk route takes one patch, so suggestions are applied one pod at a time.
    await send("/api/assignments/bulk", "POST", { postIds, patch });
  };

  const applyStaged = async () => {
    const postIds = [...selected];
    setBulkMsg("Saving…");
    try {
      await bulk(postIds, staged);
      setBulkMsg(`Saved for ${postIds.length} ${postIds.length === 1 ? "ad" : "ads"}.`);
      setStaged({});
      done();
    } catch (e) {
      setBulkMsg((e as Error).message);
    }
  };

  const acceptSuggestions = async () => {
    const byPod = new Map<string, string[]>();
    const byFormat = new Map<string, string[]>();
    for (const r of rows) {
      if (!selected.has(r.postId)) continue;
      const s = suggestions[r.postId];
      if (s) byPod.set(s.podId, [...(byPod.get(s.podId) ?? []), r.postId]);
      const f = formatSuggestion(r);
      if (f) byFormat.set(f, [...(byFormat.get(f) ?? []), r.postId]);
    }
    const n = [...byPod.values(), ...byFormat.values()].reduce((k, ids) => k + ids.length, 0);
    setBulkMsg("Saving…");
    try {
      for (const [podId, ids] of byPod) await bulk(ids, { podId });
      for (const [format, ids] of byFormat) await bulk(ids, { format });
      setBulkMsg(`Accepted ${n} ${n === 1 ? "suggestion" : "suggestions"}.`);
      done();
    } catch (e) {
      setBulkMsg((e as Error).message);
    }
  };

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.postId));
  const selectedSpend = rows.filter((r) => selected.has(r.postId)).reduce((n, r) => n + r.totals.spendCents, 0);
  const selectedWithSuggestion = rows.filter((r) => selected.has(r.postId)).reduce((n, r) => n + suggestionsOf(r), 0);
  const stagedCount = Object.values(staged).filter((v) => v !== undefined).length;
  const stage = (k: keyof AssignmentPatch, v: string) => setStaged((s) => ({ ...s, [k]: v === "" ? undefined : v === "__none" ? null : v }));

  return (
    <div>
      <PageHeader title="To review" subtitle="Fix what the hub can't work out on its own. Hand-set values are kept when syncs run.">
        <HeaderControls meta={meta} />
      </PageHeader>

      <div className="flex flex-col gap-5 px-4 py-6 md:px-8">
        <ViewOnlyNote canEdit={!disabled} accessProtected={meta.accessProtected} />

        {/* Each tab is its own job, with its own summary, period and instructions. */}
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: "unassigned", label: `Needs a pod${meta.needsTagging ? ` · ${meta.needsTagging}` : ""}` },
            ...(activePersonas.length
              ? [{ value: "unplaced" as const, label: `Not on the coverage map${map.data?.unplaced ? ` · ${map.data.unplaced}` : ""}` }]
              : []),
            { value: "suggestions", label: "Claude's suggestions" },
            { value: "all", label: "All ads" },
          ]}
        />

        {view === "unassigned" && (
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <div className="num text-[56px] leading-none font-extrabold tracking-[-0.03em] text-ink">{pct(covShare, 0)}</div>
              <div className="mt-1 text-sm text-ink-3">of spend credited to a pod or the agency · last 30 days</div>
            </div>
            <div className="min-w-64 flex-1">
              <div className="h-3 bg-surface-2">
                <div className="h-full bg-ink" style={{ width: `${(covShare ?? 0) * 100}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
                <span className="num text-ink">
                  {meta.needsTagging} {meta.needsTagging === 1 ? "ad" : "ads"} · {money(covMissing)} not credited
                </span>
                <span className="text-ink-3">Ads whose ad set name doesn't say which pod made them. Set the pod so their spend counts.</span>
              </div>
            </div>
          </div>
        )}
        {view === "unplaced" && (
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <div className="num text-[56px] leading-none font-extrabold tracking-[-0.03em] text-ink">
                {map.data ? money(map.data.unplacedSpendCents, { compact: true }) : "…"}
              </div>
              <div className="mt-1 text-sm text-ink-3">
                of spend not on the{" "}
                <a href="#/coverage" className="link">
                  coverage map
                </a>
                {map.data && map.data.totals.spendCents > 0 ? ` (${pct(map.data.unplacedSpendCents / map.data.totals.spendCents, 0)})` : ""} · last 7 days, ads with $50+
              </div>
            </div>
            <p className="min-w-64 flex-1 text-sm text-ink-3">
              These ads have no persona or awareness level yet. Claude labels new creatives nightly; to place some now, tick them and set a persona and
              awareness in the bar that appears. Press ▶ to watch an ad first.
            </p>
          </div>
        )}
        {view === "suggestions" && (
          <p className="text-sm text-ink-3">
            Pods and formats Claude suggests, never applied without you. Use one with its <b className="text-ink-2">use</b> link, or tick several and press{" "}
            <b className="text-ink-2">Accept</b> in the bar that appears.
          </p>
        )}
        {view === "all" && <p className="text-sm text-ink-3">Every ad, highest spend first, to change any tag by hand.</p>}

        <div className="flex flex-wrap items-center gap-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Search ads…" />
          {view !== "unplaced" && (
            <Segmented
              label="Period"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "month", label: "Last 30 days" },
                { value: "all", label: "All time" },
              ]}
            />
          )}
        </div>

        {selected.size > 0 && (
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 bg-ink px-4 py-3 text-page">
            <b className="num mr-2">
              {selected.size} selected · {money(selectedSpend)}
            </b>
            <select
              aria-label="Set pod"
              className="bg-page px-2 py-1.5 text-sm text-ink"
              value={staged.podId === null ? "__none" : (staged.podId ?? "")}
              onChange={(e) => stage("podId", e.target.value)}
              disabled={disabled}
            >
              <option value="">Pod…</option>
              {pods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Set editor"
              className="bg-page px-2 py-1.5 text-sm text-ink"
              value={staged.editorId ?? ""}
              onChange={(e) => stage("editorId", e.target.value)}
              disabled={disabled || meta.editors.length === 0}
            >
              <option value="">{meta.editors.length ? "Editor…" : "No editors yet"}</option>
              {meta.editors.map((ed) => (
                <option key={ed.id} value={ed.id}>
                  {ed.name}
                </option>
              ))}
            </select>
            {TAGS.slice(0, 2).map((t) => (
              <select
                key={t.key}
                aria-label={`Set ${t.label.toLowerCase()}`}
                className="bg-page px-2 py-1.5 text-sm text-ink"
                value={staged[t.key] ?? ""}
                onChange={(e) => stage(t.key, e.target.value)}
                disabled={disabled}
              >
                <option value="">{t.label}…</option>
                {t.options.slice(1).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ))}
            {activePersonas.length > 0 && (
              <select
                aria-label="Set persona"
                className="bg-page px-2 py-1.5 text-sm text-ink"
                value={staged.personaId ?? ""}
                onChange={(e) => stage("personaId", e.target.value)}
                disabled={disabled}
              >
                <option value="">Persona…</option>
                {activePersonas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="Set awareness"
              className="bg-page px-2 py-1.5 text-sm text-ink"
              value={staged.awareness ?? ""}
              onChange={(e) => stage("awareness", e.target.value)}
              disabled={disabled}
            >
              <option value="">Awareness…</option>
              {Object.entries(AWARENESS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <span className="flex-1" />
            {selectedWithSuggestion > 0 && (
              <button className="btn border-page text-page hover:bg-ink-2" disabled={disabled} onClick={acceptSuggestions}>
                Accept {selectedWithSuggestion} {selectedWithSuggestion === 1 ? "suggestion" : "suggestions"}
              </button>
            )}
            <button className="btn btn-primary" disabled={disabled || stagedCount === 0} onClick={applyStaged}>
              Apply to {selected.size} selected
            </button>
            <button
              className="btn btn-ghost text-page"
              onClick={() => bulk([...selected], { reset: ["pod"] }).then(done, (e: Error) => setBulkMsg(e.message))}
              disabled={disabled}
            >
              Back to automatic
            </button>
            {bulkMsg && <span className="w-full text-xs opacity-80">{bulkMsg}</span>}
          </div>
        )}

        <LoadError error={error} retry={retry} what="ads" loading={!data} rows={8} />
        {data && rows.length === 0 && (
          <Empty>
            {view === "unassigned"
              ? "Every ad with spend in this period has a pod."
              : view === "unplaced"
                ? "Every ad running this week is on the coverage map."
                : "No ads match."}
          </Empty>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="kicker text-left">
                <tr className="border-b-2 border-divider">
                  <th className="w-8 py-2 pr-2">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allChecked}
                      onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.postId)))}
                    />
                  </th>
                  <th className="py-2 pr-2 font-normal">Ad name</th>
                  <th className="py-2 pr-2 text-right font-normal">Spend</th>
                  <th className="py-2 pr-2 font-normal">Suggested pod</th>
                  <th className="py-2 pr-2 font-normal">Pod</th>
                  <th className="py-2 pr-2 font-normal">Editor</th>
                  {TAGS.map((t) => (
                    <th key={t.key} className="py-2 pr-2 font-normal">
                      {t.label}
                    </th>
                  ))}
                  {activePersonas.length > 0 && (
                    <th className="py-2 pr-2 font-normal" title="Empty = Claude's label">
                      Persona
                    </th>
                  )}
                  <th className="py-2 pr-2 font-normal" title="Empty = Claude's label from Atria's tags">
                    Awareness
                  </th>
                  <th className="py-2 pr-2 font-normal" title="Empty = Claude's label">
                    Offer
                  </th>
                  <th className="py-2 pr-2 font-normal" title="Empty = Claude's grouping">
                    Belief shifted
                  </th>
                  <th className="py-2 pr-2 font-normal" title="What the ad leans on; Claude's label until set by hand">
                    Motivations
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const a = r.assignment;
                  const st = status[r.postId];
                  const s = !a.podId ? suggestions[r.postId] : undefined;
                  return (
                    <tr key={r.postId} className={`border-b border-divider ${selected.has(r.postId) ? "bg-surface" : ""}`}>
                      <td className="py-2.5 pr-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.name}`}
                          checked={selected.has(r.postId)}
                          onChange={() =>
                            setSelected((cur) => {
                              const n = new Set(cur);
                              if (n.has(r.postId)) n.delete(r.postId);
                              else n.add(r.postId);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="min-w-64 py-2.5 pr-2">
                        <div className="flex items-center gap-2.5">
                          <PlayableThumb postId={r.postId} name={r.name} mediaType={r.mediaType} label="" url={r.thumbnailUrl} className="h-11 w-8 shrink-0" compact />
                          <div className="min-w-0">
                            {r.conceptId ? (
                              <a href={conceptHref(r.conceptId)} className="block truncate font-bold text-ink hover:underline" title={`${r.name} — open its concept`}>
                                {r.name}
                              </a>
                            ) : (
                              <div className="truncate font-bold text-ink" title={r.name}>
                                {r.name}
                              </div>
                            )}
                            <div className="truncate text-xs text-ink-3" title={r.adsetName ?? ""}>
                              First seen {shortDate(r.launched)} · {r.copies} {r.copies === 1 ? "copy" : "copies"} · {r.adsetName ?? "—"}
                            </div>
                            <div className="text-xs">
                              {st === "saving" && <span className="text-ink-3">Saving…</span>}
                              {st === "saved" && <span className="text-good">✓ Saved</span>}
                              {st && st !== "saving" && st !== "saved" && <span className="text-bad">✕ {st}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="num py-2.5 pr-2 text-right font-bold text-ink">{money(r.totals.spendCents)}</td>
                      <td className="min-w-52 py-2.5 pr-2">
                        {s ? (
                          <div className="flex items-start gap-2">
                            <div className="min-w-0">
                              <PodChip podId={s.podId} suffix={<span className="text-ink-3">· {s.confidence === "high" ? "High" : "Medium"}</span>} />
                              <div className="mt-0.5 max-w-52 truncate text-[11px] text-ink-3" title={s.reason}>
                                {s.reason}
                              </div>
                            </div>
                            <button
                              className="btn btn-ghost py-0 text-sm"
                              disabled={disabled}
                              onClick={() => patchRow(r, { podId: s.podId })}
                              aria-label={`Accept ${podById(s.podId)?.name} for ${r.name}`}
                            >
                              Accept
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-ink-3">{a.podId ? "—" : "No pattern match"}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-2">
                        <select
                          aria-label="Pod"
                          className={selectCls}
                          value={a.podId ?? ""}
                          disabled={disabled}
                          onChange={(e) => patchRow(r, { podId: e.target.value || null })}
                        >
                          {podOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <div className="mt-0.5 text-[11px] text-ink-3">
                          {a.podSource === "manual" ? (
                            <button className="underline" disabled={disabled} onClick={() => patchRow(r, { reset: ["pod"] })}>
                              Manual · use auto
                            </button>
                          ) : a.podSource ? (
                            `Auto · ${a.podSource === "adset" ? "ad set" : a.podSource === "era" ? "pre-pods" : "ad name"}`
                          ) : (
                            "Auto · not found"
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 pr-2">
                        <select
                          aria-label="Editor"
                          className={selectCls}
                          value={a.editorId ?? ""}
                          disabled={disabled}
                          onChange={(e) => patchRow(r, { editorId: e.target.value || null })}
                        >
                          <option value="">—</option>
                          {editorsFor(a.podId).map((ed) => (
                            <option key={ed.id} value={ed.id}>
                              {ed.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      {TAGS.map((t) => (
                        <td key={t.key} className="py-2.5 pr-2">
                          <select
                            aria-label={t.label}
                            className={selectCls}
                            value={a[t.key] ?? ""}
                            disabled={disabled}
                            onChange={(e) => patchRow(r, { [t.key]: e.target.value || null })}
                          >
                            {t.options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          {/* Claude's format suggestion (from the ad's frames and Atria's tags): never applied without you. */}
                          {t.key === "format" && r.labels.format && r.labels.format !== a.format && (
                            <button
                              type="button"
                              className="link mt-1 block text-left text-xs"
                              disabled={disabled}
                              title={FORMAT_DEFINITIONS[r.labels.format] ?? undefined}
                              onClick={() => patchRow(r, { format: r.labels.format })}
                            >
                              Claude: {FORMATS[r.labels.format] ?? r.labels.format} · use
                            </button>
                          )}
                        </td>
                      ))}
                      {activePersonas.length > 0 && (
                        <td className="py-2.5 pr-2">
                          <select
                            aria-label="Persona"
                            className={`${selectCls} min-w-36`}
                            value={a.personaId ?? ""}
                            disabled={disabled}
                            onChange={(e) => patchRow(r, { personaId: e.target.value || null })}
                          >
                            <option value="">Claude: {personaName(r.labels.personaId) ?? "—"}</option>
                            {activePersonas.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td className="py-2.5 pr-2">
                        <select
                          aria-label="Awareness"
                          className={selectCls}
                          value={a.awareness ?? ""}
                          disabled={disabled}
                          onChange={(e) => patchRow(r, { awareness: e.target.value || null })}
                        >
                          <option value="">Claude: {r.labels.awareness ? (AWARENESS[r.labels.awareness] ?? "—") : "—"}</option>
                          {Object.entries(AWARENESS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 pr-2">
                        <select
                          aria-label="Offer"
                          className={selectCls}
                          value={a.offer == null ? "" : a.offer ? "yes" : "no"}
                          disabled={disabled}
                          onChange={(e) => patchRow(r, { offer: e.target.value === "" ? null : e.target.value === "yes" })}
                        >
                          <option value="">Claude: {r.labels.offer == null ? "—" : r.labels.offer ? "Offer" : "No offer"}</option>
                          <option value="yes">Discount / offer</option>
                          <option value="no">No offer</option>
                        </select>
                      </td>
                      <td className="py-2.5 pr-2">
                        <input
                          aria-label="Belief shifted"
                          className={`${selectCls} min-w-40`}
                          defaultValue={a.beliefGroup ?? ""}
                          placeholder="Claude's label"
                          maxLength={60}
                          disabled={disabled}
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            if (v !== (a.beliefGroup ?? null)) void patchRow(r, { beliefGroup: v });
                          }}
                        />
                      </td>
                      <td className="py-2.5 pr-2">
                        <MotivationPicker
                          manual={a.motivations}
                          claude={r.labels.motivations}
                          disabled={disabled}
                          onChange={(v) => void patchRow(r, { motivations: v })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
