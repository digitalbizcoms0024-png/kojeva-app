import { useEffect, useState } from "react";
import type { MetaResponse } from "../shared/api.ts";
import { useApi } from "./api.ts";
import type { Range } from "./components/HeaderControls.tsx";
import { Empty, Icon, type IconName } from "./components/ui.tsx";
import { shortDate } from "./format.ts";
import { DashboardPage } from "./pages/Dashboard.tsx";
import { InsightsPage } from "./pages/Insights.tsx";
import { NamingToolPage } from "./pages/NamingTool.tsx";
import { PodsPage } from "./pages/PodsView.tsx";
import { RankingsPage } from "./pages/Rankings.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { TaggingPage } from "./pages/Tagging.tsx";


const NAV: { path: string; label: string; icon: IconName }[] = [
  { path: "dashboard", label: "Dashboard", icon: "dashboard" },
  { path: "rankings", label: "Ad Rankings", icon: "rankings" },
  { path: "pods", label: "Pods", icon: "pods" },
  { path: "insights", label: "Creative Insights", icon: "insights" },
  { path: "tagging", label: "Needs Tagging", icon: "tagging" },
  { path: "naming", label: "Naming Tool", icon: "naming" },
  { path: "settings", label: "Settings", icon: "settings" },
];

/** "#/rankings?post=123" → { path: "rankings", params: post=123 } */
function currentRoute() {
  const [p = "", q = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  return { path: NAV.find((n) => n.path === p)?.path ?? "dashboard", params: new URLSearchParams(q) };
}

type Theme = "light" | "dark";

function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => storedTheme() ?? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage can be blocked; the toggle still works for this visit.
    }
  };
  return { theme, toggle };
}

function Banner({ tone, children, onClose }: { tone: "warn" | "bad"; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-3 border-b-2 px-4 py-3 text-sm text-ink md:px-8 ${
        tone === "warn" ? "border-warn-line bg-warn-soft" : "border-bad bg-bad-soft"
      }`}
    >
      <Icon name="alert" className={tone === "warn" ? "text-warn" : "text-bad"} />
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button onClick={onClose} aria-label="Dismiss" className="p-1 text-ink-2 hover:text-ink">
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(currentRoute);
  const [range, setRange] = useState<Range>("month");
  const [metaVersion, setMetaVersion] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hideExpiry, setHideExpiry] = useState(false);
  const { theme, toggle } = useTheme();
  const meta = useApi<MetaResponse>(`/api/meta?v=${metaVersion}`);
  const m = meta.data;

  useEffect(() => {
    const onHash = () => {
      setRoute(currentRoute());
      setMenuOpen(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const path = route.path;
  const refresh = () => setMetaVersion((v) => v + 1);
  const expires = m?.connectionExpiresInDays;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="border-b-2 border-divider bg-page md:sticky md:top-0 md:flex md:h-screen md:flex-col md:gap-8 md:border-r-2 md:border-b-0 md:px-4 md:py-6">
        <div className="flex items-center justify-between px-4 py-3 md:block md:px-2 md:py-0">
          <a href="#/dashboard" className="block">
            <div className="text-[22px] font-extrabold tracking-[-0.02em] text-ink">Kojeva Hub</div>
            <div className="hidden text-xs text-ink-3 md:block">Performance &amp; creative intelligence</div>
          </a>
          <button className="btn btn-secondary md:hidden" aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen((o) => !o)}>
            <Icon name={menuOpen ? "x" : "menu"} size={16} />
            Menu
          </button>
        </div>
        <nav id="main-nav" className={`${menuOpen ? "flex" : "hidden"} flex-col gap-0.5 px-2 pb-3 md:flex md:px-0 md:pb-0`}>
          {NAV.map((n) => {
            const active = path === n.path;
            const badge = n.path === "tagging" && m && m.needsTagging > 0 ? m.needsTagging : null;
            return (
              <a
                key={n.path}
                href={`#/${n.path}`}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 px-2.5 py-2 text-sm transition ${
                  active ? "bg-surface font-bold text-accent-ink" : "text-ink hover:bg-surface"
                }`}
              >
                <Icon name={n.icon} />
                <span className="flex-1">{n.label}</span>
                {badge != null && (
                  <span className="bg-accent px-1.5 py-px text-[11px] font-semibold text-on-accent" title="Ads with spend in the last 30 days and no pod">
                    {badge}
                  </span>
                )}
              </a>
            );
          })}
        </nav>
        <div className={`${menuOpen ? "flex" : "hidden"} flex-col gap-3 border-t-2 border-divider px-4 py-3 md:mt-auto md:flex md:px-0 md:pt-4 md:pb-0`}>
          <button onClick={toggle} className="btn btn-secondary w-full">
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          {m?.viewer && !m.viewer.startsWith("service:") && (
            <div className="flex items-center gap-2.5 px-1">
              <span className="grid size-8 shrink-0 place-items-center bg-ink text-xs font-bold text-page">{m.viewer.slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0 truncate text-xs text-ink-2" title={m.viewer}>
                {m.viewer}
              </span>
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0">
        {m?.dataMode === "sample" && (
          <Banner tone="warn">
            <b>Sample data</b> · these aren't real Kojeva numbers. Connect Meta in{" "}
            <a href="#/settings" className="link">
              Settings
            </a>
            .
          </Banner>
        )}
        {m && !m.accessProtected && (
          <Banner tone="bad">
            <b>Not locked</b> · anyone with the link can open this app. Set up Cloudflare Access (see Settings).
          </Banner>
        )}
        {m?.lastSync?.status === "error" && (
          <Banner tone="bad">
            <b>The last sync failed</b>
            {m.lastSync.message ? ` · ${m.lastSync.message}` : ""}.{" "}
            <a href="#/settings" className="link">
              Details
            </a>
          </Banner>
        )}
        {expires != null && expires <= 7 && !hideExpiry && (
          <Banner tone={expires < 0 ? "bad" : "warn"} onClose={() => setHideExpiry(true)}>
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>
                <b>{expires < 0 ? "The Meta connection has expired" : `Meta connection expires in ${expires} days`}</b>
                {expires < 0 ? ", so syncing has stopped" : ""} · data through {shortDate(m?.latestDate)}
              </span>
              <a href="#/settings" className="btn btn-secondary bg-page py-1">
                Reconnect
              </a>
            </span>
          </Banner>
        )}
        {meta.error && <Empty>Couldn't reach the API: {meta.error.message}</Empty>}
        {m && path === "dashboard" && <DashboardPage meta={m} range={range} setRange={setRange} />}
        {m && path === "rankings" && <RankingsPage meta={m} range={range} setRange={setRange} initialPost={route.params.get("post")} />}
        {m && path === "pods" && <PodsPage meta={m} range={range} setRange={setRange} />}
        {m && path === "tagging" && <TaggingPage meta={m} onChanged={refresh} />}
        {m && path === "naming" && <NamingToolPage meta={m} />}
        {m && path === "settings" && <SettingsPage meta={m} onSynced={refresh} />}
        {m && path === "insights" && <InsightsPage meta={m} range={range} setRange={setRange} />}
      </main>
    </div>
  );
}
