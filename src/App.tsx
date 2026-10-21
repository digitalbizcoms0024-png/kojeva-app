import { useEffect, useState } from "react";
import type { MetaResponse } from "../shared/api.ts";
import { SIGNED_OUT_EVENT, useApi } from "./api.ts";
import { ConceptDrawer } from "./components/ConceptDrawer.tsx";
import type { Range } from "./components/HeaderControls.tsx";
import { Empty, Icon, type IconName } from "./components/ui.tsx";
import { shortDate } from "./format.ts";
import { DashboardPage } from "./pages/Dashboard.tsx";
import { applyAddedPods } from "./podColors.ts";
import { CoveragePage } from "./pages/Coverage.tsx";
import { InsightsPage } from "./pages/Insights.tsx";
import { NamingToolPage } from "./pages/NamingTool.tsx";
import { PodsPage } from "./pages/PodsView.tsx";
import { RankingsPage } from "./pages/Rankings.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { ReportsPage } from "./pages/Reports.tsx";
import { GroupDrawer } from "./components/GroupDrawer.tsx";
import { closeHref, readDrill } from "./drill.ts";
import { TaggingPage } from "./pages/Tagging.tsx";
import { AlertsBell } from "./components/AlertsBell.tsx";
import { QuickSearch } from "./components/QuickSearch.tsx";


