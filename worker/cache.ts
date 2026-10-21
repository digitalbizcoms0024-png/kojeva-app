// Read results kept until the data changes, in memory and in the `snapshots` table. D1's free
// plan allows 5M rows read a day and recomputing from ad_daily costs hundreds of thousands, so
// repeat views, and fresh isolates after a deploy, must not recompute.
//
// Two versions:
// - `stats_version`: the ad numbers (ad_daily, which ads form which concept, the targets). Bumped
//   by a sync that wrote rows, a change in concept membership, or new targets (`bumpStats`). The
//   heavy loaders (concept results, test windows, fatigue, range totals) are memoized under it
//   (`scope: "stats"`), so they are computed once per sync, not once per edit.
// - `data_version`: anything shown (tags, pods, personas, Atria labels, the numbers too). Bumped by
//   every write (`bumpVersion`); responses and label loaders are cached under it, and recompute
//   cheaply on top of the stats.

const MAX_ENTRIES = 150;
const MAX_BODY_BYTES = 3_000_000;

let current = "";
let currentStats = "";
const responses = new Map<string, string>();
const memos = new Map<string, Promise<unknown>>();
const statsMemos = new Map<string, Promise<unknown>>();

/** Both versions (2 rows read); clears what this isolate kept under older ones. */
async function versions(db: D1Database): Promise<{ data: string; stats: string }> {
  const { results } = await db
    .prepare("SELECT key, value FROM settings WHERE key IN ('data_version', 'stats_version')")
    .all<{ key: string; value: string }>();
  const data = results.find((r) => r.key === "data_version")?.value ?? "none";
  const stats = results.find((r) => r.key === "stats_version")?.value ?? "none";
  if (data !== current) {
    current = data;
    responses.clear();
    memos.clear();
  }
  if (stats !== currentStats) {
    currentStats = stats;
    statsMemos.clear();
  }
  return { data, stats };
}

/** The current data version. */
export async function dataVersion(db: D1Database): Promise<string> {
  return (await versions(db)).data;
}

const NEW_VERSION = (key: string) =>
  `INSERT INTO settings (key, value) VALUES ('${key}', lower(hex(randomblob(8)))) ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

/** Marks shown data as changed (one row written); drops stored responses but keeps the stats. */
export function bumpVersion(db: D1Database) {
  return db.batch([db.prepare(NEW_VERSION("data_version")), db.prepare("DELETE FROM snapshots WHERE key NOT LIKE 'stats:%'")]);
}

/** Marks the ad numbers as changed too: everything is recomputed once. */
export function bumpStats(db: D1Database) {
  return db.batch([db.prepare(NEW_VERSION("data_version")), db.prepare(NEW_VERSION("stats_version")), db.prepare("DELETE FROM snapshots")]);
}

// Snapshots: the same results stored in D1, shared by every isolate. Memory is per isolate and
// lost on each deploy; without these, every fresh isolate recomputed from ad_daily (~0.5–1M rows).
const MAX_SNAPSHOT_BYTES = 900_000;

// Large results are stored gzipped (base64, "gz:" prefix): the post list with its tags outgrew the
// size cap once most creatives had Atria tags and labels, and was then rebuilt on every request.
const COMPRESS_FROM = 64_000;

async function gzip(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `gz:${btoa(bin)}`;
}

async function gunzip(stored: string): Promise<string> {
  const bin = atob(stored.slice(3));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

/** A stored result for this data version (1 row read), or undefined. */
export async function readSnapshot(db: D1Database, key: string, version: string): Promise<string | undefined> {
  try {
    const row = await db.prepare("SELECT body FROM snapshots WHERE key = ?1 AND version = ?2").bind(key, version).first<{ body: string }>();
    if (!row) return undefined;
    return row.body.startsWith("gz:") ? await gunzip(row.body) : row.body;
  } catch {
    return undefined; // e.g. before migration 0015 runs
  }
}

/** Stores a result for this data version (1 row written); too-large ones and failures are skipped. */
export async function writeSnapshot(db: D1Database, key: string, version: string, text: string): Promise<void> {
  const body = text.length >= COMPRESS_FROM ? await gzip(text) : text;
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
  currentStats = "";
  responses.clear();
  memos.clear();
  statsMemos.clear();
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
 * Computes `fn` once per version (shared by every request until it changes).
 * - `scope: "stats"` keys it on the ad numbers only, so edits don't recompute it. Use it only for
 *   results that depend on nothing but ad_daily, ads (status, concept), concepts and the targets.
 * - `durable` also stores the JSON result in D1 for other isolates; use it for plain data only.
 */
/**
 * The deployed Worker version (set per request from version_metadata). Results computed per edit
 * are stored under it too, so a result saved by the previous code just before a deploy is never
 * served by the new code. The per-sync stats keep their own versioning (and rules fingerprint).
 */
let deployed = "";
export function setDeployedVersion(id: string | undefined) {
  deployed = id ?? "";
}

export async function memoize<T>(
  db: D1Database,
  name: string,
  fn: () => Promise<T>,
  opts: { durable?: boolean; scope?: "data" | "stats" } = {},
): Promise<T> {
  const v = await versions(db);
  const stats = opts.scope === "stats";
  const version = stats ? v.stats : v.data;
  const store = stats ? statsMemos : memos;
  const stored = stats ? `stats:${name}` : `memo:${deployed ? `${deployed}|` : ""}${name}`;
  const key = `${version}|${name}`;
  let p = store.get(key) as Promise<T> | undefined;
  if (!p) {
    p = opts.durable
      ? (async () => {
          const body = await readSnapshot(db, stored, version);
          if (body !== undefined) return JSON.parse(body) as T;
          const value = await fn();
          await writeSnapshot(db, stored, version, JSON.stringify(value));
          return value;
        })()
      : fn();
    store.set(key, p);
    p.catch(() => store.delete(key));
  }
  return p;
}

/** A Map through a durable memo (stored as entries). */
export async function memoizeMap<K, V>(
  db: D1Database,
  name: string,
  fn: () => Promise<Map<K, V>>,
  opts: { durable?: boolean; scope?: "data" | "stats" } = {},
): Promise<Map<K, V>> {
  return new Map(await memoize(db, name, async () => [...(await fn())], opts));
}
