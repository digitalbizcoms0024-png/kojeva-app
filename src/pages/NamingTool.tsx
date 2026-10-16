import { useState } from "react";
import { buildAdName, parseAdName, validateNameFields, type NameFields } from "../../shared/naming.ts";
import { ANGLES, FORMATS, HOOKS, LANDING_PAGES, PODS, type PodCode } from "../../shared/taxonomy.ts";
import { Card } from "../components/ui.tsx";

const opts = (vocab: Record<string, string>) => [{ value: "", label: "—" }, ...Object.entries(vocab).map(([value, label]) => ({ value, label }))];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-ink-2">
      {label}
      {children}
    </label>
  );
}

const inputCls = "rounded-lg border border-line bg-surface px-3 py-2 text-ink focus:outline-2 focus:outline-accent";

export function NamingToolPage() {
  const [f, setF] = useState<NameFields>({ podCode: "HAR", creativeId: "", iteration: null, angle: "", format: "", hook: "", landingPage: "" });
  const [copied, setCopied] = useState(false);
  const [check, setCheck] = useState("HxM 7.1 Funeral_MatureFace_UGC_Story");

  const errors = f.creativeId ? validateNameFields(f) : [];
  const name = f.creativeId && errors.length === 0 ? buildAdName(f) : null;
  const parsed = parseAdName(check);
  const set = <K extends keyof NameFields>(k: K, v: NameFields[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setCopied(false);
  };

  const select = (k: "angle" | "format" | "hook" | "landingPage", vocab: Record<string, string>) => (
    <select value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} className={inputCls}>
      {opts(vocab).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Naming tool</h1>
        <p className="text-sm text-ink-3">Build a name that the hub can attribute to a pod automatically. Paste it into Ads Manager when you launch.</p>
      </div>

      <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Pod (strategist)">
          <select value={f.podCode} onChange={(e) => set("podCode", e.target.value as PodCode)} className={inputCls}>
            {PODS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Creative ID">
          <input value={f.creativeId} onChange={(e) => set("creativeId", e.target.value.trim())} placeholder="V612" className={inputCls} />
        </Field>
        <Field label="Iteration (optional)">
          <input
            type="number"
            min={1}
            value={f.iteration ?? ""}
            onChange={(e) => set("iteration", e.target.value ? Number(e.target.value) : null)}
            placeholder="2"
            className={inputCls}
          />
        </Field>
        <Field label="Angle">{select("angle", ANGLES)}</Field>
        <Field label="Format">{select("format", FORMATS)}</Field>
        <Field label="Hook">{select("hook", HOOKS)}</Field>
        <Field label="Landing page">{select("landingPage", LANDING_PAGES)}</Field>
      </Card>

      <Card className="flex flex-wrap items-center gap-3 p-5">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-ink-3">Ad name</div>
          <div className="num mt-1 text-lg break-all text-ink">{name ?? <span className="text-ink-3">Enter a creative ID</span>}</div>
          {errors.map((e) => (
            <div key={e} className="mt-1 text-sm text-bad">
              {e}
            </div>
          ))}
        </div>
        <button
          disabled={!name}
          onClick={() => name && navigator.clipboard.writeText(name).then(() => setCopied(true), () => setCopied(false))}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-surface disabled:opacity-40"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink">Check any ad name</h2>
        <p className="text-xs text-ink-3">See what the hub can read from an existing name.</p>
        <input value={check} onChange={(e) => setCheck(e.target.value)} className={`${inputCls} mt-3 w-full`} />
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
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
            <div key={k} className="flex justify-between gap-2 border-b border-line py-1">
              <dt className="text-ink-3">{k}</dt>
              <dd className="text-right text-ink">{v ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
