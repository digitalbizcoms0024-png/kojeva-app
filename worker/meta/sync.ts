// Pulls ads and daily insights from Meta into D1. See docs/ROADMAP.md → Phase 1.
import { attributePod } from "../../shared/attribution.ts";
import { parseAdName } from "../../shared/naming.ts";
import { podByCode, type PodCode } from "../../shared/taxonomy.ts";
import { decrypt } from "../crypto.ts";
import type { Env } from "../env.ts";
import { GraphError, graphClient, type GraphClient } from "./graph.ts";
import { insightToDaily, isoTime, mediaTypeFor, postIdFor, thumbnailFor, type GraphAd, type GraphInsight } from "./transform.ts";

const AD_FIELDS =
  "id,name,status,effective_status,created_time,adset{id,name},campaign{id,name}," +
  "creative{id,effective_object_story_id,thumbnail_url,image_url,object_type}";
const INSIGHT_FIELDS =
  "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,inline_link_clicks,actions,action_values";
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
    db.prepare("DELETE FROM sync_runs WHERE source = 'sample'"),
  ]);
  return true;
}

/** Upserts every ad (all statuses) and its post, then re-attributes pods and tags. */
export async function syncAds(env: Env, db: D1Database, gc: GraphClient) {
  const now = new Date().toISOString();
  const posts = new Map<string, { mediaType: string; thumb: string | null; created: string | null }>();
  const adStmts: D1PreparedStatement[] = [];
  let count = 0;

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
        mediaType: mediaTypeFor(ad),
        thumb: prev?.thumb ?? thumbnailFor(ad),
        created: prev?.created && created ? (prev.created < created ? prev.created : created) : (prev?.created ?? created),
      });
      adStmts.push(
        db
          .prepare(
            `INSERT INTO ads (id, post_id, name, campaign_id, campaign_name, adset_id, adset_name, status, created_time, creative_id, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET post_id = excluded.post_id, name = excluded.name,
               campaign_id = excluded.campaign_id, campaign_name = excluded.campaign_name,
               adset_id = excluded.adset_id, adset_name = excluded.adset_name, status = excluded.status,
               created_time = excluded.created_time, creative_id = excluded.creative_id, updated_at = excluded.updated_at`,
          )
          .bind(
            ad.id, postId, ad.name, ad.campaign?.id ?? null, ad.campaign?.name ?? null, ad.adset?.id ?? null,
            ad.adset?.name ?? null, ad.effective_status ?? ad.status ?? "UNKNOWN", created, ad.creative?.id ?? null, now,
          ),
      );
      count++;
    }
  }

  const postStmts = [...posts].map(([id, p]) =>
    db
      .prepare(
        `INSERT INTO posts (id, media_type, thumbnail_url, created_time) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET media_type = excluded.media_type,
           thumbnail_url = COALESCE(excluded.thumbnail_url, posts.thumbnail_url),
           created_time = COALESCE(MIN(posts.created_time, excluded.created_time), posts.created_time, excluded.created_time)`,
      )
      .bind(id, p.mediaType, p.thumb, p.created),
  );
  // Posts before ads (foreign key), then ads.
  await runBatched(db, postStmts);
  await runBatched(db, adStmts);
  await attribute(db);
  await removeOrphanPosts(db);
  return { ads: count, posts: posts.size };
}

