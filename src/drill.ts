// Side cards live in the URL hash, on top of whatever page is open: "#/insights?drill=…" opens a
// group of concepts (an Insights row, a heatmap cell, a Coverage cell, a launch week), and
// "&concept=<id>" a concept's card on top of it. So links are shareable and Back closes them.

/** A group of concepts: an /api/concepts filter and the range it's read over. */
export interface DrillSpec {
  title: string;
  /** A range key ("month", "all", "custom:2026-10-05:2026-10-11"). */
  range: string;
  filter: Record<string, string>;
  /** A Coverage Map cell also lists its running ads, over the map's own range. */
  coverage?: { range: string; pod: string };
}

const KEYS = ["drill", "dt", "dr", "dc", "dcp", "concept"];

function current() {
  const [page = "", q = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  return { page: page || "dashboard", params: new URLSearchParams(q) };
}

const build = (page: string, params: URLSearchParams) => {
  const q = params.toString();
  return `#/${page}${q ? `?${q}` : ""}`;
};

/** Opens a group's side card over the current page (closing any concept card). */
export function drillHref(spec: DrillSpec): string {
  const { page, params } = current();
  for (const k of KEYS) params.delete(k);
  const filter = new URLSearchParams(Object.entries(spec.filter).filter(([, v]) => v !== ""));
  params.set("drill", filter.toString());
  params.set("dt", spec.title);
  params.set("dr", spec.range);
  if (spec.coverage) {
    params.set("dc", spec.coverage.range);
    params.set("dcp", spec.coverage.pod);
  }
  return build(page, params);
}

export function openDrill(spec: DrillSpec) {
  window.location.hash = drillHref(spec);
}

/** The open group, if the URL has one. */
export function readDrill(params: URLSearchParams): DrillSpec | null {
  const raw = params.get("drill");
  if (raw == null) return null;
  return {
    title: params.get("dt") ?? "Concepts",
    range: params.get("dr") ?? "all",
    filter: Object.fromEntries(new URLSearchParams(raw)),
    coverage: params.has("dc") ? { range: params.get("dc")!, pod: params.get("dcp") ?? "" } : undefined,
  };
}

/** A concept's card over the current page, keeping an open group underneath (← Back returns to it). */
export function conceptHref(conceptId: string): string {
  const { page, params } = current();
  params.set("concept", conceptId);
  return build(page, params);
}

/** The current page with the side-card keys removed (all of them, or just the concept card). */
export function closeHref(only?: "concept"): string {
  const { page, params } = current();
  for (const k of only ? [only] : KEYS) params.delete(k);
  return build(page, params);
}
