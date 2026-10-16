import { useState, type ReactNode } from "react";
import type { HitStatus } from "../../shared/metrics.ts";
import { cpaBand, roasBand, type Band } from "../../shared/metrics.ts";
import { podById } from "../../shared/taxonomy.ts";
import { dollars, ratio } from "../format.ts";

/** Lucide icon paths (https://lucide.dev), drawn at 2px stroke. */
const ICONS = {
  dashboard: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  rankings: "M3 3v18h18M7 16v-4M12 16V8M17 16v-9",
  pods: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  insights: "M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z",
  tagging: "M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4zM7.5 7.5h.01",
  naming: "M4 7V4h16v3M9 20h6M12 4v16",
  settings: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  moon: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  x: "M18 6 6 18M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  copy: "M8 8h12v12H8zM4 16V4h12",
  play: "M7 4v16l13-8z",
  menu: "M4 6h16M4 12h16M4 18h16",
  arrow: "M5 12h14M13 6l6 6-6 6",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-surface ${className}`}>{children}</div>;
}

/** Page title block: big heading, one-line description, controls on the right, 2px rule below. */
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-divider px-4 pt-6 pb-4 md:px-8 md:pt-7">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.02em] text-ink md:text-[34px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </header>
  );
}

/** Section heading with a strong rule underneath, and an optional note or link on the right. */
export function SectionTitle({ title, right, className = "" }: { title: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`mb-3 flex flex-wrap items-end justify-between gap-2 border-b-2 border-divider pb-2 ${className}`}>
      <h2 className="text-xl font-extrabold tracking-[-0.01em] text-ink">{title}</h2>
      {right && <div className="text-xs text-ink-3">{right}</div>}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  adset: "from the ad set name",
  era: "because it launched before the pods started",
  name: "from the ad name",
  manual: "by hand",
};

/** A pod's color as a small square. Always shown next to the pod's name. */
export function PodSwatch({ podId, className = "" }: { podId: string | null; className?: string }) {
  return (
    <span
      className={`inline-block size-2.5 shrink-0 ${podId ? "" : "border border-ink-3"} ${className}`}
      style={podId ? { background: `var(--pod-${podId})` } : undefined}
      aria-hidden
    />
  );
}

export function PodChip({ podId, source, suffix }: { podId: string | null; source?: string | null; suffix?: ReactNode }) {
  const pod = podId ? podById(podId) : null;
  return (
    <span
      className="inline-flex items-center gap-1.5 border px-1.5 py-px text-xs whitespace-nowrap text-ink"
      style={{
        borderColor: pod ? `var(--pod-${pod.id})` : "var(--divider)",
        background: pod ? `color-mix(in srgb, var(--pod-${pod.id}) 10%, transparent)` : undefined,
      }}
      title={pod && source ? `Pod set ${SOURCE_LABEL[source] ?? `by ${source}`}` : undefined}
    >
      <PodSwatch podId={pod?.id ?? null} />
      {pod ? pod.name : "Unassigned"}
      {suffix}
    </span>
  );
}

const BAND_STYLE: Record<Band, { cls: string; icon: string; label: string }> = {
  good: { cls: "text-good", icon: "✓", label: "on target" },
  warn: { cls: "text-warn", icon: "!", label: "near target" },
  bad: { cls: "text-bad", icon: "✕", label: "off target" },
  none: { cls: "text-ink-3", icon: "", label: "no data" },
};

/** A value colored by its target band. The icon keeps the meaning readable without color. */
export function Banded({ band, children, className = "" }: { band: Band; children: ReactNode; className?: string }) {
  const s = BAND_STYLE[band];
  return (
    <span className={`num relative inline-flex items-baseline gap-1 font-bold ${s.cls} ${className}`} title={s.label}>
      {children}
      {s.icon && (
        <span aria-hidden className="text-[0.6em] leading-none">
          {s.icon}
        </span>
      )}
      <span className="sr-only">, {s.label}</span>
    </span>
  );
}

export function CpaValue({ value, target, warnMax, className }: { value: number | null; target: number; warnMax?: number | null; className?: string }) {
  return (
    <Banded band={cpaBand(value, target, warnMax)} className={className}>
      {dollars(value)}
    </Banded>
  );
}

export function RoasValue({ value, target, className }: { value: number | null; target: number; className?: string }) {
  return (
    <Banded band={roasBand(value, target)} className={className}>
      {ratio(value)}
    </Banded>
  );
}

const HIT_STYLE: Record<HitStatus, { cls: string; label: string }> = {
  hit: { cls: "bg-good-soft text-good", label: "✓ Hit" },
  miss: { cls: "bg-surface-2 text-ink-2", label: "✕ Miss" },
  testing: { cls: "bg-accent-soft text-accent-ink", label: "◷ Testing" },
  ineligible: { cls: "bg-surface-2 text-ink-3", label: "No ad at $100" },
};

export function HitBadge({ status }: { status: HitStatus | null }) {
  if (!status) return null;
  const s = HIT_STYLE[status];
  return <span className={`px-1.5 py-px text-xs font-semibold whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}

