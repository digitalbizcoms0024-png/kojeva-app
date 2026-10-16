const DASH = "—";

export function money(cents: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (cents == null) return DASH;
  const dollars = cents / 100;
  if (opts.compact && Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`;
  if (opts.compact && Math.abs(dollars) >= 1000) {
    const k = dollars / 1000;
    return `$${k >= 100 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return `$${dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function dollars(v: number | null | undefined): string {
  if (v == null) return DASH;
  return `$${v.toFixed(2)}`;
}

export function ratio(v: number | null | undefined): string {
  return v == null ? DASH : v.toFixed(2);
}

export function pct(v: number | null | undefined, digits = 2): string {
  return v == null ? DASH : `${(v * 100).toFixed(digits)}%`;
}

export function int(v: number | null | undefined): string {
  return v == null ? DASH : v.toLocaleString("en-US");
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The Triple Whale model the hub stores ("Clicks & Views" in Triple Whale's data). */
export const TW_MODEL_LABEL = "Clicks & deterministic views";

/** Short note on how much of a period Triple Whale covers, or null when it covers all of it. */
export function twCoverageNote(c: { days: number; covered: number } | null | undefined): string | null {
  if (!c || c.days === 0) return null;
  if (c.covered === 0) return "Triple Whale not synced for these days";
  return c.covered < c.days ? `Triple Whale: ${c.covered} of ${c.days} days synced` : null;
}

/** Plain dollars for exports: 1234.5 → "1234.50" (no symbol or separators). */
export function plainDollars(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

/** Plain number for exports; missing stays empty, never 0. */
export function plain(v: number | null | undefined, digits = 2): string {
  return v == null || !Number.isFinite(v) ? "" : String(Number(v.toFixed(digits)));
}

/** Builds a CSV (quoted where needed) and downloads it. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const t = v == null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const text = [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
