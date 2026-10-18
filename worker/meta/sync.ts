// Pulls ads and daily insights from Meta into D1. See docs/ROADMAP.md → Phase 1.
import { bumpVersion } from "../cache.ts";
import { loadAddedPods } from "../pods.ts";
import { attributePod, DEFAULT_ATTRIBUTION, detectPodsStart, type AttributionSettings } from "../../shared/attribution.ts";
import { classify } from "../../shared/classify.ts";
import { buildConcepts } from "../../shared/concepts.ts";
import { parseAdName } from "../../shared/naming.ts";
import { podByCode, type PodCode } from "../../shared/taxonomy.ts";
import { decrypt } from "../crypto.ts";
import type { Env } from "../env.ts";
import { GraphError, graphClient, type GraphClient } from "./graph.ts";
import { assetIdFor, COMPARE_WINDOWS, insightToDaily, insightToWindows, isoTime, mediaTypeFor, postIdFor, thumbnailFor, type GraphAd, type GraphInsight } from "./transform.ts";

const AD_FIELDS =
  "id,name,status,effective_status,created_time,adset{id,name},campaign{id,name}," +
  "creative{id,effective_object_story_id,thumbnail_url,image_url,object_type,video_id,image_hash}";
const INSIGHT_FIELDS =
  "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,inline_link_clicks,actions,action_values";
const ALL_STATUSES = [
  "ACTIVE", "PAUSED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "DISAPPROVED",
  "PENDING_REVIEW", "WITH_ISSUES", "IN_PROCESS", "PREAPPROVED", "PENDING_BILLING_INFO",
];
const BATCH = 100;

/** Longest window one sync request may cover, to stay inside Worker time limits. */
export const MAX_WINDOW_DAYS = 31;

async function runBatched(db: D1Database, stmts: D1PreparedStatement[]) {
  for (let i = 0; i < stmts.length; i += BATCH) await db.batch(stmts.slice(i, i + BATCH));
}

export async function getToken(env: Env, db: D1Database): Promise<string | null> {
  if (env.META_SYSTEM_TOKEN) return env.META_SYSTEM_TOKEN;
  if (!env.TOKEN_KEY) return null;
  const row = await db
    .prepare("SELECT token_cipher, token_iv FROM meta_connections WHERE id = 1")
    .first<{ token_cipher: string; token_iv: string }>();
  return row ? decrypt(row.token_cipher, row.token_iv, env.TOKEN_KEY) : null;
}

export function clientFor(env: Env, token: string, fetcher?: typeof fetch): GraphClient {
  return graphClient({ token, version: env.META_GRAPH_VERSION, appSecret: env.META_APP_SECRET, fetcher });
}

/** Removes the sample dataset. Runs once, when Meta is first connected. */
export async function wipeSampleData(db: D1Database) {
  const live = await db.prepare("SELECT 1 FROM sync_runs WHERE source = 'meta' LIMIT 1").first();
  if (live) return false;
  await db.batch([
    db.prepare("DELETE FROM ad_daily"),
    db.prepare("DELETE FROM assignments"),
    db.prepare("DELETE FROM ads"),
    db.prepare("DELETE FROM posts"),
    db.prepare("DELETE FROM editors"),
    db.prepare("DELETE FROM personas"),
    db.prepare("DELETE FROM sync_runs WHERE source = 'sample'"),
  ]);
  return true;
}

// Writes are the scarce resource (D1 free plan: 100k rows written/day), so every step below
// reads what's stored and writes only rows that changed.

type AdRow = {
  id: string;
  post_id: string;
  name: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  status: string;
  created_time: string | null;
  creative_id: string | null;
  asset_id: string | null;
};
type PostRow = { id: string; media_type: string; thumbnail_url: string | null; created_time: string | null };

const AD_COLS = ["post_id", "name", "campaign_id", "campaign_name", "adset_id", "adset_name", "status", "created_time", "creative_id", "asset_id"] as const;

const same = <T extends object>(a: T, b: T, keys: readonly (keyof T)[]) => keys.every((k) => (a[k] ?? null) === (b[k] ?? null));