/** Plain tag (status, source, counts). */
export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "ink" | "outline" }) {
  const cls = {
    neutral: "bg-surface-2 text-ink-2",
    accent: "bg-accent text-on-accent",
    ink: "bg-ink text-page",
    outline: "border border-divider text-ink-2",
  }[tone];
  return <span className={`px-1.5 py-px text-[11px] font-semibold whitespace-nowrap ${cls}`}>{children}</span>;
}

export function Stat({ label, children, sub }: { label: ReactNode; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <div className="kicker">{label}</div>
      <div className="num mt-1 text-xl font-bold text-ink">{children}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

/** Joined buttons; the selected one is filled with the accent. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="inline-flex flex-wrap" role="tablist" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`-ml-px border px-3 py-1.5 text-sm transition first:ml-0 ${
            o.value === value
              ? "relative z-10 border-accent bg-accent text-on-accent"
              : "border-divider bg-page text-ink hover:bg-surface"
          } ${i === 0 ? "" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Underlined tabs ("Ads · Pods · Editors"). */
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-6 overflow-x-auto border-b-2 border-divider" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`-mb-0.5 border-b-2 pb-2 text-[15px] whitespace-nowrap transition ${
            o.value === value ? "border-accent font-bold text-ink" : "border-transparent text-ink-3 hover:text-ink"
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
  stacked = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  stacked?: boolean;
}) {
  return (
    <label className={`flex text-sm text-ink-2 ${stacked ? "flex-col gap-1" : "items-center gap-2"}`}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field min-w-32">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Creative thumbnail, or a striped placeholder when there is none. */
export function Thumb({ mediaType, label, url, className = "" }: { mediaType: string; label: string; url: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  // Meta's thumbnail links expire; fall back to the placeholder until the next sync refreshes them.
  if (url && !failed)
    return <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`bg-surface-2 object-cover ${className}`} />;
  return (
    <div
      className={`flex flex-col items-start justify-end overflow-hidden text-ink-3 ${className}`}
      style={{ background: "repeating-linear-gradient(135deg, var(--surface-2) 0 6px, var(--line) 6px 12px)" }}
      aria-hidden
    >
      {label && <span className="m-1 max-w-[calc(100%-8px)] truncate bg-page px-1 text-[10px] font-semibold text-ink-2">{label || (mediaType === "image" ? "Image" : "Video")}</span>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-6 py-12 text-sm text-ink-3">{children}</div>;
}

/** Thin horizontal bar against a scale, with an optional dashed target mark. */
export function MeterBar({ value, max, tone, target }: { value: number; max: number; tone: string; target?: number }) {
  const w = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="relative h-3">
      <div className="absolute inset-y-0 left-0" style={{ width: `${w * 100}%`, background: tone }} />
      {target != null && max > 0 && (
        <div className="absolute -inset-y-1.5 border-l-2 border-dashed border-accent" style={{ left: `${Math.min(1, target / max) * 100}%` }} aria-hidden />
      )}
    </div>
  );
}
