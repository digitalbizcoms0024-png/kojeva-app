import type { MetaResponse } from "../../shared/api.ts";
import { Card, PodChip } from "../components/ui.tsx";
import { dateTime } from "../format.ts";

const SOURCES = [
  { name: "Meta Ads", detail: "Ads, creatives and daily delivery. Connect with Facebook (read-only, ads_read).", phase: "Phase 1" },
  { name: "Triple Whale", detail: "Attributed revenue and blended metrics, shown next to Meta's, never merged.", phase: "Phase 4" },
  { name: "Atria", detail: "Creative tags and transcripts, pushed nightly by a scheduled Claude task.", phase: "Phase 3" },
];

export function SettingsPage({ meta }: { meta: MetaResponse }) {
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
        <h2 className="font-semibold text-ink">Targets & hit rate</h2>
        <p className="text-xs text-ink-3">Editable in Phase 2. Stored in the settings table.</p>
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
        <h2 className="font-semibold text-ink">Pods</h2>
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
        <h2 className="font-semibold text-ink">Data sources</h2>
        <p className="text-xs text-ink-3">
          Last sync: {meta.lastSync ? `${meta.lastSync.source} · ${dateTime(meta.lastSync.finishedAt)} · ${meta.lastSync.status}` : "never"}
        </p>
        <div className="mt-3 divide-y divide-line">
          {SOURCES.map((s) => (
            <div key={s.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="font-medium text-ink">{s.name}</div>
                <div className="text-sm text-ink-3">{s.detail}</div>
              </div>
              <span className="rounded-full bg-surface-2 px-3 py-1 text-xs text-ink-2">Not connected · {s.phase}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
