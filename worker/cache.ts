// Read results kept in memory until the data changes. D1's free plan allows 5M rows read a day
// and one uncached Dashboard view reads a few hundred thousand (every concept and ad window is
// recomputed from ad_daily), so repeat views must not hit D1 again. The cache lives in the Worker
// isolate: free, and lost when the isolate is recycled, which only costs one recompute.
// Every write bumps `data_version` (one row), which drops everything cached under the old one.

const MAX_ENTRIES = 150;
const MAX_BODY_BYTES = 3_000_000;

let current = "";
const responses = new Map<string, string>();
const memos = new Map<string, Promise<unknown>>();

/** The current data version (1 row read). */
export async function dataVersion(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'data_version'").first<{ value: string }>();
  const v = row?.value ?? "none";
  if (v !== current) {
    current = v;
    responses.clear();
    memos.clear();
  }
  return v;
}

/** Marks stored data as changed (one row written). */
export function bumpVersion(db: D1Database) {
  return db
    .prepare("INSERT INTO settings (key, value) VALUES ('data_version', lower(hex(randomblob(8)))) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run();
}

export function cachedResponse(key: string): string | undefined {
  return responses.get(key);
}

export function cacheResponse(key: string, body: string) {
  if (body.length > MAX_BODY_BYTES) return;
  if (responses.size >= MAX_ENTRIES) responses.delete(responses.keys().next().value!);
  responses.set(key, body);
}

/** Computes `fn` once per data version (shared by every request until the data changes). */
export async function memoize<T>(db: D1Database, name: string, fn: () => Promise<T>): Promise<T> {
  const key = `${await dataVersion(db)}|${name}`;
  let p = memos.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn();
    memos.set(key, p);
    p.catch(() => memos.delete(key));
  }
  return p;
}
