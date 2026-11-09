import { useEffect, useState } from "react";
import { FREE_TAGS, TAG_LABELS, TAG_OPTIONS, type CreativeAnalysis, type CreativeTags, type TagKey } from "../../shared/analysis.ts";
import { apiFetch, noBodyMessage, useApi } from "../api.ts";
import { dateTime } from "../format.ts";

type Resp = { enabled: boolean; analysis: CreativeAnalysis | null };

/**
 * Gemini's analysis of an ad (owner, Nov 9): tags from fixed lists and a readout, beside Atria's tags.
 * Editors run or re-run it and correct tags; a hand edit always wins.
 */
export function CreativeAnalysisPanel({ postId, canEdit }: { postId: string; canEdit: boolean }) {
  const path = `/api/posts/${encodeURIComponent(postId)}/analysis`;
  const { data, error } = useApi<Resp>(path);
  const [state, setState] = useState<Resp | null>(null);
  const [busy, setBusy] = useState<"analyze" | "save" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<CreativeTags | null>(null);
  useEffect(() => {
    setState(data);
    setEditing(null);
    setProblem(null);
  }, [data, postId]);

  const send = async (method: "POST" | "PATCH", url: string, body?: object) => {
    setProblem(null);
    try {
      const r = await apiFetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const j = (await r.json().catch(() => ({}))) as Resp & { error?: string };
      if (!r.ok) throw new Error(j.error || noBodyMessage(r));
      setState(j);
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  const analyze = async () => {
    setBusy("analyze");
    await send("POST", `/api/posts/${encodeURIComponent(postId)}/analyze`);
    setBusy(null);
  };
  const save = async () => {
    if (!editing || !a) return;
    setBusy("save");
    // Send only what changed; an emptied field clears the hand edit.
    const changes: Record<string, string | null> = {};
    for (const [k] of TAG_LABELS) if ((editing[k] ?? "") !== (a.tags[k] ?? "")) changes[k] = editing[k] || null;
    if (Object.keys(changes).length === 0 || (await send("PATCH", path, { tags: changes }))) setEditing(null);
    setBusy(null);
  };

  if (error) return <p className="text-sm text-ink-3">Couldn't load the Gemini analysis: {error.message}</p>;
  if (!state) return <p className="text-sm text-ink-3">Loading the Gemini analysis…</p>;
  const a = state.analysis;
  const r = a?.readout ?? null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-extrabold text-ink">Gemini analysis</h3>
        <div className="flex flex-wrap items-center gap-2">
          {a?.status === "analyzed" && (
            <span className="border border-divider px-1.5 py-px text-xs text-ink-2">
              Gemini {a.media === "video" ? "watched the video" : "looked at the image"} · {dateTime(a.analyzedAt)}
            </span>
          )}
          {canEdit && state.enabled && a?.status === "analyzed" && !editing && (
            <button type="button" className="btn btn-secondary py-1 text-sm" onClick={() => setEditing({ ...a.tags })}>
              Edit tags
            </button>
          )}
          {canEdit && state.enabled && (
            <button type="button" className="btn btn-secondary py-1 text-sm" disabled={busy != null} onClick={analyze}>
              {busy === "analyze" ? "Gemini is watching… (up to 2 min)" : a?.status === "analyzed" ? "Re-analyze" : "Analyze with Gemini"}
            </button>
          )}
        </div>
      </div>
      {problem && <p className="bg-bad-soft px-3 py-2 text-sm text-ink">✕ {problem}</p>}
      {!state.enabled && !a && (
        <p className="text-sm text-ink-3">Gemini isn't set up yet: add a GEMINI_API_KEY secret in Cloudflare (steps in docs/ATRIA.md → Gemini).</p>
      )}
      {state.enabled && !a && <p className="text-sm text-ink-3">Not analyzed yet. New ads are analyzed overnight once they've spent $50{canEdit ? ", or press Analyze" : ""}.</p>}
      {a?.status === "no_media" && <p className="text-sm text-ink-3">! Can't analyze: {a.error}</p>}
      {a?.status === "failed" && a.error && <p className="text-sm text-ink-3">✕ The last try failed: {a.error}</p>}

      {a && (Object.keys(a.tags).length > 0 || editing) && (
        <div className="grid grid-cols-2 gap-px border border-divider bg-divider sm:grid-cols-3">
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
          <button type="button" className="btn btn-primary py-1 text-sm" disabled={busy != null} onClick={save}>
            {busy === "save" ? "Saving…" : "Save tags"}
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
    return <input id={id} value={value} maxLength={80} onChange={(e) => onChange(e.target.value)} className={cls} />;
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
