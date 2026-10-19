// Read results kept until the data changes, in memory and in the `snapshots` table. D1's free
// plan allows 5M rows read a day and one uncached Dashboard view reads ~440k on live-sized data
// (scripts/measure-reads.ts), so repeat views, and fresh isolates after a deploy, must not recompute. The cache lives in the Worker
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

/** Marks stored data as changed (one row written) and drops the stored snapshots, now stale. */
export function bumpVersion(db: D1Database) {
  return db.batch([
    db.prepare("INSERT INTO settings (key, value) VALUES ('data_version', lower(hex(randomblob(8)))) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
    db.prepare("DELETE FROM snapshots"),
  ]);
}

// Snapshots: the same results stored in D1, shared by every isolate. Memory is per isolate and
// lost on each deploy; without these, every fresh isolate recomputed from ad_daily (~0.5–1M rows).
const MAX_SNAPSHOT_BYTES = 900_000;

/** A stored result for this data version (1 row read), or undefined. */
export async function readSnapshot(db: D1Database, key: string, version: string): Promise<string | undefined> {
  try {
    const row = await db.prepare("SELECT body FROM snapshots WHERE key = ?1 AND version = ?2").bind(key, version).first<{ body: string }>();
    return row?.body;
  } catch {
    return undefined; // e.g. before migration 0015 runs
  }
}

/** Stores a result for this data version (1 row written); too-large ones and failures are skipped. */
export async function writeSnapshot(db: D1Database, key: string, version: string, body: string): Promise<void> {
  if (body.length > MAX_SNAPSHOT_BYTES) return;
  try {
    await db
      .prepare("INSERT INTO snapshots (key, version, body) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET version = excluded.version, body = excluded.body")
      .bind(key, version, body)
      .run();
  } catch {
    // Not worth failing a read over; the next isolate recomputes.
  }
}

/** Empties this isolate's memory (tests and scripts/measure-reads.ts: a fresh isolate). */
export function forgetMemory() {
  current = "";
  responses.clear();
  memos.clear();
}

export function cachedResponse(key: string): string | undefined {
  return responses.get(key);
}

export function cacheResponse(key: string, body: string) {
  if (body.length > MAX_BODY_BYTES) return;
  if (responses.size >= MAX_ENTRIES) responses.delete(responses.keys().next().value!);
  responses.set(key, body);
}

/**
 * Computes `fn` once per data version (shared by every request until the data changes).
 * `durable` also stores the JSON result in D1 for other isolates; use it for plain data only.
 */
export async function memoize<T>(db: D1Database, name: string, fn: () => Promise<T>, opts: { durable?: boolean } = {}): Promise<T> {
  const version = await dataVersion(db);
  const key = `${version}|${name}`;
  let p = memos.get(key) as Promise<T> | undefined;
  if (!p) {
    p = opts.durable
      ? (async () => {
          const stored = await readSnapshot(db, `memo:${name}`, version);
          if (stored !== undefined) return JSON.parse(stored) as T;
          const value = await fn();
          await writeSnapshot(db, `memo:${name}`, version, JSON.stringify(value));
          return value;
        })()
      : fn();
    memos.set(key, p);
    p.catch(() => memos.delete(key));
  }
  return p;
}
