import { useEffect, useState } from "react";
import type { RangeKey } from "../shared/api.ts";

/** Fired when the Cloudflare Access sign-in has expired (requests are redirected to its login page). */
export const SIGNED_OUT_EVENT = "kojeva:signed-out";

/**
 * fetch for the app's API. An expired Access session redirects to another origin, which the browser
 * reports only as "Failed to fetch"; this says what happened instead.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  let r: Response;
  try {
    r = await fetch(path, { ...init, redirect: "manual" });
  } catch {
    throw new Error("Couldn't reach the hub. Check your connection, or reload the page.");
  }
  if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) {
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    throw new Error("Your sign-in has expired. Reload the page to sign in again.");
  }
  return r;
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiFetch(path)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((body as { error?: string }).error || r.statusText || `HTTP ${r.status}`);
        return body as T;
      })
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path]);

  return { data, error, loading };
}

export function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    // A custom range travels as range=custom&from=…&to=….
    const custom = k === "range" ? /^custom:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(String(v)) : null;
    if (custom) {
      p.set("range", "custom");
      p.set("from", custom[1]!);
      p.set("to", custom[2]!);
    } else p.set(k, String(v));
  }
  return p.toString();
}

/** Rolling windows end on the latest synced day; "Month to date" matches Ads Manager's "This month". */
export const RANGE_LABELS: Record<Exclude<RangeKey, "custom">, string> = {
  week: "Last 7 days",
  "14d": "Last 14 days",
  month: "Last 30 days",
  mtd: "Month to date",
  all: "All time",
};
