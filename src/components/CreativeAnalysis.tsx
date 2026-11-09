import { useEffect, useState } from "react";
import { FREE_TAGS, TAG_LABELS, TAG_OPTIONS, type CreativeAnalysis, type CreativeTags, type TagKey } from "../../shared/analysis.ts";
import { apiFetch, noBodyMessage, useApi } from "../api.ts";
import { dateTime } from "../format.ts";

export type AnalysisResp = { enabled: boolean; analysis: CreativeAnalysis | null };

/** Runs one post's analysis; throws with the hub's message if it fails. */
export async function runAnalysis(postId: string): Promise<AnalysisResp> {
  const r = await apiFetch(`/api/posts/${encodeURIComponent(postId)}/analyze`, { method: "POST" });
  const j = (await r.json().catch(() => ({}))) as AnalysisResp & { error?: string };
  if (!r.ok) throw new Error(j.error || noBodyMessage(r));
  return j;
}

/**
 * One post's Gemini analysis and its actions, so a card can put the Analyze button at the top and the
 * analysis in a tab (owner, Nov 9).
 */
export function useCreativeAnalysis(postId: string) {
  const path = `/api/posts/${encodeURIComponent(postId)}/analysis`;
  const { data, error } = useApi<AnalysisResp>(path);
  const [state, setState] = useState<AnalysisResp | null>(null);
  const [busy, setBusy] = useState<"analyze" | "save" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setState(data);
    setProblem(null);
  }, [data, postId]);

  const analyze = async () => {
    setBusy("analyze");
    setProblem(null);
    try {
      setState(await runAnalysis(postId));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };
  const saveTags = async (changes: Record<string, string | null>) => {
    setBusy("save");
    setProblem(null);
    try {
      const r = await apiFetch(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ tags: changes }) });
      const j = (await r.json().catch(() => ({}))) as AnalysisResp & { error?: string };
      if (!r.ok) throw new Error(j.error || noBodyMessage(r));
      setState(j);
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { state, error, busy, problem, analyze, saveTags };
}

export type CreativeAnalysisHook = ReturnType<typeof useCreativeAnalysis>;

/** The Analyze / Re-analyze button for the top of an ad card (editors, once Gemini is set up). */
export function AnalyzeButton({ ga, canEdit, onStart }: { ga: CreativeAnalysisHook; canEdit: boolean; onStart?: () => void }) {
  if (!canEdit || !ga.state?.enabled) return null;
  const done = ga.state.analysis?.status === "analyzed";
  return (
    <button
      type="button"
      className="btn btn-secondary py-1 text-sm"
      disabled={ga.busy != null}
      onClick={() => {
        onStart?.();
        void ga.analyze();
      }}
    >
      {ga.busy === "analyze" ? "Gemini is watching… (up to 2 min)" : done ? "Re-analyze with Gemini" : "Analyze with Gemini"}
    </button>
  );
}

