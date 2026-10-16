import { useEffect, useState } from "react";
import type { ConnectionStatus, MetaResponse } from "../../shared/api.ts";
import { useApi } from "../api.ts";
import { HeaderControls } from "../components/HeaderControls.tsx";
import { PageHeader, PodChip, SectionTitle } from "../components/ui.tsx";
import { dateTime, shortDate } from "../format.ts";

function utcDay(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json;
}

const primary = "btn btn-primary";
const secondary = "btn btn-secondary";

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="relative flex gap-2">
      <span aria-hidden className={ok ? "text-good" : "text-bad"}>{ok ? "✓" : "✕"}</span>
      <span className="sr-only">{ok ? "Done:" : "To do:"}</span>
      <span className={ok ? "text-ink-2" : "text-ink"}>{children}</span>
    </li>
  );
}

function TokenForm(props: {
  open: boolean;
  title: string;
  token: string;
  setToken: (t: string) => void;
  disabled: boolean;
  busy: boolean;
  onSubmit: () => void;
}) {
  return (
    <details open={props.open} className="border-2 border-divider p-4 text-sm">
      <summary className="cursor-pointer font-bold text-ink">{props.title}</summary>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-ink-2">
        <li>
          Open{" "}
          <a className="link" href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">
            Graph API Explorer
          </a>
          , pick the app, choose <b>User token</b>, add <code>ads_read</code>, click <b>Generate Access Token</b>.
        </li>
        <li>Copy the token and paste it here within a few minutes. The hub swaps it for a 60-day token and stores it encrypted.</li>
      </ol>
      <textarea
        id="meta-token"
        value={props.token}
        onChange={(e) => props.setToken(e.target.value)}
        rows={3}
        placeholder="EAA…"
        className="field mt-3 w-full font-mono text-xs"
      />
      <button className={`${primary} mt-2`} disabled={props.disabled || props.token.length < 20} onClick={props.onSubmit}>
        {props.busy ? "Connecting…" : "Connect with this token"}
      </button>
    </details>
  );
}

