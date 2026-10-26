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
  } catch (e) {
    if (init?.signal?.aborted) throw e;
    throw new Error("Couldn't reach the hub. Check your connection, or reload the page.");
  }
  if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) {
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    throw new Error("Your sign-in has expired. Reload the page to sign in again.");
  }
  return r;
}

/**
 * An error the hub's own code didn't write (it always sends a JSON message): Cloudflare stopped the
 * request first, e.g. when the Worker ran out of resources.
 */
export function noBodyMessage(r: Response): string {
  if (r.status === 502 || r.status === 503 || r.status === 504)
    return `Cloudflare stopped this request (HTTP ${r.status}), usually because the hub was busy rebuilding its numbers. Try again in a minute.`;
  return r.statusText || `HTTP ${r.status}`;
}

/** How long a request may take before the panel says so and offers a retry. */
const SLOW_MS = 45_000;

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), SLOW_MS);
    setLoading(true);
    setError(null);
    // The previous data stays on screen until the new one arrives (no blank panels on a range change).
    apiFetch(path, { signal: abort.signal })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((body as { error?: string }).error || noBodyMessage(r));
        return body as T;
      })
      .then((d) => alive && setData(d))
      .catch((e: Error) => {
        if (!alive) return;
        setError(abort.signal.aborted ? new Error("This is taking much longer than usual.") : e);
      })
      .finally(() => {
        clearTimeout(timer);
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      clearTimeout(timer);
      abort.abort();
    };
  }, [path, attempt]);

  return { data, error, loading, retry: () => setAttempt((n) => n + 1) };
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