/** Meta CDN URLs carry their expiry as hex seconds in `oe`. Keep a stored thumbnail until it's close. */
export function thumbnailNeedsRefresh(stored: string | null, now = Date.now()): boolean {
  if (!stored) return true;
  const oe = /[?&]oe=([0-9a-f]+)/i.exec(stored)?.[1];
  return oe ? parseInt(oe, 16) * 1000 < now + 3 * 86_400_000 : false;
}

/** Upserts every ad (all statuses) and its post, then re-attributes pods, tags and concepts. */
export async function syncAds(env: Env, db: D1Database, gc: GraphClient) {
  const now = new Date().toISOString();
  const [{ results: storedAds }, { results: storedPosts }] = await Promise.all([
    db.prepare(`SELECT id, ${AD_COLS.join(", ")} FROM ads`).all<AdRow>(),
    db.prepare("SELECT id, media_type, thumbnail_url, created_time FROM posts").all<PostRow>(),
  ]);
  const oldAds = new Map(storedAds.map((a) => [a.id, a]));
  const oldPosts = new Map(storedPosts.map((p) => [p.id, p]));

  const posts = new Map<string, PostRow>();
  const ads: AdRow[] = [];
  for await (const page of gc.pages<GraphAd>(`${env.META_AD_ACCOUNT_ID}/ads`, {
    fields: AD_FIELDS,
    limit: "200",
    filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ALL_STATUSES }]),
  })) {
    for (const ad of page) {
      const postId = postIdFor(ad);
      const created = isoTime(ad.created_time);
      const prev = posts.get(postId);
      posts.set(postId, {
        id: postId,
        media_type: mediaTypeFor(ad),
        thumbnail_url: prev?.thumbnail_url ?? thumbnailFor(ad),
        created_time: prev?.created_time && created ? (prev.created_time < created ? prev.created_time : created) : (prev?.created_time ?? created),
      });
      ads.push({
        id: ad.id,
        post_id: postId,
        name: ad.name,
        campaign_id: ad.campaign?.id ?? null,
        campaign_name: ad.campaign?.name ?? null,
        adset_id: ad.adset?.id ?? null,
        adset_name: ad.adset?.name ?? null,
        status: ad.effective_status ?? ad.status ?? "UNKNOWN",
        created_time: created,
        creative_id: ad.creative?.id ?? null,
        asset_id: assetIdFor(ad),
      });
    }
  }

  const postStmts: D1PreparedStatement[] = [];
  for (const p of posts.values()) {
    const old = oldPosts.get(p.id);
    const created = old?.created_time && p.created_time ? (old.created_time < p.created_time ? old.created_time : p.created_time) : (old?.created_time ?? p.created_time);
    const thumb = old && !thumbnailNeedsRefresh(old.thumbnail_url) ? old.thumbnail_url : (p.thumbnail_url ?? old?.thumbnail_url ?? null);
    const next = { ...p, thumbnail_url: thumb, created_time: created };
    if (old && same(old, next, ["media_type", "thumbnail_url", "created_time"])) continue;
    postStmts.push(
      db
        .prepare(
          `INSERT INTO posts (id, media_type, thumbnail_url, created_time) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(id) DO UPDATE SET media_type = excluded.media_type, thumbnail_url = excluded.thumbnail_url,
             created_time = excluded.created_time`,
        )
        .bind(next.id, next.media_type, next.thumbnail_url, next.created_time),
    );
  }

  const adStmts: D1PreparedStatement[] = [];
  for (const a of ads) {
    const old = oldAds.get(a.id);
    if (old && same(old, a, AD_COLS)) continue;
    adStmts.push(
      db
        .prepare(
          `INSERT INTO ads (id, post_id, name, campaign_id, campaign_name, adset_id, adset_name, status, created_time, creative_id, asset_id, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
           ON CONFLICT(id) DO UPDATE SET post_id = excluded.post_id, name = excluded.name,
             campaign_id = excluded.campaign_id, campaign_name = excluded.campaign_name,
             adset_id = excluded.adset_id, adset_name = excluded.adset_name, status = excluded.status,
             created_time = excluded.created_time, creative_id = excluded.creative_id, asset_id = excluded.asset_id,
             updated_at = excluded.updated_at`,
        )
        .bind(a.id, a.post_id, a.name, a.campaign_id, a.campaign_name, a.adset_id, a.adset_name, a.status, a.created_time, a.creative_id, a.asset_id, now),
    );
  }

  // Posts before ads (foreign key), then ads.
  await runBatched(db, postStmts);
  await runBatched(db, adStmts);
  const changed = postStmts.length + adStmts.length;
  await attribute(db);
  await removeOrphanPosts(db);
  return { ads: ads.length, posts: posts.size, written: changed };
}

