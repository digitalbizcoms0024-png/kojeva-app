import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ConceptsResponse, MetaResponse, RankingsResponse } from "../../shared/api.ts";
import { qs, useApi } from "../api.ts";
import { conceptHref } from "../drill.ts";
import { money } from "../format.ts";
import { Icon } from "./ui.tsx";

/** One thing the search can open. */
interface Item {
  id: string;
  label: string;
  /** Where it lives ("Page", "Settings", "Ad · Harris"…). */
  kind: string;
  href: string;
  /** Extra words it should match ("hit rate", "who can edit"…). */
  keywords?: string;
}

/** Pages and the places inside them, matched by name and by what people call them. */
const PLACES: Item[] = [
  { id: "p:dashboard", label: "Dashboard", kind: "Page", href: "#/dashboard", keywords: "home overview spend purchases cpa roas totals" },
  { id: "p:rankings", label: "Ad Rankings", kind: "Page", href: "#/rankings", keywords: "ads best top list" },
  { id: "p:pods", label: "Pods", kind: "Page", href: "#/pods", keywords: "hit rate harris dhia shameer ali compare" },
  { id: "p:insights", label: "Creative Insights", kind: "Page", href: "#/insights", keywords: "angles formats hooks what works make more of" },
  { id: "p:combos", label: "Combinations heatmap", kind: "Creative Insights", href: "#/insights?tab=combos", keywords: "persona awareness angle format matrix" },
  { id: "p:coverage", label: "Coverage Map", kind: "Page", href: "#/coverage", keywords: "persona awareness map gaps" },
  { id: "p:reports", label: "CS Reports", kind: "Page", href: "#/reports", keywords: "fortnightly report slack" },
  { id: "p:review", label: "To review", kind: "Page", href: "#/tagging", keywords: "needs tagging pod unassigned" },
  { id: "p:review-map", label: "Ads not on the coverage map", kind: "To review", href: "#/tagging?view=unplaced", keywords: "place persona awareness" },
  { id: "p:review-sugg", label: "Claude's suggestions", kind: "To review", href: "#/tagging?view=suggestions", keywords: "accept format pod suggested" },
  { id: "p:review-all", label: "Tag any ad", kind: "To review", href: "#/tagging?view=all", keywords: "edit tags all ads" },
  { id: "p:naming", label: "Naming Tool", kind: "Page", href: "#/naming", keywords: "ad name generate check" },
  { id: "s:targets", label: "Targets", kind: "Settings", href: "#/settings?tab=targets", keywords: "target cpa roas hit rule testing window late hit call" },
  { id: "s:pods", label: "Pods & editors", kind: "Settings", href: "#/settings?tab=pods", keywords: "roster editors add pod agency codes trybe" },
  { id: "s:personas", label: "Personas", kind: "Settings", href: "#/settings?tab=personas", keywords: "persona add merge suggested" },
  { id: "s:people", label: "People & access", kind: "Settings", href: "#/settings?tab=people", keywords: "who can edit edit list access" },
  { id: "s:data", label: "Data sources", kind: "Settings", href: "#/settings?tab=data", keywords: "meta connect sync token atria" },
];

const RECENT_KEY = "search-recent";

