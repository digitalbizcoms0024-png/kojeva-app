import { useEffect, useRef, useState } from "react";
import type { AlertsResponse } from "../../shared/api.ts";
import { useApi } from "../api.ts";
import { shortDate } from "../format.ts";
import { Icon, LoadError } from "./ui.tsx";

const DISMISS_KEY = "dismissed-alerts";
const WEEK_MS = 7 * 86_400_000;

/** Alerts hidden for a week, in this browser only (a per-viewer convenience). */
function readDismissed(): Record<string, number> {
  try {
    const all = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "{}") as Record<string, number>;
    return Object.fromEntries(Object.entries(all).filter(([, until]) => until > Date.now()));
  } catch {
    return {};
  }
}

function saveDismissed(next: Record<string, number>) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
  } catch {
    /* per-browser convenience only */
  }
}

const RANK = { bad: 0, warn: 1, good: 2 } as const;

/**
 * The alerts as a bell with the open count (sidebar footer, or the top bar on a phone). It opens a
 * panel: problems first, each with its link and "hide for a week". Reloads with the data version.
 */
export function AlertsBell({ version, compact = false }: { version: number; compact?: boolean }) {
  const alerts = useApi<AlertsResponse>(`/api/alerts?v=${version}`);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const list = (alerts.data?.alerts ?? []).filter((a) => !dismissed[a.id]).sort((a, b) => RANK[a.tone] - RANK[b.tone]);
  const hidden = Object.keys(dismissed).length;
  const problems = list.filter((a) => a.tone !== "good").length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => panel.current && !panel.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const hide = (id: string) => {
    const next = { ...dismissed, [id]: Date.now() + WEEK_MS };
    setDismissed(next);
    saveDismissed(next);
  };
  const restore = () => {
    setDismissed({});
    saveDismissed({});
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`btn btn-secondary relative ${compact ? "" : "w-full justify-start"}`}
        aria-expanded={open}
        aria-label={`Alerts: ${list.length} open`}
      >
        <Icon name="bell" size={16} />
        {!compact && <span className="flex-1 text-left">Alerts</span>}
        {list.length > 0 && (
          <span className={`num px-1.5 py-px text-[11px] font-semibold ${problems ? "bg-accent text-on-accent" : "bg-surface-2 text-ink"}`}>{list.length}</span>
        )}
      </button>
      {open && (
        <div
          ref={panel}
          tabIndex={-1}
          role="dialog"
          aria-label="Alerts"
          className="fixed inset-x-2 top-16 z-50 flex max-h-[75vh] flex-col border-2 border-divider bg-page shadow-xl outline-none md:inset-x-auto md:top-auto md:bottom-4 md:left-4 md:w-[440px]"
        >
          <div className="flex items-center justify-between gap-2 border-b-2 border-divider px-4 py-3">
            <div>
              <div className="font-extrabold text-ink">Alerts</div>
              <div className="text-xs text-ink-3">
                {list.length} open{alerts.data?.asOf ? ` · data through ${shortDate(alerts.data.asOf)}` : ""}
                {hidden > 0 && (
                  <>
                    {" · "}
                    <button type="button" className="link" onClick={restore}>
                      show {hidden} hidden
                    </button>
                  </>
                )}
              </div>
            </div>
            <button className="btn btn-secondary" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="overflow-y-auto px-4">
            <LoadError error={alerts.error} retry={alerts.retry} what="alerts" />
            {alerts.data && list.length === 0 && <p className="py-6 text-sm text-ink-3">Nothing needs a look right now.</p>}
            <ul>
              {list.map((a) => (
                <li key={a.id} className="flex items-start gap-3 border-b border-divider py-3 last:border-b-0">
                  <span
                    className={`mt-0.5 grid size-4 shrink-0 place-items-center text-[10px] font-bold text-page ${a.tone === "bad" ? "bg-bad" : a.tone === "warn" ? "bg-warn" : "bg-good"}`}
                    aria-label={a.tone === "bad" ? "Problem" : a.tone === "warn" ? "Needs attention" : "Good news"}
                  >
                    {a.tone === "bad" ? "✕" : a.tone === "warn" ? "!" : "✓"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink">{a.title}</div>
                    <div className="text-xs text-ink-3">{a.detail}</div>
                    <div className="mt-1 flex gap-3 text-xs">
                      <a href={a.href} className="link" onClick={() => setOpen(false)}>
                        {a.action}
                      </a>
                      <button type="button" className="text-ink-3 hover:text-ink" onClick={() => hide(a.id)} title="Hide this alert for a week, in this browser">
                        Hide for a week
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
