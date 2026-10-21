// The coverage map: every running ad placed by persona × awareness level, with each cell's
// spend, results and all-time concept track record. Read-only.
import type { ConceptResult, CoverageCell, CoveragePost, CoverageResponse, Persona, PostSummary, UnplacedReason } from "../shared/api.ts";
import { addTotals, hitRate, isHit, MIN_MAP_SPEND_CENTS, ZERO_TOTALS } from "../shared/metrics.ts";
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

  const spent = posts.filter((p) => p.totals.spendCents > 0);
  const small = spent.filter((p) => p.totals.spendCents < MIN_MAP_SPEND_CENTS);
  const running: CoveragePost[] = spent
    .filter((p) => p.totals.spendCents >= MIN_MAP_SPEND_CENTS)
    .map((p) => {
      const personaId = persona(p.assignment.personaId ?? p.labels.personaId);
      const awareness = level(p.assignment.awareness ?? p.labels.awareness);
      // One with awareness but no persona was judged to fit none; Claude labels the rest nightly.
      const why: UnplacedReason | null = personaId && awareness ? null : awareness && !personaId ? "none" : "waiting";
      return {
      postId: p.postId,
      name: p.name,
      thumbnailUrl: p.thumbnailUrl,
      mediaType: p.mediaType,
      podId: p.assignment.podId,
      totals: p.totals,
      personaId,
      awareness,
      offer: p.assignment.offer ?? p.labels.offer,
      hit: p.hit,
      why,
      };
    })
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
    if (p.offer != null) c.offerKnownSpendCents += p.totals.spendCents;
    if (p.offer) c.offerSpendCents += p.totals.spendCents;
  }
  const statuses = new Map<string, ConceptResult["status"][]>();
  for (const k of concepts) {
    const c = cell(persona(k.personaId), level(k.awareness));
    c.concepts++;
    if (isHit(k.status)) c.hits++;
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
    unplaced: running.filter((p) => p.why).length,
    unplacedSpendCents: running.filter((p) => p.why).reduce((n, p) => n + p.totals.spendCents, 0),
    unplacedTop: running
      .filter((p) => p.why)
      .slice(0, 3)
      .map((p) => ({ postId: p.postId, name: p.name, spendCents: p.totals.spendCents })),
    minSpendCents: MIN_MAP_SPEND_CENTS,
    small: { ads: small.length, spendCents: small.reduce((n, p) => n + p.totals.spendCents, 0) },
    unplacedWhy: {
      waiting: running.filter((p) => p.why === "waiting").length,
      none: running.filter((p) => p.why === "none").length,
    },
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
