// Winning creatives that are no longer running: shared by the Dashboard alert and the Rankings
// "Hits turned off" filter. Computed from stored data (read-only), once per data version.
import type { ConceptResult } from "../shared/api.ts";
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
  /** No copy anywhere is running: each is off in Meta or spent nothing in the last 3 synced days. */
  offEverywhere: boolean;
  /** Off everywhere, after spending at least $20 in the week before: just turned off. */
  turnedOffRecently: boolean;
}

/**
 * Every creative that won a concept (hit or late hit), with all its copies: the same video or image
 * (`asset_id`, else the same post) in any ad set.
 */
export function loadHitCreatives(db: D1Database, concepts: ConceptResult[], latest: string): Promise<HitCreative[]> {
  return memoize(db, `hit-creatives-${latest}`, () => compute(db, concepts, latest));
}

async function compute(db: D1Database, concepts: ConceptResult[], latest: string): Promise<HitCreative[]> {
  const hits = new Map(concepts.filter((k) => k.status === "hit" || k.status === "late_hit").map((k) => [k.conceptId, k]));
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

  const won = new Map<string, { concept: ConceptResult; testPosts: Set<string>; copies: HitCopy[] }>();
  for (const r of results) {
    const k = r.concept_id ? hits.get(r.concept_id) : undefined;
    if (!k) continue;
    const entry = won.get(creative(r)) ?? { concept: k, testPosts: new Set(), copies: [] };
    entry.testPosts.add(r.post_id);
    won.set(creative(r), entry);
  }
  for (const r of results) {
    const entry = won.get(creative(r));
    if (!entry) continue;
    entry.copies.push({
      postId: r.post_id,
      name: r.name,
      where: r.campaign_name ?? r.adset_name ?? "",
      off: OFF_STATUSES[r.status] ?? (Number(r.recent_cents ?? 0) > 0 ? null : "no spend in 3 days"),
      beforeCents: Number(r.before_cents ?? 0),
    });
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
