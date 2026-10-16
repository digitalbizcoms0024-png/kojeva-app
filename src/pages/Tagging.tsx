import { useEffect, useMemo, useState } from "react";
import type { AssignmentPatch, MetaResponse, PostSummary, RankingsResponse } from "../../shared/api.ts";
import { ANGLES, FORMATS, HOOKS, LANDING_PAGES } from "../../shared/taxonomy.ts";
import { qs, useApi } from "../api.ts";
import { Card, Empty, Segmented, Thumb } from "../components/ui.tsx";
import { money } from "../format.ts";

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

const selectCls =
  "w-full min-w-24 rounded-md border border-line bg-surface px-1.5 py-1 text-sm text-ink focus:outline-2 focus:outline-accent disabled:opacity-50";

type View = "unassigned" | "all";

export function TaggingPage({ meta }: { meta: MetaResponse }) {
  const [view, setView] = useState<View>("unassigned");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<PostSummary[]>([]);
  const [status, setStatus] = useState<Record<string, "saving" | "saved" | string>>({});
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, error } = useApi<RankingsResponse>(
    `/api/rankings?${qs({ range: "all", pod: view === "unassigned" ? "unassigned" : "all", q, limit: 300, r: reload })}`,
  );
  useEffect(() => {
    if (data) setRows(data.items);
    setSelected(new Set());
  }, [data]);

  const pods = meta.pods;
  const podOptions = [{ value: "", label: "No pod" }, ...pods.map((p) => ({ value: p.id, label: p.name }))];
  const editorsFor = (podId: string | null) => meta.editors.filter((e) => !podId || !e.podId || e.podId === podId);
  const unassignedSpend = useMemo(() => (view === "unassigned" ? data?.totals.spendCents : null), [data, view]);
  const disabled = !meta.canEdit;

  const patchRow = async (row: PostSummary, patch: AssignmentPatch) => {
    setStatus((s) => ({ ...s, [row.postId]: "saving" }));
    try {
      await send(`/api/posts/${encodeURIComponent(row.postId)}/assignment`, "PATCH", patch);
      setStatus((s) => ({ ...s, [row.postId]: "saved" }));
      if (patch.reset?.length) setReload((n) => n + 1);
      else
        setRows((rs) =>
          rs.map((r) => {
            if (r.postId !== row.postId) return r;
            const a = { ...r.assignment };
            if (patch.podId !== undefined) Object.assign(a, { podId: patch.podId, podSource: "manual" });
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

  const bulk = async (patch: AssignmentPatch, label: string) => {
    const postIds = [...selected];
    setBulkMsg("Saving…");
    try {
      await send("/api/assignments/bulk", "POST", { postIds, patch });
      setBulkMsg(`${label} for ${postIds.length} ads.`);
      setReload((n) => n + 1);
    } catch (e) {
      setBulkMsg((e as Error).message);
    }
  };

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.postId));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Needs tagging</h1>
          <p className="max-w-[65ch] text-sm text-ink-3">
            Set a pod, editor or tags by hand. Hand-set values are kept when syncs run; "Auto" hands a post back to automatic
            attribution. Highest all-time spend first.
          </p>
        </div>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "unassigned", label: "Needs a pod" },
            { value: "all", label: "All ads" },
          ]}
        />
      </div>

      {disabled && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-ink">Editing is off until Cloudflare Access is set up for this app.</p>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <input
            id="tagging-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ad name…"
            className="min-w-48 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:outline-2 focus:outline-accent"
          />
          {data && (
            <span className="num text-xs text-ink-3">
              {data.count.toLocaleString()} ads{unassignedSpend != null && ` · ${money(unassignedSpend, { compact: true })} all-time spend without a pod`}
            </span>
          )}
        </div>

        {selected.size > 0 && (
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-accent-soft px-4 py-2 text-sm">
            <b className="text-ink">{selected.size} selected</b>
            <label className="flex items-center gap-2 whitespace-nowrap text-ink-2">
              Set pod
              <select
                id="bulk-pod"
                className={selectCls}
                defaultValue=""
                disabled={disabled}
                onChange={(e) => e.target.value && bulk({ podId: e.target.value }, `Pod set to ${pods.find((p) => p.id === e.target.value)?.name}`)}
              >
                <option value="">Choose…</option>
                {pods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 whitespace-nowrap text-ink-2">
              Set editor
              <select
                id="bulk-editor"
                className={selectCls}
                defaultValue=""
                disabled={disabled || meta.editors.length === 0}
                onChange={(e) => e.target.value && bulk({ editorId: e.target.value }, "Editor set")}
              >
                <option value="">{meta.editors.length ? "Choose…" : "Add editors in Settings"}</option>
                {meta.editors.map((ed) => (
                  <option key={ed.id} value={ed.id}>
                    {ed.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="text-accent underline" onClick={() => bulk({ reset: ["pod"] }, "Back to automatic")} disabled={disabled}>
              Back to automatic
            </button>
            <button className="ml-auto text-ink-3 underline" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
            {bulkMsg && <span className="w-full text-xs text-ink-2">{bulkMsg}</span>}
          </div>
        )}

        {error && <Empty>Couldn't load ads: {error.message}</Empty>}
        {data && rows.length === 0 && <Empty>{view === "unassigned" ? "Every ad with spend has a pod." : "No ads match."}</Empty>}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-ink-3">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allChecked}
                      onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.postId)))}
                    />
                  </th>
                  <th className="px-2 py-2 font-medium">Ad</th>
                  <th className="px-2 py-2 text-right font-medium">Spend</th>
                  <th className="px-2 py-2 font-medium">Pod</th>
                  <th className="px-2 py-2 font-medium">Editor</th>
                  {TAGS.map((t) => (
                    <th key={t.key} className="px-2 py-2 font-medium">
                      {t.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const a = r.assignment;
                  const st = status[r.postId];
                  return (
                    <tr key={r.postId} className={selected.has(r.postId) ? "bg-accent-soft/40" : ""}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.name}`}
                          checked={selected.has(r.postId)}
                          onChange={() =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (n.has(r.postId)) n.delete(r.postId);
                              else n.add(r.postId);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="min-w-64 px-2 py-2">
                        <div className="flex items-center gap-2">
                          <Thumb mediaType={r.mediaType} label="" url={r.thumbnailUrl} className="h-11 w-8 shrink-0" />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-ink" title={r.name}>
                              {r.name}
                            </div>
                            <div className="truncate text-xs text-ink-3" title={r.adsetName ?? ""}>
                              {r.adsetName ?? "—"}
                            </div>
                            <div className="text-xs">
                              {st === "saving" && <span className="text-ink-3">Saving…</span>}
                              {st === "saved" && <span className="text-good">✓ Saved</span>}
                              {st && st !== "saving" && st !== "saved" && <span className="text-bad">{st}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="num px-2 py-2 text-right text-ink">{money(r.totals.spendCents, { compact: true })}</td>
                      <td className="px-2 py-2">
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
                      <td className="px-2 py-2">
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
                        <td key={t.key} className="px-2 py-2">
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
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
