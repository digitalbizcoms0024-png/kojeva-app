import { useEffect, useState } from "react";
import type { ConnectionStatus, MetaResponse } from "../../shared/api.ts";
import { useApi } from "../api.ts";
import { Card, PodChip } from "../components/ui.tsx";
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

const btn = "rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${btn} bg-ink text-surface hover:opacity-90`;
const secondary = `${btn} border border-line bg-surface text-ink hover:bg-surface-2`;

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
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
    <details open={props.open} className="rounded-xl border border-line p-4 text-sm">
      <summary className="cursor-pointer font-medium text-ink">{props.title}</summary>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-ink-2">
        <li>
          Open{" "}
          <a className="text-accent underline" href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">
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
        className="num mt-3 w-full rounded-lg border border-line bg-surface p-2 text-xs text-ink focus:outline-2 focus:outline-accent"
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
        <div role="status" className={`rounded-lg px-3 py-2 text-sm ${notice.kind === "good" ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>
          {notice.text}
        </div>
      )}

      {!ready && (
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="text-sm font-medium text-ink">Before connecting</div>
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
                className="rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink"
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
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((progress.done + 0.5) / progress.total) * 100}%` }} />
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

export function SettingsPage({ meta, onSynced }: { meta: MetaResponse; onSynced: () => void }) {
  const t = meta.targets;
  const rows: [string, string][] = [
    ["Target CPA", `$${t.targetCpa}`],
    ["Target ROAS", String(t.targetRoas)],
    ["Testing window", `${t.testWindowDays} days from first spend`],
    ["Minimum test spend", `$${t.minTestSpend}`],
    ["Hit rule", t.hitRule === "both" ? "CPA and ROAS both on target" : "CPA or ROAS on target"],
  ];
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold text-ink">Settings</h1>

      <Card className="p-5">
        <h2 className="font-semibold text-ink">Meta Ads</h2>
        <p className="mb-4 text-xs text-ink-3">
          Read-only (<code>ads_read</code>). Syncs every night and re-pulls the last 7 days, since Meta keeps revising recent results.
          {meta.lastSync && ` Last sync: ${meta.lastSync.source} · ${dateTime(meta.lastSync.finishedAt)} · ${meta.lastSync.status}${meta.lastSync.message ? ` · ${meta.lastSync.message}` : ""}.`}
        </p>
        <MetaPanel onSynced={onSynced} />
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold text-ink">Targets & hit rate</h2>
        <p className="text-xs text-ink-3">Editable in Phase 2.</p>
        <dl className="mt-3 divide-y divide-line text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between py-2">
              <dt className="text-ink-2">{k}</dt>
              <dd className="num text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold text-ink">Pods & agency</h2>
        <p className="text-xs text-ink-3">
          An ad's pod comes from the strategist named in its in-house ad set ("IH | Harris | …"). Ad sets starting with{" "}
          {meta.attribution.agencyPrefixes.join(", ")} are the agency's, and so is anything launched before the pods started
          {meta.attribution.podsStartDate ? ` (${shortDate(meta.attribution.podsStartDate)}${meta.attribution.detected ? ", detected from the first IH ad set" : ""})` : ""}.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {meta.pods.map((p) => (
            <span key={p.id} className="flex items-center gap-2">
              <PodChip podId={p.id} />
              <span className="num text-xs text-ink-3">{p.code}</span>
            </span>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold text-ink">Other data sources</h2>
        <div className="mt-2 divide-y divide-line">
          {[
            ["Triple Whale", "Attributed revenue and blended metrics, shown next to Meta's, never merged.", "Phase 4"],
            ["Atria", "Creative tags and transcripts, pushed nightly by a scheduled Claude task.", "Phase 3"],
          ].map(([name, detail, phase]) => (
            <div key={name} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="font-medium text-ink">{name}</div>
                <div className="text-sm text-ink-3">{detail}</div>
              </div>
              <span className="rounded-full bg-surface-2 px-3 py-1 text-xs text-ink-2">Not connected · {phase}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
