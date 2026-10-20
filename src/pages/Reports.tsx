import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { MetaResponse, ReportResponse, ReportsListResponse } from "../../shared/api.ts";
import { useApi } from "../api.ts";
import { Empty, Icon, PageHeader, Select } from "../components/ui.tsx";
import { dateTime, shortDate } from "../format.ts";
import { parseText, reportBlocks, toHtml, toMrkdwn, type Block, type Inline } from "../report.ts";

function Inl({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <b key={i} className="font-bold text-ink">
            {p.b}
          </b>
        ),
      )}
    </>
  );
}

function BlockView({ b }: { b: Block }): ReactNode {
  if (b.kind === "h") return <h2 className="mt-4 text-lg font-extrabold text-ink first:mt-0">{b.text}</h2>;
  if (b.kind === "p")
    return (
      <p className="text-ink-2">
        <Inl parts={b.parts} />
      </p>
    );
  if (b.kind === "ul")
    return (
      <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
        {b.items.map((it, i) => (
          <li key={i}>
            <Inl parts={it} />
          </li>
        ))}
      </ul>
    );
  return (
    <div className="flex flex-col gap-2">
      {parseText(b.text).map((x, i) => (
        <BlockView key={i} b={x} />
      ))}
    </div>
  );
}

/** Learnings and read: Claude's draft until someone edits it here; then drafts never replace it. */
function TextEditor({ from, initial, onSaved }: { from: string; initial: { learnings: string; read: string }; onSaved: () => void }) {
  const [learnings, setLearnings] = useState(initial.learnings);
  const [read, setRead] = useState(initial.read);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/reports/${from}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ learnings, read }) });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setMsg({ ok: true, text: "Saved." });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-3">One point per line starting with “* ”; wrap words in **double stars** for bold.</p>
      <label className="flex flex-col gap-1 text-sm text-ink-2">
        Learnings
        <textarea value={learnings} onChange={(e) => setLearnings(e.target.value)} rows={12} className="field font-mono text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-2">
        My read
        <textarea value={read} onChange={(e) => setRead(e.target.value)} rows={8} className="field font-mono text-sm" />
      </label>
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.ok ? "✓ " : ""}{msg.text}</span>}
      </div>
    </div>
  );
}

export function ReportsPage({ meta }: { meta: MetaResponse }) {
  const { data: list, error: listError } = useApi<ReportsListResponse>("/api/reports");
  const periods = list?.periods ?? [];
  // Default: the latest closed period.
  const [from, setFrom] = useState<string | null>(null);
  useEffect(() => {
    if (!from && periods.length) setFrom((periods.find((p) => p.closed) ?? periods[0])!.from);
  }, [from, periods]);
  const [reload, setReload] = useState(0);
  const { data, error } = useApi<ReportResponse>(from ? `/api/reports/${from}${reload ? `?r=${reload}` : ""}` : null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const names = new Map(meta.pods.map((p) => [p.id, p.name]));
  const blocks = data ? reportBlocks(data.data, data.text, names) : [];
  const current = periods.find((p) => p.from === from);

  const copy = async () => {
    const html = toHtml(blocks);
    const text = toMrkdwn(blocks);
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      setCopied("Copied. Paste it into Slack.");
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setCopied("Copied as text. Paste it into Slack.");
      } catch {
        setCopied("Couldn't reach the clipboard in this browser.");
      }
    }
    setTimeout(() => setCopied(null), 4000);
  };

  return (
    <div>
      <PageHeader title="CS Reports" subtitle="The fortnightly creative strategist report: numbers from the hub, learnings drafted by Claude and edited by the team" />
      <div className="flex flex-col gap-6 px-4 py-6 md:px-8">
        {listError && <Empty>Couldn't load reports: {listError.message}</Empty>}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Select
            label="Period"
            value={from ?? ""}
            onChange={(v) => {
              setFrom(v);
              setEditing(false);
            }}
            options={periods.map((p) => ({
              value: p.from,
              label: `Report ${p.n} · ${shortDate(p.from)} – ${shortDate(p.to)}${p.closed ? "" : " (in progress)"}`,
            }))}
          />
          <div className="flex flex-wrap items-center gap-3">
            {copied && <span className="text-sm text-ink-2">{copied}</span>}
            {meta.canEdit && data && (
              <button className="btn btn-secondary" onClick={() => setEditing((e) => !e)}>
                {editing ? "Close editor" : "Edit learnings & read"}
              </button>
            )}
            <button className="btn btn-primary inline-flex items-center gap-2" disabled={!data} onClick={() => void copy()}>
              <Icon name="copy" size={16} /> Copy for Slack
            </button>
          </div>
        </div>
        {current && !current.closed && (
          <p className="bg-warn-soft px-3 py-2 text-sm text-ink">This period isn't over yet: the numbers will still change, and Claude drafts the learnings after it closes.</p>
        )}
        {data?.text && (
          <p className="text-xs text-ink-3">
            {data.text.source === "claude" ? "Learnings and read drafted by Claude" : `Learnings and read edited by ${data.text.updatedBy ?? "the team"}`} ·{" "}
            {dateTime(data.text.updatedAt)}
          </p>
        )}
        {error && <Empty>Couldn't load this report: {error.message}</Empty>}
        {data && editing && (
          <TextEditor
            key={`${from}:${data.text?.updatedAt ?? ""}`}
            from={from!}
            initial={{ learnings: data.text?.learnings ?? "", read: data.text?.read ?? "" }}
            onSaved={() => {
              setReload((n) => n + 1);
              setEditing(false);
            }}
          />
        )}
        {data && (
          <article className="flex max-w-[90ch] flex-col gap-2 border-2 border-divider bg-page px-5 py-5 text-[15px] leading-relaxed">
            {blocks.map((b, i) => (
              <BlockView key={i} b={b} />
            ))}
          </article>
        )}
      </div>
    </div>
  );
}
