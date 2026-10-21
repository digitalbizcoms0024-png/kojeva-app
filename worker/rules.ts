// Re-credits every ad once after a deploy changes the crediting or concept rules, so nobody has
// to run a sync for the change to show. The fingerprint covers the rule code itself (function
// source, so any edit to it counts), its constants and the pods table; it's stored in settings.
// attribute() writes only rows whose pod, tags or concept changed.
import { attributePod, DEFAULT_ATTRIBUTION, podFromAdSetName } from "../shared/attribution.ts";
import { classify } from "../shared/classify.ts";
import { buildConcepts, ONE_CONCEPT_PER_AD, staticTitle } from "../shared/concepts.ts";
import { parseAdName } from "../shared/naming.ts";
import { PODS } from "../shared/taxonomy.ts";
import { bumpStats, memoize } from "./cache.ts";
import { attribute } from "./meta/sync.ts";
import { loadAddedPods } from "./pods.ts";

const CODE = [attributePod, podFromAdSetName, buildConcepts, staticTitle, classify, parseAdName].map((f) => f.toString()).join("\n");
const CONSTANTS = JSON.stringify([PODS, DEFAULT_ATTRIBUTION, [...ONE_CONCEPT_PER_AD]]);

/** FNV-1a, enough to tell two rule sets apart. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function ensureAttributed(db: D1Database): Promise<void> {
  return memoize(db, "rules-check", async () => {
    const pods = await loadAddedPods(db);
    const fingerprint = hash(`${CODE}\n${CONSTANTS}\n${JSON.stringify(pods.map((p) => [p.id, p.code, p.prefix]))}`);
    const stored = await db.prepare("SELECT value FROM settings WHERE key = 'rules_fingerprint'").first<{ value: string }>();
    if (stored?.value === fingerprint) return;
    await attribute(db);
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('rules_fingerprint', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(fingerprint)
      .run();
    await bumpStats(db);
  });
}