type AssignmentRow = {
  post_id: string;
  pod_id: string | null;
  pod_source: string | null;
  angle: string | null;
  format: string | null;
  hook: string | null;
  landing_page: string | null;
  tags_source: string | null;
};
const ASSIGN_COLS = ["pod_id", "pod_source", "angle", "format", "hook", "landing_page", "tags_source"] as const;

async function setSetting(db: D1Database, key: string, value: unknown) {
  const json = JSON.stringify(value);
  const old = await db.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first<{ value: string }>();
  if (old?.value === json) return;
  await db.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, json).run();
}

/** Recomputes pod, tags and concepts for every post, never touching manual values. */
export async function attribute(db: D1Database) {
  await loadAddedPods(db);
  const [{ results: ads }, { results: stored }, prefix, attr] = await Promise.all([
    db.prepare("SELECT id, post_id, name, adset_id, adset_name, created_time, concept_id FROM ads").all<{
      id: string;
      post_id: string;
      name: string;
      adset_id: string | null;
      adset_name: string | null;
      created_time: string | null;
      concept_id: string | null;
    }>(),
    db.prepare(`SELECT post_id, ${ASSIGN_COLS.join(", ")} FROM assignments`).all<AssignmentRow>(),
    db.prepare("SELECT value FROM settings WHERE key = 'legacy_prefix_map'").first<{ value: string }>(),
    db.prepare("SELECT value FROM settings WHERE key = 'attribution'").first<{ value: string }>(),
  ]);
  const prefixMap = prefix ? (JSON.parse(prefix.value) as Record<string, PodCode>) : {};
  const settings: AttributionSettings = { ...DEFAULT_ATTRIBUTION, ...(attr ? JSON.parse(attr.value) : {}) };
  if (!settings.podsStartDate) {
    settings.podsStartDate = detectPodsStart(
      ads.map((a) => ({ name: a.name, adsetName: a.adset_name, createdTime: a.created_time })),
    );
    // Shown in Settings so the team can check the detected date.
    await setSetting(db, "pods_start_detected", settings.podsStartDate);
  }
  const oldAssign = new Map(stored.map((a) => [a.post_id, a]));

  const byPost = new Map<string, typeof ads>();
  for (const a of ads) byPost.set(a.post_id, [...(byPost.get(a.post_id) ?? []), a]);

  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const [postId, list] of byPost) {
    const pod = attributePod(
      list.map((a) => ({ name: a.name, adsetName: a.adset_name, createdTime: a.created_time })),
      prefixMap,
      settings,
    );
    const origin = [...list].sort((a, b) => (a.created_time ?? "").localeCompare(b.created_time ?? ""))[0]!;
    const parsed = parseAdName(origin.name);
    // Ad names rarely carry tags; the testing ad set's name usually does ("… | STATIC | Scarcity").
    const guess = classify({ adset: origin.adset_name, ads: [origin.name] });
    const tags = { ...parsed, angle: parsed.angle ?? guess.angle, format: parsed.format ?? guess.format };
    const old = oldAssign.get(postId);
    const keepPod = old?.pod_source === "manual";
    const keepTags = old?.tags_source === "manual";
    const next: AssignmentRow = {
      post_id: postId,
      pod_id: keepPod ? old!.pod_id : pod ? podByCode(pod.podCode)!.id : null,
      pod_source: keepPod ? "manual" : (pod?.source ?? null),
      angle: keepTags ? old!.angle : tags.angle,
      format: keepTags ? old!.format : tags.format,
      hook: keepTags ? old!.hook : tags.hook,
      landing_page: keepTags ? old!.landing_page : tags.landingPage,
      tags_source: keepTags ? "manual" : "name",
    };
    if (old && same(old, next, ASSIGN_COLS)) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO assignments (post_id, pod_id, pod_source, angle, format, hook, landing_page, tags_source, updated_at, updated_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'sync')
           ON CONFLICT(post_id) DO UPDATE SET pod_id = excluded.pod_id, pod_source = excluded.pod_source,
             angle = excluded.angle, format = excluded.format, hook = excluded.hook, landing_page = excluded.landing_page,
             tags_source = excluded.tags_source, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .bind(postId, next.pod_id, next.pod_source, next.angle, next.format, next.hook, next.landing_page, next.tags_source, now),
    );
  }
  await runBatched(db, stmts);
  await saveConcepts(db, ads, settings);
}