/** Performance / Gemini analysis tabs for an ad card. */
export function CardTabs({ tab, setTab, ga }: { tab: "perf" | "gemini"; setTab: (t: "perf" | "gemini") => void; ga: CreativeAnalysisHook }) {
  const done = ga.state?.analysis?.status === "analyzed";
  const opts: { value: "perf" | "gemini"; label: string }[] = [
    { value: "perf", label: "Performance" },
    { value: "gemini", label: done ? "Gemini analysis" : "Gemini analysis · not yet" },
  ];
  return (
    <div role="tablist" className="flex gap-4 border-b-2 border-divider">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={tab === o.value}
          onClick={() => setTab(o.value)}
          className={`-mb-0.5 border-b-2 pb-1.5 text-sm font-semibold ${tab === o.value ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Gemini's analysis of an ad (owner, Nov 9): tags from fixed lists and a readout, beside Atria's tags.
 * Editors correct tags here; a hand edit always wins. The Analyze button sits at the top of the card.
 */
export function CreativeAnalysisPanel({ ga, canEdit }: { ga: CreativeAnalysisHook; canEdit: boolean }) {
  const [editing, setEditing] = useState<CreativeTags | null>(null);
  const a = ga.state?.analysis ?? null;
  useEffect(() => setEditing(null), [a?.assetId, a?.analyzedAt]);

  if (ga.error) return <p className="text-sm text-ink-3">Couldn't load the Gemini analysis: {ga.error.message}</p>;
  if (!ga.state) return <p className="text-sm text-ink-3">Loading the Gemini analysis…</p>;
  const r = a?.readout ?? null;
  const save = async () => {
    if (!editing || !a) return;
    // Send only what changed; an emptied field clears the hand edit.
    const changes: Record<string, string | null> = {};
    for (const [k] of TAG_LABELS) if ((editing[k] ?? "") !== (a.tags[k] ?? "")) changes[k] = editing[k] || null;
    if (Object.keys(changes).length === 0 || (await ga.saveTags(changes))) setEditing(null);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {a?.status === "analyzed" ? (
          <span className="text-xs text-ink-3">
            Gemini {a.media === "video" ? "watched the video" : "looked at the image"} · {dateTime(a.analyzedAt)}
          </span>
        ) : (
          <span />
        )}
        {canEdit && ga.state.enabled && a?.status === "analyzed" && !editing && (
          <button type="button" className="btn btn-secondary py-1 text-sm" onClick={() => setEditing({ ...a.tags })}>
            Edit tags
          </button>
        )}
      </div>
      {ga.busy === "analyze" && <p className="text-sm text-ink-2">Gemini is watching the ad. A video can take up to 2 minutes; keep this card open.</p>}
      {ga.problem && <p className="bg-bad-soft px-3 py-2 text-sm text-ink">✕ {ga.problem}</p>}
      {!ga.state.enabled && !a && (
        <p className="text-sm text-ink-3">Gemini isn't set up yet: add a GEMINI_API_KEY secret in Cloudflare (steps in docs/ATRIA.md → Gemini).</p>
      )}
      {ga.state.enabled && !a && ga.busy !== "analyze" && (
        <p className="text-sm text-ink-3">Not analyzed yet. New ads are analyzed overnight once they've spent $50{canEdit ? ", or press Analyze with Gemini above" : ""}.</p>
      )}
      {a?.status === "no_media" && <p className="text-sm text-ink-3">! Can't analyze: {a.error}</p>}
      {a?.status === "failed" && a.error && <p className="text-sm text-ink-3">✕ The last try failed: {a.error}</p>}

      {a && (Object.keys(a.tags).length > 0 || editing) && (
        <div className="grid grid-cols-2 gap-px border border-divider bg-divider sm:grid-cols-3 sm:[&>*:last-child]:col-span-3">
          {TAG_LABELS.map(([key, label]) => (
            <div key={key} className="bg-page px-3 py-2">
              <div className="kicker text-[10px]">
                {label}
                {a.manual.includes(key) && <span title="Set by hand"> · edited</span>}
              </div>
              {editing ? (
                <TagInput id={`tag-${key}`} k={key} value={editing[key] ?? ""} onChange={(v) => setEditing({ ...editing, [key]: v })} />
              ) : (
                <div className="text-sm text-ink">{a.tags[key] ?? "—"}</div>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && (
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary py-1 text-sm" disabled={ga.busy != null} onClick={save}>
            {ga.busy === "save" ? "Saving…" : "Save tags"}
          </button>
          <button type="button" className="btn btn-ghost py-1 text-sm" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </div>
      )}

      {r && (
        <div className="flex flex-col gap-3 text-sm">
          {r.awarenessNote && a?.tags.awarenessLevel && (
            <div className="border border-divider px-3 py-2">
              <div className="kicker text-[10px]">Written for someone {a.tags.awarenessLevel.toLowerCase()}</div>
              <p className="text-ink">{r.awarenessNote}</p>
            </div>
          )}
          {r.summary && <p className="text-ink">{r.summary}</p>}
          {r.hook && <Quote label="Hook">{r.hook}</Quote>}
          {r.primaryMessage && <Quote label="Primary message">{r.primaryMessage}</Quote>}
          {r.observations.length > 0 && <List label="What Gemini saw" items={r.observations} />}
          {r.proof && <Quote label="Spoken or on-screen proof">{r.proof}</Quote>}
          {r.ideas.length > 0 && <List label="Iteration ideas" items={r.ideas} />}
          {r.transcript && (
            <details>
              <summary className="cursor-pointer text-ink-2">Transcript</summary>
              <p className="mt-1 whitespace-pre-wrap text-ink-2">{r.transcript}</p>
            </details>
          )}
          <p className="text-xs text-ink-3">By {a?.model ?? "Gemini"}. AI-written: check before relying on it. Runs alongside Atria's tags.</p>
        </div>
      )}
    </section>
  );
}

function TagInput({ id, k, value, onChange }: { id: string; k: TagKey; value: string; onChange: (v: string) => void }) {
  const cls = "w-full border border-divider bg-page px-1.5 py-1 text-sm text-ink";
  if ((FREE_TAGS as readonly string[]).includes(k))
    return <input id={id} value={value} maxLength={120} onChange={(e) => onChange(e.target.value)} className={cls} />;
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
      <option value="">—</option>
      {(TAG_OPTIONS as Record<string, readonly string[]>)[k]!.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Quote({ label, children }: { label: string; children: string }) {
  return (
    <div className="bg-surface px-3 py-2">
      <div className="kicker text-[10px]">{label}</div>
      <p className="text-ink">{children}</p>
    </div>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="font-semibold text-ink">{label}</div>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-ink-2">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Ad Rankings → Analyze top 10 (owner, Nov 9): the first 10 ads in the order shown whose creative has no
 * analysis yet (or whose last try failed), one after another. Runs in this tab: keep it open.
 */
export function AnalyzeTopButton({ postIds, canEdit, count = 10 }: { postIds: string[]; canEdit: boolean; count?: number }) {
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  if (!canEdit) return null;
  const run = async () => {
    setRunning(true);
    setStatus("Finding ads to analyze…");
    try {
      const r = await apiFetch(`/api/analysis/pending?posts=${encodeURIComponent(postIds.slice(0, 100).join(","))}`);
      const j = (await r.json().catch(() => ({}))) as { enabled?: boolean; pending?: string[]; error?: string };
      if (!r.ok) throw new Error(j.error || noBodyMessage(r));
      if (!j.enabled) throw new Error("Gemini isn't set up: add the GEMINI_API_KEY secret in Cloudflare.");
      const queue = (j.pending ?? []).slice(0, count);
      if (queue.length === 0) {
        setStatus("✓ The top ads here are all analyzed");
        return;
      }
      let ok = 0;
      let failed = 0;
      for (const [i, id] of queue.entries()) {
        setStatus(`Gemini: ${i + 1} of ${queue.length}… keep this tab open`);
        try {
          const res = await runAnalysis(id);
          if (res.analysis?.status === "analyzed") ok++;
          else failed++;
        } catch {
          failed++;
        }
      }
      setStatus(`✓ Analyzed ${ok} of ${queue.length}${failed ? ` · ${failed} couldn't be (open the ad to see why)` : ""}`);
    } catch (e) {
      setStatus(`✕ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-secondary" disabled={running || postIds.length === 0} onClick={run} title={`Analyze the first ${count} ads shown that Gemini hasn't analyzed yet`}>
        {running ? "Analyzing…" : `Analyze top ${count} with Gemini`}
      </button>
      {status && <span className="text-xs text-ink-2">{status}</span>}
    </span>
  );
}
