import type { MetaResponse } from "../../shared/api.ts";
import { RANGE_LABELS } from "../api.ts";
import { dateTime } from "../format.ts";
import { Segmented } from "./ui.tsx";

export type Range = keyof typeof RANGE_LABELS;

/** Date range switch plus the last-sync status: the controls at the top right of every data page. */
export function HeaderControls({ meta, range, setRange }: { meta: MetaResponse; range?: Range; setRange?: (r: Range) => void }) {
  const failed = meta.lastSync?.status === "error";
  return (
    <>
      {range && setRange && (
        <Segmented
          label="Date range"
          value={range}
          onChange={setRange}
          options={(Object.keys(RANGE_LABELS) as Range[]).map((value) => ({ value, label: RANGE_LABELS[value] }))}
        />
      )}
      <a
        href="#/settings"
        className="inline-flex items-center gap-2 border border-divider px-3 py-1.5 text-[13px] text-ink-2 hover:bg-surface"
        title={meta.lastSync?.message ?? undefined}
      >
        <span className={`size-2 ${failed ? "bg-bad" : "bg-good"}`} aria-hidden />
        {failed ? "Last sync failed · " : "Last synced "}
        {dateTime(meta.lastSync?.finishedAt)} · Meta
      </a>
    </>
  );
}
