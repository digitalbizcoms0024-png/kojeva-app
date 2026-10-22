// Winning creatives that are no longer running: shared by the Dashboard alert and the Rankings
// "Hits turned off" filter. Computed from stored data (read-only), once per data version.
import type { ConceptResult } from "../shared/api.ts";
import { isHit } from "../shared/metrics.ts";
import { memoize } from "./cache.ts";
import { shiftDay } from "./queries.ts";

/** Meta statuses (effective_status) that mean the ad isn't delivering because it was turned off. */
export const OFF_STATUSES: Record<string, string> = {
  PAUSED: "paused",
  ADSET_PAUSED: "ad set paused",
  CAMPAIGN_PAUSED: "campaign paused",
  ARCHIVED: "archived",
  DELETED: "deleted",
  DISAPPROVED: "disapproved",
  WITH_ISSUES: "has issues",
};

/** Week-before spend (all copies) below which a winner wasn't really running, so stopping isn't news. */
export const RUNNING_MIN_CENTS = 2000;

export interface HitCopy {
  postId: string;
  name: string;
  where: string;
  /** Why it isn't running ("paused", "no spend in 3 days", …); null while it runs. */
  off: string | null;
  /** Spend in the 7 days before the last 3 synced days. */
  beforeCents: number;
}

export interface HitCreative {
  concept: ConceptResult;
  /** Posts of the concept's testing ads (where the hit badge shows). */
  testPosts: string[];
  copies: HitCopy[];
  /** Nothing tested in the concept runs anywhere: every copy is off in Meta or spent nothing in the last 3 synced days. */
  offEverywhere: boolean;
  /** Off everywhere, after spending at least $20 in the week before: just turned off. */
  turnedOffRecently: boolean;
}

/**
 * Every concept that won (hit or late hit), with all copies of every creative tested in it: the same
 * video or image (`asset_id`, else the same post) in any ad set. A concept counts as turned off only
 * when all of them have stopped: pausing the weak variations of a winning ad set while its winner
 * keeps running isn't news (owner, Oct 22).
 */
export async function loadHitCreatives(db: D1Database, concepts: ConceptResult[], latest: string): Promise<HitCreative[]> {
  // Statuses and spend change only with a sync, so this is computed once per sync (stats version)
  // and joined to the current concept labels here.
  const byId = new Map(concepts.map((k) => [k.conceptId, k]));
  const stored = await memoize(
    db,
    `hit-creatives-${latest}`,
    async () => (await compute(db, concepts, latest)).map(({ concept, ...h }) => ({ ...h, conceptId: concept.conceptId })),
    { durable: true, scope: "stats" },
  );
  return stored.flatMap(({ conceptId, ...h }) => (byId.has(conceptId) ? [{ ...h, concept: byId.get(conceptId)! }] : []));
}

async function compute(db: D1Database, concepts: ConceptResult[], latest: string): Promise<HitCreative[]> {
  const hits = new Map(concepts.filter((k) => isHit(k.status)).map((k) => [k.conceptId, k]));
  if (hits.size === 0) return [];
  const recentFrom = shiftDay(latest, -2);
  // Each ad's days come by key (see CLAUDE.md on D1 reads).
  const { results } = await db
    .prepare(
      `SELECT a.id, a.post_id, a.asset_id, a.concept_id, a.name, a.campaign_name, a.adset_name, a.status,
         (SELECT SUM(d.spend_cents) FROM ad_daily d WHERE d.ad_id = a.id AND d.date BETWEEN ?1 AND ?2) AS before_cents,
         (SELECT SUM(d.spend_cents) FROM ad_daily d WHERE d.ad_id = a.id AND d.date >= ?3) AS recent_cents
       FROM ads a`,
    )
    .bind(shiftDay(latest, -9), shiftDay(latest, -3), recentFrom)
    .all<{
      post_id: string;
      asset_id: string | null;
      concept_id: string | null;
      name: string;
      campaign_name: string | null;
      adset_name: string | null;
      status: string;
      before_cents: number | null;
      recent_cents: number | null;
    }>();
  const creative = (r: { asset_id: string | null; post_id: string }) => r.asset_id ?? `post:${r.post_id}`;

  // Each winning concept, with the creatives tested in it (and where they were tested).
  const won = new Map<string, { concept: ConceptResult; testPosts: Set<string>; copies: HitCopy[] }>();
  const conceptsOf = new Map<string, Set<string>>(); // creative → winning concepts it was tested in
  for (const r of results) {
    const k = r.concept_id ? hits.get(r.concept_id) : undefined;
    if (!k) continue;
    const entry = won.get(k.conceptId) ?? { concept: k, testPosts: new Set<string>(), copies: [] };
    entry.testPosts.add(r.post_id);
    won.set(k.conceptId, entry);
    conceptsOf.set(creative(r), (conceptsOf.get(creative(r)) ?? new Set()).add(k.conceptId));
  }
  for (const r of results) {
    for (const conceptId of conceptsOf.get(creative(r)) ?? []) {
      won.get(conceptId)!.copies.push({
        postId: r.post_id,
        name: r.name,
        where: r.campaign_name ?? r.adset_name ?? "",
        off: OFF_STATUSES[r.status] ?? (Number(r.recent_cents ?? 0) > 0 ? null : "no spend in 3 days"),
        beforeCents: Number(r.before_cents ?? 0),
      });
    }
  }
  return [...won.values()].map(({ concept, testPosts, copies }) => {
    const offEverywhere = copies.every((c) => c.off);
    return {
      concept,
      testPosts: [...testPosts],
      copies: copies.sort((a, b) => b.beforeCents - a.beforeCents),
      offEverywhere,
      turnedOffRecently: offEverywhere && copies.reduce((n, c) => n + c.beforeCents, 0) >= RUNNING_MIN_CENTS,
    };
  });
}