function MetaPanel({ onSynced }: { onSynced: () => void }) {
  const [reload, setReload] = useState(0);
  const { data: s, error } = useApi<ConnectionStatus>(`/api/connection?r=${reload}`);
  const [notice, setNotice] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [days, setDays] = useState(90);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("meta") === "connected") setNotice({ kind: "good", text: "Meta connected. Run a backfill below to load your history." });
    if (p.get("meta_error")) setNotice({ kind: "bad", text: p.get("meta_error")! });
    if (p.has("meta") || p.has("meta_error")) window.history.replaceState(null, "", `/${window.location.hash}`);
  }, []);

  if (error) return <p className="text-sm text-bad">Couldn't load connection status: {error.message}</p>;
  if (!s) return <p className="text-sm text-ink-3">Loading…</p>;

  const ready = s.accessProtected && s.missingSecrets.length === 0;
  const connected = Boolean(s.connection || s.systemToken);
  const expiresIn = s.connection?.expiresAt ? Math.floor((Date.parse(s.connection.expiresAt) - Date.now()) / 86_400_000) : null;

  const connectWithToken = async () => {
    setBusy("token");
    setNotice(null);
    try {
      const r = await post<{ userName: string }>("/api/connection/token", { token });
      setToken("");
      setNotice({ kind: "good", text: `Connected as ${r.userName}. Run a backfill below to load your history.` });
      setReload((n) => n + 1);
    } catch (e) {
      setNotice({ kind: "bad", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  /** Syncs `total` days ending today, in windows the server accepts. */
  const runSync = async (total: number) => {
    setBusy("sync");
    setNotice(null);
    const size = Math.min(14, s.maxWindowDays); // small requests stay inside Worker time limits
    const windows: { since: string; until: string }[] = [];
    for (let end = 0; end > -total; end -= size)
      windows.push({ since: utcDay(Math.max(end - size + 1, -total + 1)), until: utcDay(end) });
    let rows = 0;
    try {
      for (const [i, w] of windows.entries()) {
        setProgress({ done: i, total: windows.length, label: `${shortDate(w.since)} – ${shortDate(w.until)}` });
        const r = await post<{ rows: number; ads?: number }>("/api/sync", { ...w, ads: i === 0 });
        rows += r.rows;
      }
      setNotice({ kind: "good", text: `Synced ${total} days: ${rows.toLocaleString()} ad-day rows.` });
      onSynced();
    } catch (e) {
      setNotice({ kind: "bad", text: `Sync stopped: ${(e as Error).message}` });
    } finally {
      setProgress(null);
      setBusy(null);
      setReload((n) => n + 1);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      await post("/api/connection/disconnect", {});
      setReload((n) => n + 1);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <div role="status" className={`px-3 py-2 text-sm ${notice.kind === "good" ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>
          {notice.kind === "good" ? "✓ " : "✕ "}
          {notice.text}
        </div>
      )}

      {!ready && (
        <div className="border-2 border-divider bg-surface p-4">
          <div className="text-sm font-bold text-ink">Before connecting</div>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            <Check ok={s.accessProtected}>
              Cloudflare Access is on, and its team domain is set as <code>ACCESS_TEAM_DOMAIN</code>
            </Check>
            <Check ok={!s.missingSecrets.includes("META_APP_SECRET")}>
              <code>META_APP_SECRET</code> secret added (Meta app → App settings → Basic)
            </Check>
            <Check ok={!s.missingSecrets.includes("TOKEN_KEY")}>
              <code>TOKEN_KEY</code> secret added (any random text, 32+ characters)
            </Check>
          </ul>
        </div>
      )}

      {connected ? (
        <div className="flex flex-col gap-1 text-sm">
          <div className="text-ink">
            <span className="text-good" aria-hidden>●</span>{" "}
            {s.systemToken ? "Connected with a system-user token (never expires)" : `Connected as ${s.connection?.userName ?? "unknown"}`}
          </div>
          {s.connection && !s.systemToken && (
            <div className="text-ink-3">
              {s.connection.method === "oauth" ? "Facebook login" : "Pasted token"} · connected {dateTime(s.connection.connectedAt)}
              {s.connection.connectedBy && ` by ${s.connection.connectedBy}`} ·{" "}
              {expiresIn == null ? "no expiry reported" : (
                <span className={expiresIn <= 7 ? "font-medium text-bad" : ""}>expires in {expiresIn} days ({shortDate(s.connection.expiresAt)})</span>
              )}
            </div>
          )}
          <div className="text-ink-3">Ad account {s.adAccountId}</div>
        </div>
      ) : (
        <p className="text-sm text-ink-2">Not connected. The app is showing sample data.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {connected && (
          <>
            <button className={primary} disabled={!!busy || !ready} onClick={() => runSync(7)}>
              Sync last 7 days
            </button>
            <span className="flex items-center gap-2">
              <button className={secondary} disabled={!!busy || !ready} onClick={() => runSync(days)}>
                Backfill
              </button>
              <select
                id="backfill-days"
                aria-label="Backfill length"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="field"
              >
                {[90, 180, 365].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </span>
            {s.connection && (
              <button className={`${secondary} text-bad`} disabled={!!busy} onClick={disconnect}>
                Disconnect
              </button>
            )}
          </>
        )}
      </div>

      {progress && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-ink-3">
            <span>Syncing {progress.label}…</span>
            <span className="num">
              {progress.done + 1}/{progress.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden bg-surface-2">
            <div className="h-full bg-accent transition-all" style={{ width: `${((progress.done + 0.5) / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {/* The Meta app's Marketing API use case doesn't include Facebook Login, so the OAuth
          redirect is refused ("Can't load URL"). Pasting a token is the supported way in. */}
      <TokenForm
        open={!connected}
        title={connected ? "Renew the connection" : "Connect with a token"}
        token={token}
        setToken={setToken}
        disabled={!ready || !!busy}
        busy={busy === "token"}
        onSubmit={connectWithToken}
      />
    </div>
  );
}

const field = "field";

function useSave(onSaved: () => void) {
  const [state, setState] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({ busy: false, msg: null, ok: true });
  const run = async (path: string, method: string, body: unknown, done: string) => {
    setState({ busy: true, msg: null, ok: true });
    try {
      const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setState({ busy: false, msg: done, ok: true });
      onSaved();
      return json;
    } catch (e) {
      setState({ busy: false, msg: (e as Error).message, ok: false });
      return null;
    }
  };
  const note = state.msg && (
    <span role="status" className={`text-sm ${state.ok ? "text-good" : "text-bad"}`}>
      {state.ok ? "✓ " : ""}
      {state.msg}
    </span>
  );
  return { busy: state.busy, run, note };
}

function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-ink-2">
      {label}
      {children}
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

function TargetsCard({ meta, onSaved }: { meta: MetaResponse; onSaved: () => void }) {
  const t = meta.targets;
  const [cpa, setCpa] = useState(String(t.targetCpa));
  const [amber, setAmber] = useState(t.cpaWarnMax == null ? "" : String(t.cpaWarnMax));
  const [roasT, setRoasT] = useState(String(t.targetRoas));
  const [days, setDays] = useState(String(t.testWindowDays));
  const [min, setMin] = useState(String(t.minTestSpend));
  const [rule, setRule] = useState(t.hitRule);
  const { busy, run, note } = useSave(onSaved);
  const amberShown = amber ? Number(amber) : Number(cpa) * 1.25;
  const save = () =>
    run(
      "/api/settings",
      "PUT",
      {
        targets: {
          targetCpa: Number(cpa),
          cpaWarnMax: amber ? Number(amber) : null,
          targetRoas: Number(roasT),
          testWindowDays: Number(days),
          minTestSpend: Number(min),
          hitRule: rule,
        },
      },
      "Saved. Hit rates use the new targets.",
    );
  return (
    <section>
      <SectionTitle title="Targets" />
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Labeled label="Target CPA ($)">
          <input id="t-cpa" type="number" min="0.01" step="0.01" value={cpa} onChange={(e) => setCpa(e.target.value)} className={field} disabled={!meta.canEdit} />
        </Labeled>
        <Labeled label="Amber up to ($)" hint="Empty: 25% over target">
          <input
            id="t-amber"
            type="number"
            min="0.01"
            step="0.5"
            value={amber}
            placeholder={(Number(cpa) * 1.25).toFixed(2)}
            onChange={(e) => setAmber(e.target.value)}
            className={field}
            disabled={!meta.canEdit}
          />
        </Labeled>
        <Labeled label="Target ROAS">
          <input id="t-roas" type="number" min="0.01" step="0.05" value={roasT} onChange={(e) => setRoasT(e.target.value)} className={field} disabled={!meta.canEdit} />
        </Labeled>
        <Labeled label="Testing window (days)">
          <input id="t-days" type="number" min="1" max="30" step="1" value={days} onChange={(e) => setDays(e.target.value)} className={field} disabled={!meta.canEdit} />
        </Labeled>
        <Labeled label="Qualifies at ($ on one ad)">
          <input id="t-min" type="number" min="0" step="10" value={min} onChange={(e) => setMin(e.target.value)} className={field} disabled={!meta.canEdit} />
        </Labeled>
        <Labeled label="A hit needs">
          <select id="t-rule" value={rule} onChange={(e) => setRule(e.target.value as typeof rule)} className={field} disabled={!meta.canEdit}>
            <option value="both">CPA and ROAS</option>
            <option value="either">CPA or ROAS</option>
          </select>
        </Labeled>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 bg-good" aria-hidden /> ✓ CPA ≤ ${Number(cpa).toFixed(2)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 bg-warn-line" aria-hidden /> ! ${Number(cpa).toFixed(2)} – ${amberShown.toFixed(2)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 bg-bad" aria-hidden /> ✕ Above ${amberShown.toFixed(2)}
        </span>
        <span className="text-ink-3">
          A concept qualifies once one ad has spent ${min}, and is judged from first spend to day {days} or the day it qualified, whichever is later.
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className={primary} disabled={busy || !meta.canEdit} onClick={save}>
          {busy ? "Saving…" : "Save targets"}
        </button>
        {note}
      </div>
    </section>
  );
}

function AttributionCard({ meta, onSaved }: { meta: MetaResponse; onSaved: () => void }) {
  const a = meta.attribution;
  const [codes, setCodes] = useState(a.agencyPrefixes.join(", "));
  const [start, setStart] = useState(a.detected ? "" : (a.podsStartDate?.slice(0, 10) ?? ""));
  const { busy, run, note } = useSave(onSaved);
  const save = () =>
    run(
      "/api/settings",
      "PUT",
      {
        attribution: {
          agencyPrefixes: codes.split(/[\s,]+/).filter(Boolean),
          podsStartDate: start || null,
        },
      },
      "Saved. Every ad has been re-credited.",
    );
  return (
    <section>
      <SectionTitle title="Pods & agency" />
      <p className="max-w-[70ch] text-xs text-ink-3">
        An ad's pod comes from the strategist named in its ad set ("IH | Harris | …", "Shameer | Static 3 | …"). Ad sets starting with an agency
        code are the agency's, and so is anything launched before the pods started. Ads you tag by hand keep their pod.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {meta.pods.map((p) => (
          <span key={p.id} className="flex items-center gap-2">
            <PodChip podId={p.id} />
            <span className="num text-xs text-ink-3">{p.code}</span>
          </span>
        ))}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Labeled label="Agency ad set codes" hint="First part of the ad set name, comma separated.">
          <input id="a-codes" value={codes} onChange={(e) => setCodes(e.target.value)} className={field} disabled={!meta.canEdit} />
        </Labeled>
        <Labeled
          label="Pods started on"
          hint={a.detected ? `Leave empty to detect it (currently ${shortDate(a.podsStartDate)}, from the first strategist ad set).` : "Clear it to detect from the first strategist ad set."}
        >
          <input id="a-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className={field} disabled={!meta.canEdit} />
        </Labeled>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className={primary} disabled={busy || !meta.canEdit} onClick={save}>
          {busy ? "Re-crediting…" : "Save and re-credit"}
        </button>
        {note}
      </div>
    </section>
  );
}

function PodRosterCard({ meta, podId, onSaved }: { meta: MetaResponse; podId: string; onSaved: () => void }) {
  const [name, setName] = useState("");
  const { busy, run, note } = useSave(onSaved);
  const pod = meta.pods.find((p) => p.id === podId)!;
  const list = meta.editors.filter((e) => e.podId === podId);
  const add = async () => {
    if (await run("/api/editors", "POST", { name: name.trim(), podId }, `Added ${name.trim()}.`)) setName("");
  };
  return (
    <div className="flex flex-col gap-3 bg-surface p-4" style={{ borderTop: `4px solid var(--pod-${podId})` }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-extrabold text-ink">{pod.name} pod</span>
        <span className="bg-page px-1.5 py-px text-[11px] font-semibold text-ink-2">{pod.code}</span>
      </div>
      <div className="text-sm text-ink-2">
        Strategist: <b className="text-ink">{pod.name}</b>
      </div>
      <div>
        <div className="mb-1 text-sm text-ink-2">Editors</div>
        <div className="flex flex-wrap gap-1.5">
          {list.length === 0 && <span className="text-sm text-ink-3">No editors yet</span>}
          {list.map((e) => (
            <span key={e.id} className="inline-flex items-center gap-1 border border-divider bg-page px-2 py-0.5 text-sm text-ink">
              {e.name}
              <button
                aria-label={`Remove ${e.name}`}
                className="text-ink-3 hover:text-bad"
                disabled={!meta.canEdit || busy}
                onClick={() => run(`/api/editors/${e.id}`, "DELETE", {}, `Removed ${e.name}.`)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void add();
        }}
      >
        <input
          aria-label={`Add editor to ${pod.name}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add editor"
          className={`${field} min-w-0 flex-1 bg-page`}
          disabled={!meta.canEdit}
        />
        <button className={secondary} disabled={!name.trim() || busy || !meta.canEdit}>
          Add
        </button>
      </form>
      {note}
    </div>
  );
}

export function SettingsPage({ meta, onSynced }: { meta: MetaResponse; onSynced: () => void }) {
  return (
    <div>
      <PageHeader title="Settings" subtitle="Targets, pod roster and data sources">
        <HeaderControls meta={meta} />
      </PageHeader>
      <div className="flex flex-col gap-10 px-4 py-6 md:px-8">
        <TargetsCard meta={meta} onSaved={onSynced} />

        <section>
          <SectionTitle title="Pod roster" right="Editors aren't in Meta: add them here, then assign them to ads in Needs Tagging." />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {meta.pods
              .filter((p) => p.kind === "pod")
              .map((p) => (
                <PodRosterCard key={p.id} meta={meta} podId={p.id} onSaved={onSynced} />
              ))}
          </div>
        </section>

        <AttributionCard meta={meta} onSaved={onSynced} />

        <section>
          <SectionTitle title="Data sources" />
          <div className="border-b border-divider pb-5">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-extrabold text-ink">Meta Ads</h3>
              {meta.lastSync && (
                <span className="inline-flex items-center gap-2 text-sm text-ink-2">
                  <span className={`size-2 ${meta.lastSync.status === "error" ? "bg-bad" : "bg-good"}`} aria-hidden />
                  {meta.lastSync.status === "error" ? "✕ Last sync failed" : "✓ Last sync ok"} · {dateTime(meta.lastSync.finishedAt)}
                </span>
              )}
            </div>
            <p className="mb-4 text-sm text-ink-3">
              Spend, purchases, ROAS (Meta) and creatives. Read-only (<code>ads_read</code>). Syncs every night and re-pulls the last 7 days, since Meta keeps
              revising recent results.
              {meta.lastSync?.message && ` Last message: ${meta.lastSync.message}.`}
            </p>
            <MetaPanel onSynced={onSynced} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider py-4">
            <div>
              <h3 className="text-lg font-extrabold text-ink">Atria tags</h3>
              <p className="text-sm text-ink-3">Theme, core desire and other creative tags, pushed nightly by a scheduled Claude task.</p>
            </div>
            <span className="text-sm text-ink-2">Synced nightly</span>
          </div>
        </section>
      </div>
    </div>
  );
}