function readRecent(): Item[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Item[]).slice(0, 5);
  } catch {
    return [];
  }
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, " ");
/** Every word typed appears somewhere in the label or keywords. */
const matches = (it: Item, q: string) => {
  const hay = norm(`${it.label} ${it.kind} ${it.keywords ?? ""}`);
  return norm(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
};

/** The search box at the top of the sidebar, and the search panel it opens (also ⌘K / Ctrl+K). */
export function QuickSearch({ meta, iconOnly = false }: { meta: MetaResponse; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <>
      {iconOnly ? (
        <button type="button" onClick={() => setOpen(true)} className="tile" aria-label="Search" title={`Quick search (${mac ? "⌘K" : "Ctrl K"})`}>
          <Icon name="search" size={18} />
        </button>
      ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="field flex w-full items-center gap-2 text-left text-sm text-ink-3 hover:border-ink-3"
        aria-label="Search"
      >
        <Icon name="search" size={16} />
        <span className="flex-1">Quick search…</span>
        <kbd className="hidden border border-divider px-1 text-[11px] md:inline">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      )}
      {open && createPortal(<SearchPanel meta={meta} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function SearchPanel({ meta, onClose }: { meta: MetaResponse; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [at, setAt] = useState(0);
  const [recent] = useState(readRecent);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  // Ads are looked up as you type (after a short pause); everything else is matched here.
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const ads = useApi<RankingsResponse>(term.length >= 2 ? `/api/rankings?${qs({ range: "all", sort: "spend", q: term, limit: 8 })}` : null);
  const concepts = useApi<ConceptsResponse>(`/api/concepts?${qs({ range: "all" })}`);

  const local = useMemo<Item[]>(
    () => [
      ...PLACES.filter((p) => p.id !== "p:review" || meta.canEdit),
      ...meta.pods.map((p) => ({ id: `pod:${p.id}`, label: p.name, kind: p.kind === "agency" ? "Agency" : "Pod", href: "#/pods", keywords: "pod" })),
      ...meta.personas
        .filter((p) => p.status === "active")
        .map((p) => ({ id: `persona:${p.id}`, label: p.name, kind: "Persona", href: "#/coverage", keywords: `persona ${p.description}` })),
      ...(concepts.data?.rows ?? []).map((k) => ({
        id: `concept:${k.conceptId}`,
        label: k.label,
        kind: `Concept · ${meta.pods.find((p) => p.id === k.podId)?.name ?? "Agency"}`,
        href: conceptHref(k.conceptId),
        keywords: `concept ${k.adsetName ?? ""}`,
      })),
    ],
    [meta, concepts.data],
  );

  const results: { group: string; items: Item[] }[] = q.trim()
    ? [
        { group: "Pages & settings", items: local.filter((i) => (i.id.startsWith("p:") || i.id.startsWith("s:")) && matches(i, q)).slice(0, 6) },
        { group: "Pods & personas", items: local.filter((i) => (i.id.startsWith("pod:") || i.id.startsWith("persona:")) && matches(i, q)).slice(0, 5) },
        { group: "Concepts", items: local.filter((i) => i.id.startsWith("concept:") && matches(i, q)).slice(0, 6) },
        {
          group: "Ads",
          items: (term === q.trim() ? (ads.data?.items ?? []) : []).map((p) => ({
            id: `ad:${p.postId}`,
            label: p.name,
            kind: `Ad · ${money(p.totals.spendCents, { compact: true })} all-time`,
            href: `#/rankings?post=${encodeURIComponent(p.postId)}`,
          })),
        },
      ].filter((g) => g.items.length > 0)
    : [
        { group: "Recent", items: recent },
        { group: "Go to", items: PLACES.filter((p) => p.kind === "Page" && (p.id !== "p:review" || meta.canEdit)) },
      ].filter((g) => g.items.length > 0);
  const flat = results.flatMap((g) => g.items);
  const current = Math.min(at, Math.max(0, flat.length - 1));

  const go = (it: Item) => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([it, ...readRecent().filter((r) => r.id !== it.id)].slice(0, 5)));
    } catch {
      /* per-browser convenience only */
    }
    onClose();
    window.location.hash = it.href;
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setAt((current + 1) % Math.max(1, flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAt((current - 1 + flat.length) % Math.max(1, flat.length));
    } else if (e.key === "Enter" && flat[current]) go(flat[current]!);
  };

  let n = -1;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-2 pt-[10vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="flex max-h-[75vh] w-full max-w-[640px] flex-col border-2 border-divider bg-page shadow-xl" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="flex items-center gap-3 border-b-2 border-divider px-4 py-3">
          <Icon name="search" size={18} />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
            placeholder="Search ads, concepts, pods, personas, pages and settings…"
            className="min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
            aria-label="Search"
          />
          <kbd className="border border-divider px-1.5 text-[11px] text-ink-3">Esc</kbd>
        </div>
        <div className="overflow-y-auto py-2">
          {results.map((g) => (
            <div key={g.group} className="pb-2">
              <div className="kicker px-4 py-1">{g.group}</div>
              {g.items.map((it) => {
                n += 1;
                const i = n;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onMouseEnter={() => setAt(i)}
                    onClick={() => go(it)}
                    className={`flex w-full items-baseline gap-3 px-4 py-2 text-left ${i === current ? "bg-surface" : ""}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{it.label}</span>
                    <span className="shrink-0 text-xs text-ink-3">{it.kind}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {q.trim() && flat.length === 0 && (
            <p className="px-4 py-6 text-sm text-ink-3">{term !== q.trim() || ads.loading ? "Searching…" : "Nothing matches. Try part of an ad name, a concept or a page."}</p>
          )}
        </div>
        <div className="flex gap-4 border-t border-divider px-4 py-2 text-xs text-ink-3">
          <span>↑ ↓ to move</span>
          <span>↵ to open</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