/** The menu in two groups: pages to read, and tools (To review only for people on the edit list). */
type NavGroup = "analyse" | "do" | "settings";
const NAV: { path: string; label: string; icon: IconName; group: NavGroup }[] = [
  { path: "dashboard", label: "Dashboard", icon: "dashboard", group: "analyse" },
  { path: "rankings", label: "Ad Rankings", icon: "rankings", group: "analyse" },
  { path: "pods", label: "Pods", icon: "pods", group: "analyse" },
  { path: "insights", label: "Creative Insights", icon: "insights", group: "analyse" },
  { path: "coverage", label: "Coverage Map", icon: "grid", group: "analyse" },
  { path: "tagging", label: "To review", icon: "tagging", group: "do" },
  { path: "reports", label: "CS Reports", icon: "report", group: "do" },
  { path: "naming", label: "Naming Tool", icon: "naming", group: "do" },
  { path: "settings", label: "Settings", icon: "settings", group: "settings" },
];
const NAV_GROUPS: { group: NavGroup; label: string | null }[] = [
  { group: "analyse", label: "Analyse" },
  { group: "do", label: "Do" },
  { group: "settings", label: null },
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
  // Desktop sidebar folded down to icons; remembered in this browser.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("sidebar-collapsed", c ? "0" : "1");
      } catch {
        /* per-browser convenience only */
      }
      return !c;
    });
  const [hideExpiry, setHideExpiry] = useState(false);
  const { theme, toggle } = useTheme();
  const meta = useApi<MetaResponse>(`/api/meta?v=${metaVersion}`);
  // Pods added in Settings must be registered before any page renders them.
  const m = meta.data;
  if (m) applyAddedPods(m.pods);

  useEffect(() => {
    let page = currentRoute().path;
    const onHash = () => {
      const next = currentRoute();
      setRoute(next);
      setMenuOpen(false);
      // Opening or closing a side card keeps your place on the page; only a new page starts at the top.
      if (next.path !== page) window.scrollTo(0, 0);
      page = next.path;
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const path = route.path;
  const drill = readDrill(route.params);
  const refresh = () => setMetaVersion((v) => v + 1);
  const expires = m?.connectionExpiresInDays;
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    const on = () => setSignedOut(true);
    window.addEventListener(SIGNED_OUT_EVENT, on);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, on);
  }, []);

  return (
    <div className={`min-h-screen md:grid ${collapsed ? "md:grid-cols-[76px_minmax(0,1fr)]" : "md:grid-cols-[232px_minmax(0,1fr)]"}`}>
      <aside
        className={`border-b-2 border-divider bg-page md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-r-2 md:border-b-0 md:py-6 ${collapsed ? "md:gap-5 md:overflow-y-auto md:px-2" : "md:gap-8 md:px-4"}`}
      >
        <div className={`flex items-center justify-between px-4 py-3 md:px-2 md:py-0 ${collapsed ? "md:flex-col md:gap-3 md:px-0" : "md:items-start md:gap-2"}`}>
          <a href="#/dashboard" className="block" title="Kojeva Hub">
            <div className={`text-[22px] font-extrabold tracking-[-0.02em] text-ink ${collapsed ? "md:hidden" : ""}`}>Kojeva Hub</div>
            <div className={`hidden text-[22px] font-extrabold text-ink ${collapsed ? "md:block" : ""}`}>K</div>
            <div className={`hidden text-xs text-ink-3 ${collapsed ? "" : "md:block"}`}>Performance &amp; creative intelligence</div>
          </a>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden p-1.5 text-ink-3 hover:bg-surface hover:text-ink md:block"
            aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
            title={collapsed ? "Expand the menu" : "Collapse the menu"}
          >
            <Icon name="panel" size={18} />
          </button>
          <span className="flex items-center gap-2 md:hidden">
          {m && <AlertsBell version={metaVersion} compact />}
          <button className="btn btn-secondary md:hidden" aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen((o) => !o)}>
            <Icon name={menuOpen ? "x" : "menu"} size={16} />
            Menu
          </button>
          </span>
        </div>
        <div className={`${menuOpen ? "block" : "hidden"} px-4 pb-2 md:block md:px-0 md:pb-0`}>
          {m && (
            <>
              <span className={collapsed ? "md:hidden" : ""}>
                <QuickSearch meta={m} />
              </span>
              {collapsed && (
                <span className="hidden md:block">
                  <QuickSearch meta={m} iconOnly />
                </span>
              )}
            </>
          )}
        </div>
        <nav id="main-nav" className={`${menuOpen ? "flex" : "hidden"} flex-col gap-0.5 px-2 pb-3 md:flex md:px-0 md:pb-0`}>
          {NAV_GROUPS.map(({ group, label }) => {
            // View-only people don't get the work pages; they can still open them by link.
            // View-only people don't get To review (they can't act on it); everyone gets the Naming Tool.
            const items = NAV.filter((x) => x.group === group && (x.path !== "tagging" || !m || m.canEdit));
            if (!items.length) return null;
            return (
              <div key={group} className={`flex flex-col gap-0.5 ${group === "analyse" ? "" : "mt-3"} ${group === "settings" ? "border-t border-divider pt-3" : ""}`}>
                {label && <div className={`kicker px-2.5 pb-1 ${collapsed ? "md:hidden" : ""}`}>{label}</div>}
                {items.map((n) => {
                  const active = path === n.path;
                  const badge = n.path === "tagging" && m && m.needsTagging > 0 ? m.needsTagging : null;
                  return (
                    <a
                      key={n.path}
                      href={`#/${n.path}`}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? n.label : undefined}
                      className={`relative flex items-center gap-2.5 px-2.5 py-2 text-sm transition ${collapsed ? "md:justify-center md:py-2.5" : ""} ${
                        active ? "bg-surface font-bold text-accent-ink" : "text-ink hover:bg-surface"
                      }`}
                    >
                      <Icon name={n.icon} />
                      <span className={`flex-1 ${collapsed ? "md:hidden" : ""}`}>{n.label}</span>
                      {badge != null && (
                        <span
                          className={`bg-accent px-1.5 py-px text-[11px] font-semibold text-on-accent ${collapsed ? "md:absolute md:top-0 md:right-0 md:rounded-full md:px-1 md:text-[10px]" : ""}`}
                          title="Ads with spend in the last 30 days and no pod"
                        >
                          {badge}
                        </span>
                      )}
                    </a>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className={`${menuOpen ? "flex" : "hidden"} flex-col gap-3 border-t-2 border-divider px-4 py-3 md:mt-auto md:flex md:px-0 md:pt-4 md:pb-0`}>
          <div className={`grid gap-2 ${collapsed ? "md:grid-cols-1" : "grid-cols-2"}`}>
            <div className="hidden md:block">{m && <AlertsBell version={metaVersion} panelLeft={collapsed ? "md:left-[88px]" : "md:left-[244px]"} />}</div>
            <button onClick={toggle} className="tile" title={theme === "dark" ? "Light mode" : "Dark mode"}>
              <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
              {theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>
          {m?.viewer && !m.viewer.startsWith("service:") && (
            <div className={`flex items-center gap-2.5 px-1 ${collapsed ? "md:justify-center" : ""}`}>
              <span className="grid size-8 shrink-0 place-items-center bg-ink text-xs font-bold text-page" title={m.viewer}>{m.viewer.slice(0, 2).toUpperCase()}</span>
              <span className={`min-w-0 text-xs text-ink-2 ${collapsed ? "md:hidden" : ""}`}>
                <span className="block truncate" title={m.viewer}>
                  {m.viewer}
                </span>
                <span className="text-ink-3">{m.canEdit ? "Can edit" : "View only"}</span>
              </span>
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0">
        {window.location.hostname.startsWith("kojeva-hub-preview.") && (
          <Banner tone="warn">
            <b>Preview copy</b> · for checking changes before they go live. Sample data; nothing here reaches the live hub.
          </Banner>
        )}
        {signedOut && (
          <Banner tone="bad">
            <b>Your sign-in has expired</b> · the page can't load new numbers until you sign in again.{" "}
            <button type="button" className="link" onClick={() => window.location.reload()}>
              Reload and sign in
            </button>
          </Banner>
        )}
        {m?.dataMode === "sample" && (
          <Banner tone="warn">
            <b>Sample data</b> · these aren't real Kojeva numbers. Connect Meta in{" "}
            <a href="#/settings?tab=data" className="link">
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
            <a href="#/settings?tab=data" className="link">
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
              <a href="#/settings?tab=data" className="btn btn-secondary bg-page py-1">
                Reconnect
              </a>
            </span>
          </Banner>
        )}
        {meta.error && <Empty>Couldn't reach the API: {meta.error.message}</Empty>}
        {m && path === "dashboard" && <DashboardPage meta={m} range={range} setRange={setRange} />}
        {m && path === "rankings" && <RankingsPage meta={m} range={range} setRange={setRange} initialPost={route.params.get("post")} initialStatus={route.params.get("status")} />}
        {m && path === "pods" && <PodsPage meta={m} range={range} setRange={setRange} />}
        {m && path === "tagging" && <TaggingPage meta={m} onChanged={refresh} />}
        {m && path === "naming" && <NamingToolPage meta={m} />}
        {m && path === "settings" && <SettingsPage meta={m} onSynced={refresh} />}
        {m && path === "insights" && <InsightsPage meta={m} range={range} setRange={setRange} />}
        {m && path === "coverage" && <CoveragePage meta={m} />}
        {m && path === "reports" && <ReportsPage meta={m} />}
      </main>
      {/* Side cards over the page, from the URL (src/drill.ts): a group, and a concept on top of it. */}
      {m && route.params.get("concept") ? (
        <ConceptDrawer
          key={route.params.get("concept")!}
          conceptId={route.params.get("concept")!}
          meta={m}
          onClose={() => (window.location.hash = closeHref())}
          back={drill ? { label: drill.title, onBack: () => (window.location.hash = closeHref("concept")) } : undefined}
        />
      ) : (
        m && drill && <GroupDrawer key={window.location.hash} spec={drill} meta={m} onClose={() => (window.location.hash = closeHref())} />
      )}
    </div>
  );
}
