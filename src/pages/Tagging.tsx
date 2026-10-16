import type { MetaResponse, RankingsResponse } from "../../shared/api.ts";
import { parseAdName } from "../../shared/naming.ts";
import { qs, useApi } from "../api.ts";
import { Card, Empty, Thumb } from "../components/ui.tsx";
import { money } from "../format.ts";

export function TaggingPage({ meta }: { meta: MetaResponse }) {
  const { data, error } = useApi<RankingsResponse>(`/api/rankings?${qs({ range: "all", pod: "unassigned", limit: 100 })}`);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Needs tagging</h1>
        <p className="text-sm text-ink-3">
          Ads whose name doesn't say which pod made them, highest spend first. Tag the expensive ones first and pod rankings get accurate fastest. Inline editing and bulk tagging arrive in Phase 2.
        </p>
      </div>
      <Card>
        {error && <Empty>{error.message}</Empty>}
        {data && data.items.length === 0 && <Empty>Everything is tagged.</Empty>}
        <div className="divide-y divide-line">
          {data?.items.map((p) => {
            const parsed = parseAdName(p.name);
            return (
              <div key={p.postId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Thumb mediaType={p.mediaType} label="" url={p.thumbnailUrl} className="h-12 w-9 shrink-0" />
                <div className="min-w-48 flex-1">
                  <div className="font-medium text-ink">{p.name}</div>
                  <div className="text-xs text-ink-3">
                    Parsed: {parsed.creativeId ?? "no creative ID"}
                    {parsed.legacyPrefix && ` · prefix ${parsed.legacyPrefix} (not mapped to a pod yet)`}
                    {parsed.format && ` · ${parsed.format}`}
                    {parsed.landingPage && ` · ${parsed.landingPage}`}
                  </div>
                </div>
                <div className="num text-sm text-ink">{money(p.totals.spendCents, { compact: true })}</div>
                <select disabled className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm text-ink-3" aria-label="Assign pod (Phase 2)">
                  <option>Assign pod…</option>
                  {meta.pods.map((pod) => (
                    <option key={pod.id}>{pod.name}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