/** Recomputes pod and tags for every post, never touching manual values. */
export async function attribute(db: D1Database) {
  const [{ results: ads }, prefix] = await Promise.all([
    db.prepare("SELECT post_id, name, adset_name, created_time FROM ads").all<{
      post_id: string;
      name: string;
      adset_name: string | null;
      created_time: string | null;
    }>(),
    db.prepare("SELECT value FROM settings WHERE key = 'legacy_prefix_map'").first<{ value: string }>(),
  ]);
  const prefixMap = prefix ? (JSON.parse(prefix.value) as Record<string, PodCode>) : {};
  const byPost = new Map<string, typeof ads>();
  for (const a of ads) byPost.set(a.post_id, [...(byPost.get(a.post_id) ?? []), a]);

  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const [postId, list] of byPost) {
    const pod = attributePod(
      list.map((a) => ({ name: a.name, adsetName: a.adset_name, createdTime: a.created_time })),
      prefixMap,
    );
    const origin = [...list].sort((a, b) => (a.created_time ?? "").localeCompare(b.created_time ?? ""))[0]!;
    const tags = parseAdName(origin.name);
    stmts.push(
      db
        .prepare(
          `INSERT INTO assignments (post_id, pod_id, pod_source, angle, format, hook, landing_page, tags_source, updated_at, updated_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'name', ?8, 'sync')
           ON CONFLICT(post_id) DO UPDATE SET
             pod_id       = CASE WHEN assignments.pod_source  = 'manual' THEN assignments.pod_id       ELSE excluded.pod_id END,
             pod_source   = CASE WHEN assignments.pod_source  = 'manual' THEN 'manual'                 ELSE excluded.pod_source END,
             angle        = CASE WHEN assignments.tags_source = 'manual' THEN assignments.angle        ELSE excluded.angle END,
             format       = CASE WHEN assignments.tags_source = 'manual' THEN assignments.format       ELSE excluded.format END,
             hook         = CASE WHEN assignments.tags_source = 'manual' THEN assignments.hook         ELSE excluded.hook END,
             landing_page = CASE WHEN assignments.tags_source = 'manual' THEN assignments.landing_page ELSE excluded.landing_page END,
             tags_source  = CASE WHEN assignments.tags_source = 'manual' THEN 'manual'                 ELSE excluded.tags_source END,
             updated_at   = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .bind(
          postId, pod ? podByCode(pod.podCode)!.id : null, pod?.source ?? null,
          tags.angle, tags.format, tags.hook, tags.landingPage, now,
        ),
    );
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

/** Replaces daily metrics for [since, until] (inclusive, account timezone). */
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

  // Ads that are deleted in Meta still have history; give them a placeholder post.
  const placeholders = new Map<string, GraphInsight>();
  for (const r of rows) placeholders.set(r.ad_id, r);
  const stmts: D1PreparedStatement[] = [];
  for (const r of placeholders.values()) {
    const postId = `ad:${r.ad_id}`;
    stmts.push(
      db.prepare(
        `INSERT INTO posts (id, media_type) SELECT ?1, 'video'
         WHERE NOT EXISTS (SELECT 1 FROM ads WHERE id = ?2) ON CONFLICT(id) DO NOTHING`,
      ).bind(postId, r.ad_id),
      db
        .prepare(
          `INSERT INTO ads (id, post_id, name, campaign_id, campaign_name, adset_id, adset_name, status)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'DELETED') ON CONFLICT(id) DO NOTHING`,
        )
        .bind(r.ad_id, postId, r.ad_name ?? r.ad_id, r.campaign_id ?? null, r.campaign_name ?? null, r.adset_id ?? null, r.adset_name ?? null),
    );
  }
  await runBatched(db, stmts);

  const daily = rows.map(insightToDaily);
  await runBatched(db, [
    db.prepare("DELETE FROM ad_daily WHERE date BETWEEN ?1 AND ?2").bind(since, until),
    ...daily.map((d) =>
      db
        .prepare(
          `INSERT INTO ad_daily (ad_id, date, spend_cents, impressions, link_clicks, purchases, revenue_cents)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT(ad_id, date) DO UPDATE SET spend_cents = excluded.spend_cents, impressions = excluded.impressions,
             link_clicks = excluded.link_clicks, purchases = excluded.purchases, revenue_cents = excluded.revenue_cents`,
        )
        .bind(d.adId, d.date, d.spendCents, d.impressions, d.linkClicks, d.purchases, d.revenueCents),
    ),
  ]);
  if (placeholders.size) await attribute(db);
  return { rows: daily.length };
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
  const finish = (status: string, message: string) =>
    db
      .prepare("UPDATE sync_runs SET finished_at = ?1, status = ?2, message = ?3 WHERE id = ?4")
      .bind(new Date().toISOString(), status, message, run!.id)
      .run();

  try {
    const token = await getToken(env, db);
    if (!token) throw new Error("Meta isn't connected.");
    const gc = clientFor(env, token, fetcher);
    const result: SyncResult = { ok: true };
    if (opts.ads) Object.assign(result, await syncAds(env, db, gc));
    Object.assign(result, await syncInsights(env, db, gc, opts.since, opts.until));
    await finish("ok", `${opts.since} → ${opts.until} · ${result.rows} rows${opts.ads ? ` · ${result.ads} ads` : ""}`);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finish("error", message);
    return { ok: false, error: message, reconnect: e instanceof GraphError && e.needsReconnect };
  }
}
