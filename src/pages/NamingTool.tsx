import { useState } from "react";
import type { MetaResponse } from "../../shared/api.ts";
import { buildAdName, parseAdName, validateNameFields, type NameFields } from "../../shared/naming.ts";
import { ANGLES, FORMATS, HOOKS, LANDING_PAGES, PODS, podByCode, type PodCode } from "../../shared/taxonomy.ts";
import { HeaderControls } from "../components/HeaderControls.tsx";
import { Icon, PageHeader, PodSwatch, SectionTitle, Segmented } from "../components/ui.tsx";

const opts = (vocab: Record<string, string>) => [{ value: "", label: "—" }, ...Object.entries(vocab).map(([value, label]) => ({ value, label: value === label ? label : `${label} → ${value}` }))];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-ink-2">
      {label}
      {children}
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

type Recent = { name: string; podCode: string; at: string };
const RECENT_KEY = "naming.recent";

// Recent names are a per-browser convenience; they're not shared with the team.
function loadRecent(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Recent[];
    return Array.isArray(v) ? v.slice(0, 10) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: Recent[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)));
  } catch {
    // Storage blocked: the list just won't survive a reload.
  }
}

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function NamingToolPage({ meta }: { meta: MetaResponse }) {
  const [f, setF] = useState<NameFields>({ podCode: "HAR", creativeId: "", iteration: null, angle: "", format: "", hook: "", landingPage: "PDP" });
  const [copied, setCopied] = useState<string | null>(null);
  const [check, setCheck] = useState("HxM 7.1 Funeral_MatureFace_UGC_Story");
  const [recent, setRecent] = useState<Recent[]>(loadRecent);

  const errors = f.creativeId ? validateNameFields(f) : [];
  const name = f.creativeId && errors.length === 0 ? buildAdName(f) : null;
  const parsed = parseAdName(check);
  const set = <K extends keyof NameFields>(k: K, v: NameFields[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setCopied(null);
  };

  const copy = (text: string, podCode: string, remember: boolean) =>
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(text);
        if (remember) {
          const next = [{ name: text, podCode, at: new Date().toISOString() }, ...recent.filter((r) => r.name !== text)].slice(0, 10);
          setRecent(next);
          saveRecent(next);
        }
      },
      () => setCopied(null),
    );

  const select = (k: "angle" | "format" | "hook", vocab: Record<string, string>) => (
    <select value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="field">
      {opts(vocab).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  const parts: [string, string | null][] = [
    ["Pod", f.podCode],
    ["Creative", f.creativeId ? f.creativeId.toUpperCase() : null],
    ["Iteration", f.iteration ? `i${f.iteration}` : null],
    ["Angle", f.angle || null],
    ["Format", f.format || null],
    ["Hook", f.hook || null],
    ["Landing", f.landingPage || null],
  ];

  return (
    <div>
      <PageHeader title="Naming Tool" subtitle="Generate a standard ad name before launch, so the hub can credit it to a pod">
        <HeaderControls meta={meta} />
      </PageHeader>

      <div className="grid gap-8 px-4 py-6 md:px-8 xl:grid-cols-2">
        <section>
          <SectionTitle title="Build a name" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pod">
              <select value={f.podCode} onChange={(e) => set("podCode", e.target.value as PodCode)} className="field">
                {PODS.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} → {p.code}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Creative ID" hint="V + 3–4 digits, e.g. V612">
              <input value={f.creativeId} onChange={(e) => set("creativeId", e.target.value.trim())} placeholder="V612" className="field" />
            </Field>
            <Field label="Iteration (optional)">
              <input
                type="number"
                min={1}
                value={f.iteration ?? ""}
                onChange={(e) => set("iteration", e.target.value ? Number(e.target.value) : null)}
                placeholder="2"
                className="field"
              />
            </Field>
            <Field label="Angle">{select("angle", ANGLES)}</Field>
            <Field label="Format">{select("format", FORMATS)}</Field>
            <Field label="Hook">{select("hook", HOOKS)}</Field>
            <div className="flex flex-col gap-1 text-sm text-ink-2 sm:col-span-2">
              Landing page
              <Segmented
                label="Landing page"
                value={f.landingPage ?? ""}
                onChange={(v) => set("landingPage", v)}
                options={Object.entries(LANDING_PAGES).map(([value, label]) => ({ value, label }))}
              />
            </div>
          </div>
        </section>

        <div className="flex min-w-0 flex-col gap-8">
          <section className="bg-surface p-5">
            <div className="kicker">Live preview</div>
            <div className="mt-2 text-2xl leading-tight font-extrabold break-words text-ink md:text-[28px]">
              {name ?? <span className="text-ink-3">Enter a creative ID</span>}
            </div>
            {errors.map((e) => (
              <div key={e} className="mt-1 text-sm text-bad">
                ✕ {e}
              </div>
            ))}
            <div className="mt-4 grid grid-cols-3 gap-0.5 border-2 border-divider bg-divider sm:grid-cols-7">
              {parts.map(([k, v]) => (
                <div key={k} className="min-w-0 bg-page px-2 py-1.5">
                  <div className="kicker text-[10px]">{k}</div>
                  <div className={`truncate text-sm font-bold ${v ? "text-ink" : "text-ink-3"}`}>{v ?? "—"}</div>
                </div>
              ))}
            </div>
            <button className="btn btn-primary mt-4" disabled={!name} onClick={() => name && copy(name, f.podCode, true)}>
              <Icon name={copied === name && name ? "check" : "copy"} size={16} />
              {copied === name && name ? "Copied" : "Copy name"}
            </button>
          </section>

          <section>
            <SectionTitle title="Recently generated" right="On this browser" />
            {recent.length === 0 && <p className="text-sm text-ink-3">Names you copy show up here.</p>}
            <ul>
              {recent.map((r) => (
                <li key={r.name} className="flex items-center gap-3 border-b border-divider py-2.5">
                  <PodSwatch podId={podByCode(r.podCode)?.id ?? null} />
                  <span className="sr-only">{podByCode(r.podCode)?.name}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink" title={r.name}>
                    {r.name}
                  </span>
                  <span className="hidden text-xs text-ink-3 sm:inline">{when(r.at)}</span>
                  <button className="btn btn-ghost py-0 text-sm" onClick={() => copy(r.name, r.podCode, false)}>
                    {copied === r.name ? "Copied" : "Copy"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="xl:col-span-2">
          <SectionTitle title="Check any ad name" right="See what the hub can read from an existing name" />
          <input value={check} onChange={(e) => setCheck(e.target.value)} className="field w-full" aria-label="Ad name to check" />
          <dl className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["Convention", parsed.convention],
                ["Pod", parsed.podCode ?? (parsed.legacyPrefix ? `prefix ${parsed.legacyPrefix}` : null)],
                ["Creative ID", parsed.creativeId],
                ["Iteration", parsed.iteration],
                ["Angle", parsed.angle],
                ["Format", parsed.format],
                ["Hook", parsed.hook],
                ["Landing page", parsed.landingPage],
                ["Campaign hint", parsed.campaignHint],
                ["Copy", parsed.isCopy ? "yes" : "no"],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-divider py-1.5 text-sm">
                <dt className="text-ink-3">{k}</dt>
                <dd className="text-right font-semibold text-ink">{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