/** Brings the concepts table and each ad's concept_id in line with buildConcepts. */
async function saveConcepts(
  db: D1Database,
  ads: { id: string; name: string; adset_id: string | null; adset_name: string | null; concept_id: string | null }[],
  settings: AttributionSettings,
) {
  const concepts = buildConcepts(ads.map((a) => ({ id: a.id, name: a.name, adsetId: a.adset_id, adsetName: a.adset_name })), settings);
  const { results: stored } = await db
    .prepare("SELECT id, adset_id, adset_name, label, pod_id FROM concepts")
    .all<{ id: string; adset_id: string; adset_name: string; label: string; pod_id: string }>();
  const oldConcepts = new Map(stored.map((c) => [c.id, c]));

  const stmts: D1PreparedStatement[] = [];
  const wanted = new Map<string, string | null>(ads.map((a) => [a.id, null]));
  for (const c of concepts) {
    for (const id of c.adIds) wanted.set(id, c.id);
    const next = { id: c.id, adset_id: c.adsetId, adset_name: c.adsetName, label: c.label, pod_id: podByCode(c.podCode)!.id };
    const old = oldConcepts.get(c.id);
    oldConcepts.delete(c.id);
    if (old && same(old, next, ["adset_id", "adset_name", "label", "pod_id"])) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO concepts (id, adset_id, adset_name, label, pod_id) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(id) DO UPDATE SET adset_id = excluded.adset_id, adset_name = excluded.adset_name,
             label = excluded.label, pod_id = excluded.pod_id`,
        )
        .bind(next.id, next.adset_id, next.adset_name, next.label, next.pod_id),
    );
  }
  for (const id of oldConcepts.keys()) stmts.push(db.prepare("DELETE FROM concepts WHERE id = ?1").bind(id));

  // Group ads whose concept changed by their new concept, so each UPDATE covers many ads.
  const moves = new Map<string | null, string[]>();
  for (const a of ads) {
    const target = wanted.get(a.id) ?? null;
    if ((a.concept_id ?? null) !== target) moves.set(target, [...(moves.get(target) ?? []), a.id]);
  }
  for (const [target, ids] of moves) {
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      stmts.push(
        db
          .prepare(`UPDATE ads SET concept_id = ?1 WHERE id IN (${chunk.map((_, j) => `?${j + 2}`).join(", ")})`)
          .bind(target, ...chunk),
      );
    }
  }
  await runBatched(db, stmts);
}

/** Posts left without ads (their ads moved to a real post ID), unless tagged by hand. */
async function removeOrphanPosts(db: D1Database) {
  await db.batch([
    db.prepare(
      `DELETE FROM assignments WHERE post_id NOT IN (SELECT post_id FROM ads)
         AND COALESCE(pod_source, '') <> 'manual' AND COALESCE(tags_source, '') <> 'manual'`,
    ),
    db.prepare(
      "DELETE FROM posts WHERE id NOT IN (SELECT post_id FROM ads) AND id NOT IN (SELECT post_id FROM assignments)",
    ),
  ]);
}

type DailyDbRow = {
  ad_id: string;
  date: string;
  spend_cents: number;
  impressions: number;
  reach: number | null;
  link_clicks: number;
  purchases: number;
  revenue_cents: number;
};
const DAILY_COLS = ["spend_cents", "impressions", "reach", "link_clicks", "purchases", "revenue_cents"] as const;

/** Brings daily metrics for [since, until] (inclusive, account timezone) in line with Meta. */
export async function syncInsights(env: Env, db: D1Database, gc: GraphClient, since: string, until: string) {
  const rows: GraphInsight[] = [];
  for await (const page of gc.pages<GraphInsight>(`${env.META_AD_ACCOUNT_ID}/insights`, {
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: INSIGHT_FIELDS,
    limit: "250",
  }))
    rows.push(...page);

  // Ads deleted in Meta still have history; give them a placeholder post.
  const { results: known } = await db.prepare("SELECT id FROM ads").all<{ id: string }>();
  const knownIds = new Set(known.map((k) => k.id));
  const missing = new Map<string, GraphInsight>();
  for (const r of rows) if (!knownIds.has(r.ad_id)) missing.set(r.ad_id, r);
  const placeholderStmts: D1PreparedStatement[] = [];
  for (const r of missing.values()) {
    const postId = `ad:${r.ad_id}`;
    placeholderStmts.push(
      db.prepare("INSERT INTO posts (id, media_type) VALUES (?1, 'video') ON CONFLICT(id) DO NOTHING").bind(postId),
      db
        .prepare(
          `INSERT INTO ads (id, post_id, name, campaign_id, campaign_name, adset_id, adset_name, status)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'DELETED') ON CONFLICT(id) DO NOTHING`,
        )
        .bind(r.ad_id, postId, r.ad_name ?? r.ad_id, r.campaign_id ?? null, r.campaign_name ?? null, r.adset_id ?? null, r.adset_name ?? null),
    );
  }
  await runBatched(db, placeholderStmts);

  const { results: storedDaily } = await db
    .prepare(`SELECT ad_id, date, ${DAILY_COLS.join(", ")} FROM ad_daily WHERE date BETWEEN ?1 AND ?2`)
    .bind(since, until)
    .all<DailyDbRow>();
  const old = new Map(storedDaily.map((d) => [`${d.ad_id}|${d.date}`, d]));

  const stmts: D1PreparedStatement[] = [];
  const daily = rows.map(insightToDaily);
  for (const d of daily) {
    const key = `${d.adId}|${d.date}`;
    const prev = old.get(key);
    old.delete(key);
    const next: DailyDbRow = {
      ad_id: d.adId,
      date: d.date,
      spend_cents: d.spendCents,
      impressions: d.impressions,
      reach: d.reach,
      link_clicks: d.linkClicks,
      purchases: d.purchases,
      revenue_cents: d.revenueCents,
    };
    if (prev && same(prev, next, DAILY_COLS)) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO ad_daily (ad_id, date, spend_cents, impressions, reach, link_clicks, purchases, revenue_cents)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT(ad_id, date) DO UPDATE SET spend_cents = excluded.spend_cents, impressions = excluded.impressions,
             reach = excluded.reach, link_clicks = excluded.link_clicks, purchases = excluded.purchases, revenue_cents = excluded.revenue_cents`,
        )
        .bind(next.ad_id, next.date, next.spend_cents, next.impressions, next.reach, next.link_clicks, next.purchases, next.revenue_cents),
    );
  }
  // Rows Meta no longer reports for this window (e.g. revised to zero).
  for (const gone of old.values())
    stmts.push(db.prepare("DELETE FROM ad_daily WHERE ad_id = ?1 AND date = ?2").bind(gone.ad_id, gone.date));
  await runBatched(db, stmts);
  if (missing.size) await attribute(db);
  return { rows: daily.length, written: stmts.length + placeholderStmts.length };
}

