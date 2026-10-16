import { useEffect, useState } from "react";
import type { RangeKey } from "../shared/api.ts";

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(path)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((body as { error?: string }).error ?? r.statusText);
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
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  return p.toString();
}

export const RANGE_LABELS: Record<Exclude<RangeKey, "custom">, string> = {
  week: "This week",
  month: "This month",
  all: "All time",
};
