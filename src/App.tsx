import { useEffect, useState } from "react";
import type { MetaResponse } from "../shared/api.ts";
import { RANGE_LABELS, useApi } from "./api.ts";
import { Empty } from "./components/ui.tsx";
import { dateTime, shortDate } from "./format.ts";
import { DashboardPage } from "./pages/Dashboard.tsx";
import { NamingToolPage } from "./pages/NamingTool.tsx";
import { RankingsPage } from "./pages/Rankings.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { TaggingPage } from "./pages/Tagging.tsx";

type Range = keyof typeof RANGE_LABELS;

const NAV = [
  { path: "dashboard", label: "Dashboard" },
  { path: "rankings", label: "Ad Rankings" },
  { path: "insights", label: "Creative Insights", soon: "Phase 3" },
  { path: "tagging", label: "Needs Tagging" },
  { path: "naming", label: "Naming Tool" },
  { path: "settings", label: "Settings" },
] as const;

type Path = (typeof NAV)[number]["path"];

function currentPath(): Path {
  const p = window.location.hash.replace(/^#\/?/, "");
  return (NAV.find((n) => n.path === p)?.path ?? "dashboard") as Path;
}

export default function App() {
  const [path, setPath] = useState<Path>(currentPath);
  const [range, setRange] = useState<Range>("month");
  const [metaVersion, setMetaVersion] = useState(0);
  const meta = useApi<MetaResponse>(`/api/meta?v=${metaVersion}`);

  useEffect(() => {
    const onHash = () => setPath(currentPath());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-5 py-4">
          <span className="grid size-8 place-items-center rounded-lg bg-accent font-bold text-surface">K</span>
          <span className="font-semibold text-ink">Kojeva Hub</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
          {NAV.map((n) => (
            <a
              key={n.path}
              href={`#/${n.path}`}
              className={`rounded-lg px-3 py-2 text-sm whitespace-nowrap transition ${
                path === n.path ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-surface-2"
              }`}
            >
              {n.label}
              {"soon" in n && <span className="ml-2 text-[10px] text-ink-3">{n.soon}</span>}
            </a>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 px-4 py-5 md:px-8">
        {meta.data && (
          <div className="mb-5 flex flex-wrap gap-2 text-xs font-medium tracking-wide uppercase">
            {meta.data.dataMode === "sample" ? (
              <span className="rounded-full bg-warn-soft px-3 py-1 text-warn">Sample data · not real Kojeva numbers</span>
            ) : (
              <span className="rounded-full bg-surface-2 px-3 py-1 text-ink-2">Meta data · through {shortDate(meta.data.latestDate)}</span>
            )}
            <span className="rounded-full bg-surface-2 px-3 py-1 text-ink-2">
              Last synced {dateTime(meta.data.lastSync?.finishedAt)}
            </span>
            {meta.data.lastSync?.status === "error" && (
              <a href="#/settings" className="rounded-full bg-bad-soft px-3 py-1 text-bad">Last sync failed · details</a>
            )}
            {!meta.data.accessProtected && (
              <a href="#/settings" className="rounded-full bg-bad-soft px-3 py-1 text-bad">Not locked · anyone with the link can open this</a>
            )}
          </div>
        )}
        {meta.data?.connectionExpiresInDays != null && meta.data.connectionExpiresInDays <= 7 && (
          <a href="#/settings" className="mb-5 block rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-ink">
            {meta.data.connectionExpiresInDays < 0
              ? "The Meta connection has expired, so syncing has stopped."
              : `The Meta connection expires in ${meta.data.connectionExpiresInDays} days.`}{" "}
            <span className="text-accent underline">Reconnect in Settings →</span>
          </a>
        )}
        {meta.error && <Empty>Couldn't reach the API: {meta.error.message}</Empty>}
        {meta.data && path === "dashboard" && <DashboardPage meta={meta.data} range={range} setRange={setRange} />}
        {meta.data && path === "rankings" && <RankingsPage meta={meta.data} range={range} setRange={setRange} />}
        {meta.data && path === "tagging" && <TaggingPage meta={meta.data} />}
        {path === "naming" && <NamingToolPage />}
        {meta.data && path === "settings" && <SettingsPage meta={meta.data} onSynced={() => setMetaVersion((v) => v + 1)} />}
        {path === "insights" && (
          <Empty>
            Creative Insights (performance by angle, format and hook, plus AI write-ups) is planned for Phase 3, once ads are tagged.
          </Empty>
        )}
      </main>
    </div>
  );
}