type WindowDbRow = {
  ad_id: string;
  date: string;
  purchases_7dc: number | null;
  revenue_7dc_cents: number | null;
  purchases_inc_milli: number | null;
  revenue_inc_cents: number | null;
};
const WINDOW_COLS = ["purchases_7dc", "revenue_7dc_cents", "purchases_inc_milli", "revenue_inc_cents"] as const;

/**
 * Purchases and revenue under 7-day click and Meta's incremental attribution, for comparison.
 * A separate request, so the default numbers are never affected. Only updates rows that exist in
 * ad_daily and changed. If Meta refuses the windows, the columns stay NULL ("—" in the app).
 */
export async function syncAttributionWindows(env: Env, db: D1Database, gc: GraphClient, since: string, until: string) {
  const rows: GraphInsight[] = [];
  try {
    for await (const page of gc.pages<GraphInsight>(`${env.META_AD_ACCOUNT_ID}/insights`, {
      level: "ad",
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      fields: "ad_id,actions,action_values",
      action_attribution_windows: JSON.stringify(COMPARE_WINDOWS),
      limit: "250",
    }))
      rows.push(...page);
  } catch (e) {
    if (e instanceof GraphError && e.needsReconnect) throw e;
    return { rows: 0, written: 0, error: e instanceof Error ? e.message : String(e) };
  }
  const { results } = await db
    .prepare(`SELECT ad_id, date, ${WINDOW_COLS.join(", ")} FROM ad_daily WHERE date BETWEEN ?1 AND ?2`)
    .bind(since, until)
    .all<WindowDbRow>();
  const stored = new Map(results.map((r) => [`${r.ad_id}|${r.date}`, r]));
  const stmts: D1PreparedStatement[] = [];
  for (const w of rows.map(insightToWindows)) {
    const prev = stored.get(`${w.adId}|${w.date}`);
    if (!prev) continue; // no default row for that day (no spend): nothing to compare against
    const next: WindowDbRow = {
      ad_id: w.adId,
      date: w.date,
      purchases_7dc: w.purchases7dc,
      revenue_7dc_cents: w.revenue7dcCents,
      purchases_inc_milli: w.purchasesIncMilli,
      revenue_inc_cents: w.revenueIncCents,
    };
    if (same(prev, next, WINDOW_COLS)) continue;
    stmts.push(
      db
        .prepare(
          `UPDATE ad_daily SET purchases_7dc = ?3, revenue_7dc_cents = ?4, purchases_inc_milli = ?5, revenue_inc_cents = ?6
           WHERE ad_id = ?1 AND date = ?2`,
        )
        .bind(next.ad_id, next.date, next.purchases_7dc, next.revenue_7dc_cents, next.purchases_inc_milli, next.revenue_inc_cents),
    );
  }
  await runBatched(db, stmts);
  return { rows: rows.length, written: stmts.length };
}

