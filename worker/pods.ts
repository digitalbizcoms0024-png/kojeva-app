// Pods added in Settings live in the pods table (prefix + color slot); the built-in ones are in
// shared/taxonomy.ts. Every request and every attribution run loads them into the shared registry.
import { setAddedPods, type Group } from "../shared/taxonomy.ts";
import { memoize } from "./cache.ts";

export async function loadAddedPods(db: D1Database): Promise<Group[]> {
  const list = await memoize(db, "added-pods", async () => {
    const { results } = await db.prepare("SELECT id, code, name, color, prefix, slot FROM pods WHERE prefix IS NOT NULL ORDER BY slot").all<Group>();
    return results;
  });
  setAddedPods(list);
  return list;
}

/** pods.members: a JSON list of names; anything else reads as none. */
export function parseMembers(v: string | null): string[] {
  try {
    const list: unknown = v ? JSON.parse(v) : [];
    return Array.isArray(list) ? list.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}
