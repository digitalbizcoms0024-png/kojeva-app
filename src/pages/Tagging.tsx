import { useEffect, useState } from "react";
import type { AssignmentPatch, MetaResponse, PodsResponse, PostSummary, RankingsResponse, SuggestionsResponse } from "../../shared/api.ts";
import { podById, ANGLES, FORMATS, HOOKS, LANDING_PAGES } from "../../shared/taxonomy.ts";
import { qs, useApi } from "../api.ts";
import { HeaderControls } from "../components/HeaderControls.tsx";
import { Empty, PageHeader, PodChip, Segmented, Thumb } from "../components/ui.tsx";
import { money, pct, shortDate } from "../format.ts";

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

type View = "unassigned" | "all";
type Period = "month" | "all";

export function TaggingPage({ meta, onChanged }: { meta: MetaResponse; onChanged: () => void }) {
  const [view, setView] = useState<View>("unassigned");
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

  const { data, error } = useApi<RankingsResponse>(
    `/api/rankings?${qs({ range: period, pod: view === "unassigned" ? "unassigned" : "all", q, limit: 300, r: reload })}`,
  );
  const coverage = useApi<PodsResponse>(`/api/pods?${qs({ range: "month", r: reload })}`);
  const sugg = useApi<SuggestionsResponse>(`/api/suggestions?r=${reload}`);
  const suggestions = sugg.data?.suggestions ?? {};
  useEffect(() => {
    if (data) setRows(data.items);
    setSelected(new Set());
  }, [data]);

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
    for (const id of selected) {
      const s = suggestions[id];
      if (s) byPod.set(s.podId, [...(byPod.get(s.podId) ?? []), id]);
    }
    const n = [...byPod.values()].reduce((k, ids) => k + ids.length, 0);
    setBulkMsg("Saving…");
    try {
      for (const [podId, ids] of byPod) await bulk(ids, { podId });
      setBulkMsg(`Accepted ${n} ${n === 1 ? "suggestion" : "suggestions"}.`);
      done();
    } catch (e) {
      setBulkMsg((e as Error).message);
    }
  };

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.postId));
  const selectedSpend = rows.filter((r) => selected.has(r.postId)).reduce((n, r) => n + r.totals.spendCents, 0);
  const selectedWithSuggestion = [...selected].filter((id) => suggestions[id]).length;
  const stagedCount = Object.values(staged).filter((v) => v !== undefined).length;
  const stage = (k: keyof AssignmentPatch, v: string) => setStaged((s) => ({ ...s, [k]: v === "" ? undefined : v === "__none" ? null : v }));

  return (
    <div>
      <PageHeader title="Needs Tagging" subtitle="Ads the hub couldn't credit to a pod from their names. Hand-set values are kept when syncs run.">
        <HeaderControls meta={meta} />
      </PageHeader>

      <div className="flex flex-col gap-5 px-4 py-6 md:px-8">
        {disabled && <p className="bg-warn-soft px-3 py-2 text-sm text-ink">Editing is off until Cloudflare Access is set up for this app.</p>}

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
              <span className="text-ink-3">Highest spend first. Suggestions are never applied without you.</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ad name…" className="field min-w-56 flex-1" />
          <Segmented
            label="Which ads"
            value={view}
            onChange={setView}
            options={[
              { value: "unassigned", label: "Needs a pod" },
              { value: "all", label: "All ads" },
            ]}
          />
          <Segmented
            label="Period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "month", label: "Last 30 days" },
              { value: "all", label: "All time" },
            ]}
          />
        </div>

        {selected.size > 0 && (
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 bg-ink px-4 py-3 text-page">
            <b className="num mr-2">
              {selected.size} selected · {money(selectedSpend)}
            </b>
            <select aria-label="Set pod" className="bg-page px-2 py-1.5 text-sm text-ink" value={staged.podId === null ? "__none" : (staged.podId ?? "")} onChange={(e) => stage("podId", e.target.value)} disabled={disabled}>
              <option value="">Pod…</option>
              {pods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select aria-label="Set editor" className="bg-page px-2 py-1.5 text-sm text-ink" value={staged.editorId ?? ""} onChange={(e) => stage("editorId", e.target.value)} disabled={disabled || meta.editors.length === 0}>
              <option value="">{meta.editors.length ? "Editor…" : "No editors yet"}</option>
              {meta.editors.map((ed) => (
                <option key={ed.id} value={ed.id}>
                  {ed.name}
                </option>
              ))}
            </select>
            {TAGS.slice(0, 2).map((t) => (
              <select key={t.key} aria-label={`Set ${t.label.toLowerCase()}`} className="bg-page px-2 py-1.5 text-sm text-ink" value={staged[t.key] ?? ""} onChange={(e) => stage(t.key, e.target.value)} disabled={disabled}>
                <option value="">{t.label}…</option>
                {t.options.slice(1).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ))}
            <span className="flex-1" />
            {selectedWithSuggestion > 0 && (
              <button className="btn border-page text-page hover:bg-ink-2" disabled={disabled} onClick={acceptSuggestions}>
                Accept {selectedWithSuggestion} {selectedWithSuggestion === 1 ? "suggestion" : "suggestions"}
              </button>
            )}
            <button className="btn btn-primary" disabled={disabled || stagedCount === 0} onClick={applyStaged}>
              Apply to {selected.size} selected
            </button>
            <button className="btn btn-ghost text-page" onClick={() => bulk([...selected], { reset: ["pod"] }).then(done, (e: Error) => setBulkMsg(e.message))} disabled={disabled}>
              Back to automatic
            </button>
            {bulkMsg && <span className="w-full text-xs opacity-80">{bulkMsg}</span>}
          </div>
        )}

        {error && <Empty>Couldn't load ads: {error.message}</Empty>}
        {data && rows.length === 0 && <Empty>{view === "unassigned" ? "Every ad with spend in this period has a pod." : "No ads match."}</Empty>}
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
                          <Thumb mediaType={r.mediaType} label="" url={r.thumbnailUrl} className="h-11 w-8 shrink-0" />
                          <div className="min-w-0">
                            <div className="truncate font-bold text-ink" title={r.name}>
                              {r.name}
                            </div>
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
                        <select aria-label="Pod" className={selectCls} value={a.podId ?? ""} disabled={disabled} onChange={(e) => patchRow(r, { podId: e.target.value || null })}>
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
                        <select aria-label="Editor" className={selectCls} value={a.editorId ?? ""} disabled={disabled} onChange={(e) => patchRow(r, { editorId: e.target.value || null })}>
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
                          <select aria-label={t.label} className={selectCls} value={a[t.key] ?? ""} disabled={disabled} onChange={(e) => patchRow(r, { [t.key]: e.target.value || null })}>
                            {t.options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      ))}
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