export function utcDay(offset = 0, from = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export interface SyncResult {
  ok: boolean;
  ads?: number;
  posts?: number;
  rows?: number;
  /** Row writes this sync made (D1 free plan allows 100k/day). */
  written?: number;
  error?: string;
  reconnect?: boolean;
}

/** One sync step, recorded in sync_runs. `ads` refreshes ad metadata first. */
export async function runSync(
  env: Env,
  opts: { since: string; until: string; ads: boolean },
  fetcher?: typeof fetch,
): Promise<SyncResult> {
  const db = env.DB;
  const started = new Date().toISOString();
  const run = await db
    .prepare("INSERT INTO sync_runs (source, started_at, status, message) VALUES ('meta', ?1, 'running', ?2) RETURNING id")
    .bind(started, `${opts.since} → ${opts.until}`)
    .first<{ id: number }>();
  // Marks the data as changed only when the sync wrote something (an unchanged re-sync still
  // writes 0 data rows); /api/meta keys its cache on the latest run, so the status stays current.
  const finish = async (status: string, message: string, changed: boolean) => {
    await finishRun(status, message);
    if (changed) await bumpVersion(db).catch(() => undefined);
  };
  const finishRun = (status: string, message: string) =>
    db
      .prepare("UPDATE sync_runs SET finished_at = ?1, status = ?2, message = ?3 WHERE id = ?4")
      .bind(new Date().toISOString(), status, message, run!.id)
      .run();

  try {
    const token = await getToken(env, db);
    if (!token) throw new Error("Meta isn't connected.");
    const gc = clientFor(env, token, fetcher);
    const result: SyncResult = { ok: true, written: 0 };
    if (opts.ads) {
      const a = await syncAds(env, db, gc);
      Object.assign(result, { ads: a.ads, posts: a.posts, written: a.written });
    }
    const i = await syncInsights(env, db, gc, opts.since, opts.until);
    result.rows = i.rows;
    result.written = (result.written ?? 0) + i.written;
    const w = await syncAttributionWindows(env, db, gc, opts.since, opts.until);
    result.written += w.written;
    await finish(
      "ok",
      `${opts.since} → ${opts.until} · ${result.rows} rows${opts.ads ? ` · ${result.ads} ads` : ""} · ${result.written} changed` +
        (w.error ? ` · 7-day click / incremental not available: ${w.error}` : ""),
      result.written > 0,
    );
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finish("error", message, true);
    return { ok: false, error: message, reconnect: e instanceof GraphError && e.needsReconnect };
  }
}
