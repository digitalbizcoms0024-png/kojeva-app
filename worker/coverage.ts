// The coverage map: every running ad placed by persona × awareness level, with each cell's
// spend, results and all-time concept track record. Read-only.
import type { ConceptResult, CoverageCell, CoveragePost, CoverageResponse, Persona, PostSummary } from "../shared/api.ts";
import { addTotals, addTw, hitRate, ZERO_TOTALS, ZERO_TW } from "../shared/metrics.ts";
import { AWARENESS } from "../shared/taxonomy.ts";
import { loadPersonas } from "./personas.ts";
import { loadConcepts, loadPosts } from "./queries.ts";

const key = (personaId: string | null, awareness: string | null) => `${personaId ?? "-"}|${awareness ?? "-"}`;

/** Pure: builds the grid from posts, concepts and the active personas. */
export function buildCoverage(posts: PostSummary[], concepts: ConceptResult[], personas: Persona[], range: { from: string; to: string }): CoverageResponse {
  const active = personas.filter((p) => p.status === "active");
  const known = new Set(active.map((p) => p.id));
  const persona = (id: string | null) => (id && known.has(id) ? id : null);
  const level = (v: string | null) => (v && v in AWARENESS ? v : null);

  const running: CoveragePost[] = posts
    .filter((p) => p.totals.spendCents > 0)
    .map((p) => ({
      postId: p.postId,
      name: p.name,
      thumbnailUrl: p.thumbnailUrl,
      mediaType: p.mediaType,
      podId: p.assignment.podId,
      totals: p.totals,
      tw: p.tw,
      personaId: persona(p.assignment.personaId ?? p.labels.personaId),
      awareness: level(p.assignment.awareness ?? p.labels.awareness),
      offer: p.assignment.offer ?? p.labels.offer,
      hit: p.hit,
    }))
    .sort((a, b) => b.totals.spendCents - a.totals.spendCents);

  const cells = new Map<string, CoverageCell>();
  const cell = (personaId: string | null, awareness: string | null) => {
    const k = key(personaId, awareness);
    let c = cells.get(k);
    if (!c) {
      c = {
        personaId,
        awareness,
        ads: 0,
        totals: ZERO_TOTALS,
        tw: null,
        offerSpendCents: 0,
        offerKnownSpendCents: 0,
        concepts: 0,
        hits: 0,
        misses: 0,
        testing: 0,
        hitRate: null,
      };
      cells.set(k, c);
    }
    return c;
  };
  for (const p of running) {
    const c = cell(p.personaId, p.awareness);
    c.ads++;
    c.totals = addTotals(c.totals, p.totals);
    if (p.tw) c.tw = addTw(c.tw ?? ZERO_TW, p.tw);
    if (p.offer != null) c.offerKnownSpendCents += p.totals.spendCents;
    if (p.offer) c.offerSpendCents += p.totals.spendCents;
  }
  const statuses = new Map<string, ConceptResult["status"][]>();
  for (const k of concepts) {
    const c = cell(persona(k.personaId), level(k.awareness));
    c.concepts++;
    if (k.status === "hit" || k.status === "late_hit") c.hits++;
    if (k.status === "miss") c.misses++;
    if (k.status === "testing") c.testing++;
    const ck = key(c.personaId, c.awareness);
    statuses.set(ck, [...(statuses.get(ck) ?? []), k.status]);
  }
  for (const [k, c] of cells) c.hitRate = hitRate(statuses.get(k) ?? []);

  const totals = running.reduce((acc, p) => addTotals(acc, p.totals), ZERO_TOTALS);
  const placed = [...cells.values()].filter((c) => c.personaId && c.awareness);
  const best = placed.filter((c) => c.ads > 0).sort((a, b) => b.totals.spendCents - a.totals.spendCents)[0];
  return {
    ...range,
    personas: active,
    totals,
    cells: [...cells.values()],
    posts: running,
    defined: active.length * Object.keys(AWARENESS).length,
    filled: placed.filter((c) => c.ads > 0).length,
    top:
      best && totals.spendCents > 0
        ? {
            personaId: best.personaId!,
            awareness: best.awareness!,
            share: best.totals.spendCents / totals.spendCents,
            offerShare: best.offerKnownSpendCents > 0 ? best.offerSpendCents / best.offerKnownSpendCents : null,
          }
        : null,
    unplaced: running.filter((p) => !p.personaId || !p.awareness).length,
  };
}

/** The grid for posts that spent in [from, to], optionally for one pod (or "agency" / "unassigned"). */
export async function loadCoverage(db: D1Database, from: string, to: string, pod?: string, loaded?: ConceptResult[]): Promise<CoverageResponse> {
  const [concepts, personas] = await Promise.all([loaded ?? loadConcepts(db), loadPersonas(db)]);
  const posts = await loadPosts(db, from, to, { concepts });
  const byPod = <T extends { podId: string | null }>(x: T) => !pod || (pod === "unassigned" ? !x.podId : x.podId === pod);
  return buildCoverage(
    posts.filter((p) => byPod({ podId: p.assignment.podId })),
    concepts.filter(byPod),
    personas,
    { from, to },
  );
}
