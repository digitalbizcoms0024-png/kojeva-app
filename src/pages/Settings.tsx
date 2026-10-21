import { useEffect, useState } from "react";
import type { ConnectionStatus, MetaResponse, Persona } from "../../shared/api.ts";
import { useApi } from "../api.ts";
import { HeaderControls } from "../components/HeaderControls.tsx";
import { PageHeader, PodChip, SectionTitle, ViewOnlyNote, Tabs } from "../components/ui.tsx";
import { POD_SLOTS } from "../../shared/taxonomy.ts";
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
      <span aria-hidden className={ok ? "text-good" : "text-bad"}>
        {ok ? "✓" : "✕"}
      </span>
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

function MetaPanel({ onSynced, canEdit }: { onSynced: () => void; canEdit: boolean }) {
  const [reload, setReload] = useState(0);
  const { data: s, error } = useApi<ConnectionStatus>(`/api/connection?r=${reload}`);
  const [notice, setNotice] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  // Recomputes the stored summaries (concept results, test windows, totals) from the daily data.
  const rebuild = async () => {
    setBusy("rebuild");
    try {
      await post("/api/stats/rebuild", {});
      setNotice({ kind: "good", text: "Summaries will be rebuilt from the daily data on the next page you open." });
      onSynced();
    } catch (e) {
      setNotice({ kind: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const [days, setDays] = useState(90);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("meta") === "connected") setNotice({ kind: "good", text: "Meta connected. Run a backfill below to load your history." });
    if (p.get("meta_error")) setNotice({ kind: "bad", text: p.get("meta_error")! });
    if (p.has("meta") || p.has("meta_error")) window.history.replaceState(null, "", `/${window.location.hash}`);
  }, []);

  if (error) return <p className="text-sm text-bad">Couldn't load connection status: {error.message}</p>;
  if (!s) return <p className="text-sm text-ink-3">Loading…</p>;

  const ready = canEdit && s.accessProtected && s.missingSecrets.length === 0;
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
    for (let end = 0; end > -total; end -= size) windows.push({ since: utcDay(Math.max(end - size + 1, -total + 1)), until: utcDay(end) });
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
            <span className="text-good" aria-hidden>
              ●
            </span>{" "}
            {s.systemToken
              ? "Connected with a system-user token (never expires)"
              : s.connection?.userName
                ? `Connected as ${s.connection.userName}`
                : "Connected to Meta"}
          </div>
          {s.connection && !s.systemToken && (
            <div className="text-ink-3">
              {s.connection.method === "oauth" ? "Facebook login" : "Pasted token"} · connected {dateTime(s.connection.connectedAt)}
              {s.connection.connectedBy && ` by ${s.connection.connectedBy}`} ·{" "}
              {expiresIn == null ? (
                "no expiry reported"
              ) : (
                <span className={expiresIn <= 7 ? "font-medium text-bad" : ""}>
                  expires in {expiresIn} days ({shortDate(s.connection.expiresAt)})
                </span>
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
              <select id="backfill-days" aria-label="Backfill length" value={days} onChange={(e) => setDays(Number(e.target.value))} className="field">
                {[90, 180, 365].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </span>
            <button
              className={secondary}
              disabled={!!busy || !canEdit}
              onClick={rebuild}
              title="Recompute hit results and totals from the stored daily data. Only needed if numbers look out of date; it reads about as much as a sync."
            >
              Rebuild summaries
            </button>
            {s.connection && (
              <button className={`${secondary} text-bad`} disabled={!!busy || !canEdit} onClick={disconnect}>
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
  const [late, setLate] = useState(String(t.lateWindowDays));
  const [wRoas, setWRoas] = useState(String(t.winnerMinRoas));
  const [wSpend, setWSpend] = useState(String(t.winnerMinSpend));
  const [wDays, setWDays] = useState(String(t.winnerMinDays));
  const [swSpend, setSwSpend] = useState(String(t.superWinnerMinSpend));
  const buyer = meta.isMediaBuyer;
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
          lateWindowDays: Number(late),
          // Only the media buyer sets these (the server refuses them from anyone else).
          ...(buyer
            ? { winnerMinRoas: Number(wRoas), winnerMinSpend: Number(wSpend), winnerMinDays: Number(wDays), superWinnerMinSpend: Number(swSpend) }
            : {}),
        },
      },
      "Saved. Hit rates use the new targets.",
    );
  return (
    <section>
      <SectionTitle title="Targets" />
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-7">
        <Labeled label="Target CPA ($)">
          <input
            id="t-cpa"
            type="number"
            min="0.01"
            step="0.01"
            value={cpa}
            onChange={(e) => setCpa(e.target.value)}
            className={field}
            disabled={!meta.canEdit}
          />
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
          <input
            id="t-roas"
            type="number"
            min="0.01"
            step="0.05"
            value={roasT}
            onChange={(e) => setRoasT(e.target.value)}
            className={field}
            disabled={!meta.canEdit}
          />
        </Labeled>
        <Labeled label="Testing window (days)">
          <input
            id="t-days"
            type="number"
            min="1"
            max="30"
            step="1"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className={field}
            disabled={!meta.canEdit}
          />
        </Labeled>
        <Labeled label="Late-hit window (days)" hint="0 turns late hits off">
          <input
            id="t-late"
            type="number"
            min="0"
            max="30"
            step="1"
            value={late}
            onChange={(e) => setLate(e.target.value)}
            className={field}
            disabled={!meta.canEdit}
          />
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
          {Number(late) > 0 && ` A miss that keeps spending becomes a late hit if, from day ${late} on, its totals since launch or any ${late} days in a row reach target (with at least $${min} spent).`} Each
          ad is also judged on its own the same way; one ad hitting makes the concept a hit.
        </span>
      </div>
      <h3 className="mt-6 mb-1 font-extrabold text-ink">Hit (call)</h3>
      <p className="mb-3 max-w-[90ch] text-sm text-ink-3">
        A miss that takes major spend and lifts the account can be called a hit (or super hit) by the media buyer, even below target. The hub
        flags it for review when it reaches these numbers since launch; the call, and these thresholds, are the media buyer's only.
      </p>
      <div className="grid gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <Labeled label="Flag from ROAS">
          <input id="w-roas" type="number" min="0.1" step="0.05" value={wRoas} onChange={(e) => setWRoas(e.target.value)} className={field} disabled={!buyer} />
        </Labeled>
        <Labeled label="…on spend of ($)">
          <input id="w-spend" type="number" min="0" step="100" value={wSpend} onChange={(e) => setWSpend(e.target.value)} className={field} disabled={!buyer} />
        </Labeled>
        <Labeled label="…over (days)">
          <input id="w-days" type="number" min="1" max="90" step="1" value={wDays} onChange={(e) => setWDays(e.target.value)} className={field} disabled={!buyer} />
        </Labeled>
        <Labeled label="Super hit from ($)">
          <input id="w-super" type="number" min="0" step="500" value={swSpend} onChange={(e) => setSwSpend(e.target.value)} className={field} disabled={!buyer} />
        </Labeled>
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

/** Pods beyond the built-in four, matched by an ad set name part; up to POD_SLOTS.length. */
function AddedPods({ meta, onSaved }: { meta: MetaResponse; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const { busy, run, note } = useSave(onSaved);
  const added = meta.pods.filter((p) => p.prefix);
  const full = added.length >= POD_SLOTS.length;
  const add = async () => {
    if (await run("/api/pods", "POST", { name: name.trim(), prefix: prefix.trim() }, `Added ${name.trim()}; its ads have been credited.`)) {
      setName("");
      setPrefix("");
    }
  };
  return (
    <div className="mt-5 border-t border-divider pt-4">
      <h3 className="font-extrabold text-ink">Added pods</h3>
      <p className="mb-2 max-w-[70ch] text-xs text-ink-3">
        For teams or partners beyond the four strategists. Ad sets with the prefix as one of their parts ("TRYBE | Larissa V | …") are credited to the pod
        and counted like any pod. Up to {POD_SLOTS.length}, each with its own tested color.
      </p>
      {added.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1.5">
          {added.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 text-sm">
              <PodChip podId={p.id} />
              <span className="text-ink-3">ad sets with "{p.prefix}" · code {p.code}</span>
              <button
                className="btn btn-ghost py-0 text-sm text-bad"
                disabled={busy || !meta.canEdit}
                onClick={() => {
                  if (confirm(`Remove ${p.name}? Its ads go back to automatic crediting (or To review).`))
                    void run(`/api/pods/${p.id}`, "DELETE", {}, `Removed ${p.name}.`);
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && prefix.trim()) void add();
        }}
      >
        <input aria-label="Pod name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="Name, e.g. Trybe" className={`${field} min-w-44`} disabled={!meta.canEdit || full} />
        <input
          aria-label="Ad set prefix"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value.toUpperCase())}
          maxLength={12}
          placeholder="Ad set prefix, e.g. TRYBE"
          className={`${field} min-w-52`}
          disabled={!meta.canEdit || full}
        />
        <button className={secondary} disabled={!name.trim() || !prefix.trim() || busy || !meta.canEdit || full}>
          Add pod
        </button>
        {full && <span className="self-center text-xs text-ink-3">All {POD_SLOTS.length} colors are in use; remove a pod to add another.</span>}
      </form>
      <div className="mt-2">{note}</div>
    </div>
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
        An ad's pod comes from the strategist named in its ad set ("IH | Harris | …", "Shameer | Static 3 | …"). Ad sets starting with an agency code are the
        agency's, and so is anything launched before the pods started. Ads you tag by hand keep their pod.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {meta.pods.map((p) => (
          <span key={p.id} className="flex items-center gap-2">
            <PodChip podId={p.id} />
            <span className="num text-xs text-ink-3">{p.prefix ? `ad sets with "${p.prefix}"` : p.code}</span>
          </span>
        ))}
      </div>
      <AddedPods meta={meta} onSaved={onSaved} />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Labeled label="Agency ad set codes" hint="First part of the ad set name, comma separated.">
          <input id="a-codes" value={codes} onChange={(e) => setCodes(e.target.value)} className={field} disabled={!meta.canEdit} />
        </Labeled>
        <Labeled
          label="Pods started on"
          hint={
            a.detected
              ? `Leave empty to detect it (currently ${shortDate(a.podsStartDate)}, from the first strategist ad set).`
              : "Clear it to detect from the first strategist ad set."
          }
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

/** Who can change things. Cloudflare Access decides who can open the hub; this list, who can edit. */
function EditAccessCard({ meta, onSaved }: { meta: MetaResponse; onSaved: () => void }) {
  const { busy, run, note } = useSave(onSaved);
  const [email, setEmail] = useState("");
  const me = meta.viewer?.toLowerCase() ?? null;
  const list = meta.editAccess ?? [];
  const off = !meta.canEdit || busy;
  const add = async () => {
    const e = email.trim();
    if (await run("/api/edit-access", "POST", { email: e }, list.length === 0 ? `Added ${e}. Everyone else is now view-only.` : `Added ${e}.`)) setEmail("");
  };
  return (
    <section>
      <SectionTitle
        title="Who can edit"
        right={list.length === 0 ? "Everyone signed in can edit" : `${list.length} ${list.length === 1 ? "person" : "people"} · everyone else is view-only`}
      />
      <p className="mb-3 max-w-[80ch] text-sm text-ink-3">
        Who can open the hub is set in Cloudflare Access. This list is who can change things: tags, personas, targets, pods and the Meta
        connection. View-only people see everything but can't edit.{" "}
        {list.length === 0
          ? "While the list is empty, everyone signed in can edit; adding the first person (you're added with them) makes everyone else view-only."
          : "You can't remove yourself; ask another editor."}
      </p>
      {list.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-1.5">
          {list.map((e) => (
            <li key={e} className="inline-flex items-center gap-1 border border-divider bg-surface px-2 py-0.5 text-sm text-ink">
              {e}
              {e === me ? (
                <span className="text-xs text-ink-3">(you)</span>
              ) : (
                <button
                  aria-label={`Remove ${e}`}
                  className="text-ink-3 hover:text-bad"
                  disabled={off}
                  onClick={() => run(`/api/edit-access/${encodeURIComponent(e)}`, "DELETE", {}, `${e} is now view-only.`)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) void add();
        }}
      >
        <input
          type="email"
          aria-label="Email to give edit access"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@kojeva.com"
          className={`${field} min-w-64`}
          disabled={!meta.canEdit}
        />
        <button className={secondary} disabled={!email.trim() || off}>
          Give edit access
        </button>
        {note}
      </form>
      {!meta.canEdit && meta.accessProtected && <p className="mt-2 text-sm text-ink-3">You have view-only access.</p>}
    </section>
  );
}

const STATUS_LABEL: Record<Persona["status"], string> = { draft: "Draft", active: "In use", suggested: "Suggested by Claude" };

/** One persona, edited in place (saved when a field loses focus). */
function PersonaRow({
  meta,
  p,
  others,
  run,
  busy,
}: {
  meta: MetaResponse;
  p: Persona;
  others: Persona[];
  run: ReturnType<typeof useSave>["run"];
  busy: boolean;
}) {
  const [into, setInto] = useState("");
  const off = !meta.canEdit || busy;
  const save = (patch: { name?: string; description?: string }) => {
    if ((patch.name ?? p.name) === p.name && (patch.description ?? p.description) === p.description) return;
    void run(`/api/personas/${p.id}`, "PATCH", patch, "Saved.");
  };
  return (
    <div className={`flex flex-col gap-2 p-3 ${p.status === "suggested" ? "border border-dashed border-line" : "bg-surface"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Persona name"
          defaultValue={p.name}
          maxLength={60}
          disabled={off}
          className={`${field} min-w-48 flex-1 bg-page font-bold`}
          onBlur={(e) => save({ name: e.target.value.trim() })}
        />
        <span className="bg-page px-1.5 py-px text-[11px] font-semibold text-ink-2">{STATUS_LABEL[p.status]}</span>
      </div>
      <textarea
        aria-label={`Who is ${p.name}`}
        defaultValue={p.description}
        maxLength={240}
        rows={2}
        disabled={off}
        placeholder="One specific person: age, situation, what they've tried, what they want"
        className={`${field} bg-page text-sm`}
        onBlur={(e) => save({ description: e.target.value.trim() })}
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {p.status === "suggested" ? (
          <>
            <button className={secondary} disabled={off} onClick={() => run(`/api/personas/${p.id}`, "PATCH", { status: "active" }, `Added ${p.name}.`)}>
              Approve
            </button>
            <button className="btn btn-ghost" disabled={off} onClick={() => run(`/api/personas/${p.id}`, "DELETE", {}, `Dismissed ${p.name}.`)}>
              Dismiss
            </button>
          </>
        ) : (
          <>
            <select
              aria-label={`Merge ${p.name} into`}
              className={`${field} bg-page py-1`}
              value={into}
              onChange={(e) => setInto(e.target.value)}
              disabled={off || others.length === 0}
            >
              <option value="">Merge into…</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {into && (
              <button
                className={secondary}
                disabled={off}
                onClick={() => run(`/api/personas/${p.id}?into=${into}`, "DELETE", {}, `Merged ${p.name} into ${others.find((o) => o.id === into)?.name}.`)}
              >
                Merge
              </button>
            )}
            <button
              className="btn btn-ghost text-bad"
              disabled={off}
              onClick={() => {
                if (confirm(`Delete ${p.name}? Its ads go back to Claude to place again.`))
                  void run(`/api/personas/${p.id}`, "DELETE", {}, `Deleted ${p.name}.`);
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PersonasCard({ meta, onSaved }: { meta: MetaResponse; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const { busy, run, note } = useSave(onSaved);
  const list = meta.personas.filter((p) => p.status !== "suggested");
  const suggested = meta.personas.filter((p) => p.status === "suggested");
  const drafts = list.filter((p) => p.status === "draft").length;
  const confirmed = list.some((p) => p.status === "active");
  const add = async () => {
    if (await run("/api/personas", "POST", { name: name.trim(), description: description.trim() }, `Added ${name.trim()}.`)) {
      setName("");
      setDescription("");
    }
  };
  return (
    <section id="personas">
      <SectionTitle
        title="Personas"
        right={
          <span>
            Rows of the{" "}
            <a href="#/coverage" className="link">
              coverage map
            </a>
            . Claude places each ad in one, nightly.
          </span>
        }
      />
      {list.length === 0 && (
        <p className="mb-3 text-sm text-ink-3">
          No personas yet. Claude drafts a list from Atria's persona tags on its next nightly run, or add your own below. Aim for 4–8 specific people.
        </p>
      )}
      {drafts > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 bg-warn-soft px-3 py-2 text-sm text-ink">
          <span>
            {confirmed ? `${drafts} draft ${drafts === 1 ? "persona isn't" : "personas aren't"} in use yet.` : "Claude drafted these from Atria's tags."}{" "}
            Rename, merge or delete, then confirm. Claude starts placing ads on its next run.
          </span>
          <button className={primary} disabled={!meta.canEdit || busy} onClick={() => run("/api/personas/confirm", "POST", {}, "Persona list confirmed.")}>
            Confirm {drafts === 1 ? "persona" : `${drafts} personas`}
          </button>
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((p) => (
          <PersonaRow key={`${p.id}:${p.name}:${p.description}`} meta={meta} p={p} others={list.filter((o) => o.id !== p.id)} run={run} busy={busy} />
        ))}
      </div>
      {suggested.length > 0 && (
        <>
          <h3 className="mt-5 mb-2 font-extrabold text-ink">Suggested by Claude for ads that fit none of these</h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {suggested.map((p) => (
              <PersonaRow key={`${p.id}:${p.name}:${p.description}`} meta={meta} p={p} others={[]} run={run} busy={busy} />
            ))}
          </div>
        </>
      )}
      <form
        className="mt-4 flex flex-wrap items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void add();
        }}
      >
        <input
          aria-label="New persona name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="Name, e.g. Loyal Lisa"
          className={`${field} min-w-48`}
          disabled={!meta.canEdit}
        />
        <input
          aria-label="New persona description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={240}
          placeholder="Who they are and what they've tried"
          className={`${field} min-w-64 flex-1`}
          disabled={!meta.canEdit}
        />
        <button className={secondary} disabled={!name.trim() || busy || !meta.canEdit}>
          Add persona
        </button>
      </form>
      <div className="mt-2">{note}</div>
    </section>
  );
}

type SettingsTab = "targets" | "pods" | "personas" | "people" | "data";

/** "#/settings?tab=personas" opens that tab (links from other pages). */
function readSettingsTab(): SettingsTab {
  const t = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("tab");
  return t === "pods" || t === "personas" || t === "people" || t === "data" ? t : "targets";
}

/** Settings in tabs, one short page each, instead of one long page. */
export function SettingsPage({ meta, onSynced }: { meta: MetaResponse; onSynced: () => void }) {
  const [tab, setTab] = useState<SettingsTab>(readSettingsTab);
  // A link to another tab while Settings is open ("#/settings?tab=data") switches to it.
  useEffect(() => {
    const onHash = () => setTab(readSettingsTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const tabs: { value: SettingsTab; label: string }[] = [
    { value: "targets", label: "Targets" },
    { value: "pods", label: "Pods & editors" },
    { value: "personas", label: "Personas" },
    // The edit list is only for the people on it.
    ...(meta.canEdit ? [{ value: "people" as const, label: "People & access" }] : []),
    { value: "data", label: "Data sources" },
  ];
  return (
    <div>
      <PageHeader title="Settings" subtitle="Targets, pods, personas, who can edit and data sources">
        <HeaderControls meta={meta} />
      </PageHeader>
      <div className="flex flex-col gap-8 px-4 py-6 md:px-8">
        <ViewOnlyNote canEdit={meta.canEdit} accessProtected={meta.accessProtected} />
        <Tabs value={tab} onChange={setTab} options={tabs} />

        {tab === "targets" && <TargetsCard meta={meta} onSaved={onSynced} />}

        {tab === "pods" && (
          <>
            <section>
              <SectionTitle title="Pod roster" right="Editors aren't in Meta: add them here, then assign them to ads in To review." />
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {meta.pods
                  .filter((p) => p.kind === "pod")
                  .map((p) => (
                    <PodRosterCard key={p.id} meta={meta} podId={p.id} onSaved={onSynced} />
                  ))}
              </div>
            </section>
            <AttributionCard meta={meta} onSaved={onSynced} />
          </>
        )}

        {tab === "personas" && <PersonasCard meta={meta} onSaved={onSynced} />}

        {tab === "people" && meta.canEdit && <EditAccessCard meta={meta} onSaved={onSynced} />}

        {tab === "data" && (
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
              <MetaPanel onSynced={onSynced} canEdit={meta.canEdit} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider py-4">
              <div>
                <h3 className="text-lg font-extrabold text-ink">Atria tags</h3>
                <p className="text-sm text-ink-3">Theme, core desire and other creative tags, pushed nightly by a scheduled Claude task.</p>
              </div>
              <span className="text-sm text-ink-2">Synced nightly</span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
