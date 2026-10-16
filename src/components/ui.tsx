import { useState, type ReactNode } from "react";
import type { HitStatus } from "../../shared/metrics.ts";
import { cpaBand, roasBand, type Band } from "../../shared/metrics.ts";
import { podById } from "../../shared/taxonomy.ts";
import { dollars, ratio } from "../format.ts";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</div>;
}

const SOURCE_LABEL: Record<string, string> = {
  adset: "from the ad set name",
  era: "because it launched before the pods started",
  name: "from the ad name",
  manual: "by hand",
};

export function PodChip({ podId, source }: { podId: string | null; source?: string | null }) {
  const pod = podId ? podById(podId) : null;
  if (!pod)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-3">
        <span className="size-2 rounded-full border border-ink-3" aria-hidden />
        Unassigned
      </span>
    );
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink"
      title={source ? `Pod set ${SOURCE_LABEL[source] ?? `by ${source}`}` : undefined}
    >
      <span className="size-2 rounded-full" style={{ background: `var(--pod-${pod.id})` }} aria-hidden />
      {pod.name}
    </span>
  );
}

const BAND_STYLE: Record<Band, { cls: string; icon: string; label: string }> = {
  good: { cls: "bg-good-soft text-good", icon: "✓", label: "on target" },
  warn: { cls: "bg-warn-soft text-warn", icon: "!", label: "near target" },
  bad: { cls: "bg-bad-soft text-bad", icon: "✕", label: "off target" },
  none: { cls: "text-ink-3", icon: "", label: "no data" },
};

function Banded({ band, children }: { band: Band; children: ReactNode }) {
  const s = BAND_STYLE[band];
  return (
    <span className={`num inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${s.cls}`} title={s.label}>
      {s.icon && <span aria-hidden className="text-[10px] font-bold">{s.icon}</span>}
      <span className="sr-only">{s.label}: </span>
      {children}
    </span>
  );
}

export function CpaValue({ value, target }: { value: number | null; target: number }) {
  return <Banded band={cpaBand(value, target)}>{dollars(value)}</Banded>;
}

export function RoasValue({ value, target }: { value: number | null; target: number }) {
  return <Banded band={roasBand(value, target)}>{ratio(value)}</Banded>;
}

const HIT_STYLE: Record<HitStatus, { cls: string; label: string }> = {
  hit: { cls: "bg-good-soft text-good", label: "✓ Hit" },
  miss: { cls: "bg-surface-2 text-ink-2", label: "✕ Miss" },
  testing: { cls: "bg-accent-soft text-accent", label: "◷ Testing" },
  ineligible: { cls: "bg-surface-2 text-ink-3", label: "Under min spend" },
};

export function HitBadge({ status }: { status: HitStatus | null }) {
  if (!status) return null;
  const s = HIT_STYLE[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="num mt-1 text-xl font-semibold text-ink">{children}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-surface-2 p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-sm transition ${
            o.value === value ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-2">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line bg-surface px-2 py-1.5 font-medium text-ink focus:outline-2 focus:outline-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Creative thumbnail, or a placeholder when there is none. */
export function Thumb({ mediaType, label, url, className = "" }: { mediaType: string; label: string; url: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  // Meta's thumbnail links expire; fall back to the placeholder until the next sync refreshes them.
  if (url && !failed)
    return <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`rounded-xl bg-surface-2 object-cover ${className}`} />;
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl bg-gradient-to-br from-surface-2 to-line text-ink-3 ${className}`}
      aria-hidden
    >
      <span className="text-lg">{mediaType === "image" ? "▣" : "▶"}</span>
      <span className="mt-1 max-w-full truncate px-1 text-[10px]">{label}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-6 py-12 text-center text-sm text-ink-3">{children}</div>;
}
