// Atria creative tags. Atria is only reachable through Claude's connector, so a scheduled
// Claude task pulls tags and pushes them here, signed in with an Access service token.
// See docs/ATRIA.md.
import { Hono } from "hono";
import { requireService } from "./access.ts";
import type { AppEnv } from "./env.ts";
import { bumpVersion } from "./cache.ts";
import { cleanPersona, confirmed, loadPersonas, MAX_PERSONAS, newPersonaId, nextSort } from "./personas.ts";
import { FORMAT_DEFINITIONS, FORMATS, MOTIVATIONS } from "../shared/taxonomy.ts";
import { getLatestDate, shiftDay } from "./queries.ts";

export const ATRIA_CATEGORIES = [
  "theme",
  "core_desire",
  "persona",
  "emotions",
  "visual_hook",
  "offer_type",
  "media_format",
  "production_quality",
  "key_message",
  "usp",
] as const;
const STATUSES = ["tagged", "not_tagged_yet", "incomplete_tags", "not_in_account"] as const;

export type AtriaTags = Partial<Record<(typeof ATRIA_CATEGORIES)[number], string[]>>;

export const atria = new Hono<AppEnv>();
atria.use("*", requireService("ATRIA_CLIENT_ID"));

/**
 * Assets that need tags, highest recent spend first: never fetched, untagged and last
 * tried over 3 days ago (Atria tags down the spend ranking over time), or tagged over 30 days ago.
 */
atria.get("/pending", async (c) => {
  const db = c.env.DB;
  const limit = Math.min(Number(c.req.query("limit") ?? 60) || 60, 200);
  const latest = (await getLatestDate(db)) ?? new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const { results } = await db
    .prepare(
      `SELECT a.asset_id, SUM(d.spend_cents) AS spend
       FROM ads a JOIN ad_daily d ON d.ad_id = a.id
       LEFT JOIN atria_assets t ON t.asset_id = a.asset_id
       WHERE a.asset_id IS NOT NULL AND d.date >= ?1
         AND (t.asset_id IS NULL
              OR (t.status <> 'tagged' AND t.fetched_at < ?2)
              OR t.fetched_at < ?3)
       GROUP BY a.asset_id
       ORDER BY spend DESC
       LIMIT ?4`,
    )
    .bind(shiftDay(latest, -29), new Date(now - 3 * 86_400_000).toISOString(), new Date(now - 30 * 86_400_000).toISOString(), limit)
    .all<{ asset_id: string; spend: number }>();
  return c.json({
    assets: results.map((r) => ({
      assetId: r.asset_id,
      videoId: r.asset_id.startsWith("v:") ? r.asset_id.slice(2) : null,
      imageHash: r.asset_id.startsWith("i:") ? r.asset_id.slice(2) : null,
      spendCents: Number(r.spend),
    })),
  });
});

type Incoming = { assetId?: unknown; status?: unknown; tags?: unknown; previewUrl?: unknown };

/** Atria's preview image file name (a hash), the same for copies of one creative. */
export function previewKey(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = /\/([0-9a-f]{16,64})\.(?:jpe?g|png|webp)(?:\?|$)/i.exec(url);
  return m ? m[1]!.toLowerCase() : null;
}

/** Claude's labels, copied from a tagged asset to its untagged copies. */
const LABEL_COLS = ["awareness", "belief", "belief_group", "labeled_at", "offer", "persona_id", "persona_at", "motivations", "motivations_at", "format_label", "format_at"] as const;
type AssetRow = { asset_id: string; status: string; tags: string | null; preview_key: string | null; twin_of: string | null } & Record<(typeof LABEL_COLS)[number], unknown>;

/**
 * Gives untagged assets the tags and labels of a tagged asset with the same Atria preview (see
 * migration 0024), for the given preview keys. Writes only the copies that differ.
 */
async function copyTwins(db: D1Database, keys: string[]): Promise<number> {
  const rows: AssetRow[] = [];
  for (let i = 0; i < keys.length; i += 90) {
    const chunk = keys.slice(i, i + 90);
    const { results } = await db
      .prepare(
        `SELECT asset_id, status, tags, preview_key, twin_of, ${LABEL_COLS.join(", ")} FROM atria_assets
         WHERE preview_key IN (${chunk.map((_, j) => `?${j + 1}`).join(", ")})`,
      )
      .bind(...chunk)
      .all<AssetRow>();
    rows.push(...results);
  }
  const byKey = new Map<string, AssetRow[]>();
  for (const r of rows) byKey.set(r.preview_key!, [...(byKey.get(r.preview_key!) ?? []), r]);
  const stmts: D1PreparedStatement[] = [];
  for (const group of byKey.values()) {
    // The source: tagged by Atria itself, labelled first, then by id so the choice is stable.
    const own = group.filter((r) => r.status === "tagged" && !r.twin_of).sort((a, b) => Number(!a.labeled_at) - Number(!b.labeled_at) || a.asset_id.localeCompare(b.asset_id));
    const src = own[0];
    if (!src) continue;
    for (const r of group) {
      if (r.status === "tagged" && !r.twin_of) continue;
      if (r.twin_of === src.asset_id && r.tags === src.tags && LABEL_COLS.every((k) => r[k] === src[k])) continue;
      stmts.push(
        db
          .prepare(
            `UPDATE atria_assets SET status = 'tagged', tags = ?2, twin_of = ?3, ${LABEL_COLS.map((k, i) => `${k} = ?${i + 4}`).join(", ")} WHERE asset_id = ?1`,
          )
          .bind(r.asset_id, src.tags, src.asset_id, ...LABEL_COLS.map((k) => src[k] ?? null)),
      );
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return stmts.length;
}

function clean(item: Incoming): { assetId: string; status: string; tags: string | null; previewKey: string | null } | string {
  if (typeof item.assetId !== "string" || !/^[vi]:[A-Za-z0-9_-]{1,64}$/.test(item.assetId)) return "assetId must be v:<video id> or i:<image hash>.";
  const status = item.status ?? "tagged";
  if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) return `Unknown status for ${item.assetId}.`;
  const key = previewKey(item.previewUrl);
  if (status !== "tagged") return { assetId: item.assetId, status, tags: null, previewKey: key };
  if (!item.tags || typeof item.tags !== "object") return `Tags missing for ${item.assetId}.`;
  const tags: AtriaTags = {};
  for (const cat of ATRIA_CATEGORIES) {
    const v = (item.tags as Record<string, unknown>)[cat];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.length > 120)) return `${cat} must be a list of short strings.`;
    tags[cat] = (v as string[]).slice(0, 12);
  }
  return { assetId: item.assetId, status, tags: JSON.stringify(tags), previewKey: key };
}

/** Body: { assets: [{ assetId, status, tags }] }, up to 100. Writes only rows that changed. */
atria.post("/", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ assets?: Incoming[] }>().catch(() => null);
  const items = body?.assets;
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) return c.json({ error: "Send 1–100 assets." }, 400);
  const rows: Exclude<ReturnType<typeof clean>, string>[] = [];
  for (const item of items) {
    const r = clean(item);
    if (typeof r === "string") return c.json({ error: r }, 400);
    rows.push(r);
  }

  const stored = new Map<string, { status: string; tags: string | null; preview_key: string | null; twin_of: string | null }>();
  for (let i = 0; i < rows.length; i += 90) {
    const chunk = rows.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT asset_id, status, tags, preview_key, twin_of FROM atria_assets WHERE asset_id IN (${chunk.map((_, j) => `?${j + 1}`).join(", ")})`)
      .bind(...chunk.map((r) => r.assetId))
      .all<{ asset_id: string; status: string; tags: string | null; preview_key: string | null; twin_of: string | null }>();
    for (const s of results) stored.set(s.asset_id, s);
  }

  const now = new Date().toISOString();
  // A copy still untagged by Atria keeps the tags it took from its twin (same preview).
  const same = (r: (typeof rows)[number]) => {
    const o = stored.get(r.assetId);
    if (!o || (r.previewKey && o.preview_key !== r.previewKey)) return false;
    return (o.status === r.status && o.tags === r.tags) || (r.status !== "tagged" && o.twin_of != null);
  };
  const stmts = rows.map((r) =>
    // Unchanged tags still record the check, so they aren't asked for again until due.
    same(r)
      ? db.prepare("UPDATE atria_assets SET fetched_at = ?2 WHERE asset_id = ?1").bind(r.assetId, now)
      : db
          .prepare(
            `INSERT INTO atria_assets (asset_id, status, tags, fetched_at, preview_key) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(asset_id) DO UPDATE SET status = excluded.status, tags = excluded.tags, fetched_at = excluded.fetched_at,
               preview_key = COALESCE(excluded.preview_key, atria_assets.preview_key), twin_of = NULL,
               labeled_at = CASE WHEN atria_assets.tags IS excluded.tags THEN atria_assets.labeled_at END`,
          )
          .bind(r.assetId, r.status, r.tags, now, r.previewKey),
  );
  await db.batch(stmts);
  const twins = await copyTwins(db, [...new Set(rows.map((r) => r.previewKey).filter((k): k is string => k != null))]);
  // Only new or changed tags change what the hub shows (fetched_at alone doesn't).
  if (twins > 0 || rows.some((r) => !same(r))) await bumpVersion(db);
  return c.json({ ok: true, received: rows.length, tagged: rows.filter((r) => r.status === "tagged").length, twins });
});

export const AWARENESS_LEVELS = ["unaware", "problem", "solution", "product", "most"] as const;

/**
 * Tagged assets with no awareness/belief label yet (or whose tags changed since), highest recent
 * spend first, with what Claude needs to label them, plus the belief groups already in use so it
 * reuses them instead of inventing near-duplicates.
 */
/**
 * Why posts that spent in the last 7 days have no Atria tags: their ads carry no video/image id
 * (Meta hides the media, or a format with none), or Atria's status for the asset. Read-only.
 */
atria.get("/gaps", async (c) => {
  const db = c.env.DB;
  const latest = (await getLatestDate(db)) ?? new Date().toISOString().slice(0, 10);
  const { results } = await db
    .prepare(
      `SELECT a.post_id, a.name, a.asset_id, a.creative_id, t.status, t.fetched_at, SUM(d.spend_cents) AS spend
       FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id LEFT JOIN atria_assets t ON t.asset_id = a.asset_id
       WHERE d.date >= ?1 GROUP BY a.id`,
    )
    .bind(shiftDay(latest, -6))
    .all<{ post_id: string; name: string; asset_id: string | null; creative_id: string | null; status: string | null; fetched_at: string | null; spend: number }>();
  const byPost = new Map<string, typeof results>();
  for (const r of results) byPost.set(r.post_id, [...(byPost.get(r.post_id) ?? []), r]);
  const counts: Record<string, number> = {};
  const examples: Record<string, { postId: string; name: string; assetId: string | null; creativeId: string | null; fetchedAt: string | null; spendCents: number }[]> = {};
  for (const [postId, ads] of byPost) {
    if (ads.some((a) => a.status === "tagged")) continue;
    const ad = ads.find((a) => a.asset_id) ?? ads[0]!;
    const why = !ad.asset_id ? "no_asset_id" : (ad.status ?? "never_fetched");
    counts[why] = (counts[why] ?? 0) + 1;
    (examples[why] ??= []).push({ postId, name: ad.name, assetId: ad.asset_id, creativeId: ad.creative_id, fetchedAt: ad.fetched_at, spendCents: ads.reduce((n, a) => n + Number(a.spend), 0) });
  }
  const limit = Math.min(Number(c.req.query("limit") ?? 15) || 15, 500);
  for (const k of Object.keys(examples)) examples[k] = examples[k]!.sort((a, b) => b.spendCents - a.spendCents).slice(0, limit);
  return c.json({ since: shiftDay(latest, -6), posts: byPost.size, untagged: counts, examples });
});

atria.get("/unlabeled", async (c) => {
  const db = c.env.DB;
  const limit = Math.min(Number(c.req.query("limit") ?? 40) || 40, 100);
  const latest = (await getLatestDate(db)) ?? new Date().toISOString().slice(0, 10);
  const personas = await loadPersonas(db);
  const ready = confirmed(personas);
  const [assets, groups] = await Promise.all([
    db
      .prepare(
        `SELECT t.asset_id, t.tags, SUM(d.spend_cents) AS spend,
           (SELECT GROUP_CONCAT(n.name, char(10)) FROM (SELECT DISTINCT x.name FROM ads x WHERE x.asset_id = t.asset_id) n) AS ad_names,
           (SELECT GROUP_CONCAT(i.id, char(10)) FROM (SELECT x.id FROM ads x WHERE x.asset_id = t.asset_id ORDER BY x.created_time LIMIT 3) i) AS ad_ids
         FROM atria_assets t JOIN atria_assets m ON m.asset_id = t.asset_id OR m.twin_of = t.asset_id
           JOIN ads a ON a.asset_id = m.asset_id JOIN ad_daily d ON d.ad_id = a.id
         WHERE t.status = 'tagged' AND t.twin_of IS NULL AND d.date >= ?1
           AND (t.labeled_at IS NULL OR t.offer IS NULL OR t.motivations_at IS NULL OR t.format_at IS NULL OR (?3 = 1 AND t.persona_at IS NULL))
         GROUP BY t.asset_id ORDER BY spend DESC LIMIT ?2`,
      )
      .bind(shiftDay(latest, -89), limit, ready ? 1 : 0)
      .all<{ asset_id: string; tags: string; spend: number; ad_names: string | null; ad_ids: string | null }>(),
    db
      .prepare("SELECT belief_group, COUNT(*) AS n FROM atria_assets WHERE belief_group IS NOT NULL GROUP BY belief_group ORDER BY n DESC")
      .all<{ belief_group: string; n: number }>(),
  ]);
  return c.json({
    awarenessLevels: AWARENESS_LEVELS,
    // Send `motivations` (any of these keys, or []) for each asset.
    motivations: Object.entries(MOTIVATIONS).map(([key, label]) => ({ key, label })),
    // Send `format` (one of these keys, or null if none fits) for each asset: a suggestion only.
    formats: Object.entries(FORMATS).map(([key, label]) => ({ key, label, definition: FORMAT_DEFINITIONS[key] ?? null })),
    beliefGroups: groups.results.map((g) => ({ name: g.belief_group, assets: Number(g.n) })),
    // Until people confirm the list, Claude labels awareness, belief and offer only.
    personasConfirmed: ready,
    personas: personas.filter((p) => p.status === "active").map(({ id, name, description }) => ({ id, name, description })),
    pendingSuggestions: personas.filter((p) => p.status === "suggested").map((p) => p.name),
    assets: assets.results.map((r) => ({
      assetId: r.asset_id,
      adNames: (r.ad_names ?? "").split("\n").filter(Boolean).slice(0, 5),
      // Meta ad ids running it: for the Atria tool get_ad_account_ad (video file, copy).
      adIds: (r.ad_ids ?? "").split("\n").filter(Boolean),
      tags: JSON.parse(r.tags) as AtriaTags,
      spendCents: Number(r.spend),
    })),
  });
});

type IncomingLabel = {
  assetId?: unknown;
  awareness?: unknown;
  belief?: unknown;
  beliefGroup?: unknown;
  offer?: unknown;
  personaId?: unknown;
  motivations?: unknown;
  format?: unknown;
};
type Label = {
  assetId: string;
  awareness: string;
  belief: string;
  beliefGroup: string;
  offer: number | null;
  persona: { id: string | null } | null;
  /** Sorted JSON array, or null when not sent. */
  motivations: string | null;
  /** Claude's format suggestion (key, or null for none fits); null when not sent. */
  format: { key: string | null } | null;
};

/**
 * Body: { labels: [{ assetId, awareness, belief, beliefGroup, offer, personaId?, motivations? }] }, up to 100.
 * motivations: MOTIVATIONS keys that apply ([] for none); optional so older prompts keep working.
 * format: a FORMATS key Claude suggests (null if none fits); optional. Only a suggestion: the
 * concept's format stays hand-set, then read from names, until someone accepts it.
 * personaId (an active persona's id, or null for "fits none") is only accepted once the persona
 * list is confirmed. Writes only changed rows.
 */
atria.post("/labels", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ labels?: IncomingLabel[] }>().catch(() => null);
  const items = body?.labels;
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) return c.json({ error: "Send 1–100 labels." }, 400);
  const rows: Label[] = [];
  const personas = await loadPersonas(db);
  const active = new Set(personas.filter((p) => p.status === "active").map((p) => p.id));
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);
  for (const l of items) {
    if (typeof l.assetId !== "string" || !/^[vi]:[A-Za-z0-9_-]{1,64}$/.test(l.assetId))
      return c.json({ error: "assetId must be v:<video id> or i:<image hash>." }, 400);
    if (!(AWARENESS_LEVELS as readonly unknown[]).includes(l.awareness))
      return c.json({ error: `awareness for ${l.assetId} must be one of ${AWARENESS_LEVELS.join(", ")}.` }, 400);
    const belief = text(l.belief, 200);
    const group = text(l.beliefGroup, 60);
    if (!belief || !group) return c.json({ error: `belief (≤200 chars) and beliefGroup (≤60 chars) are required for ${l.assetId}.` }, 400);
    // Optional so older task prompts keep working; leaving it out keeps the stored value.
    if (l.offer !== undefined && typeof l.offer !== "boolean") return c.json({ error: `offer for ${l.assetId} must be true or false.` }, 400);
    let persona: Label["persona"] = null;
    if (l.personaId !== undefined) {
      if (!active.size) return c.json({ error: "The persona list isn't confirmed yet; leave personaId out." }, 400);
      if (l.personaId !== null && (typeof l.personaId !== "string" || !active.has(l.personaId)))
        return c.json({ error: `personaId for ${l.assetId} must be an active persona's id, or null if none fits.` }, 400);
      persona = { id: l.personaId as string | null };
    }
    let motivations: string | null = null;
    if (l.motivations !== undefined) {
      if (!Array.isArray(l.motivations) || l.motivations.some((m) => typeof m !== "string" || !(m in MOTIVATIONS)))
        return c.json({ error: `motivations for ${l.assetId} must be a list of ${Object.keys(MOTIVATIONS).join(", ")} ([] for none).` }, 400);
      motivations = JSON.stringify([...new Set(l.motivations as string[])].sort());
    }
    let format: Label["format"] = null;
    if (l.format !== undefined) {
      if (l.format !== null && (typeof l.format !== "string" || !(l.format in FORMATS)))
        return c.json({ error: `format for ${l.assetId} must be one of ${Object.keys(FORMATS).join(", ")}, or null if none fits.` }, 400);
      format = { key: l.format as string | null };
    }
    rows.push({
      format,
      assetId: l.assetId,
      awareness: l.awareness as string,
      belief,
      beliefGroup: group,
      offer: l.offer === undefined ? null : l.offer ? 1 : 0,
      persona,
      motivations,
    });
  }

  type Stored = {
    asset_id: string;
    awareness: string | null;
    belief: string | null;
    belief_group: string | null;
    labeled_at: string | null;
    offer: number | null;
    persona_id: string | null;
    persona_at: string | null;
    motivations: string | null;
    motivations_at: string | null;
    format_label: string | null;
    format_at: string | null;
  };
  const stored = new Map<string, Stored>();
  for (let i = 0; i < rows.length; i += 90) {
    const chunk = rows.slice(i, i + 90);
    const { results } = await db
      .prepare(
        `SELECT asset_id, awareness, belief, belief_group, labeled_at, offer, persona_id, persona_at, motivations, motivations_at, format_label, format_at
         FROM atria_assets WHERE asset_id IN (${chunk.map((_, j) => `?${j + 1}`).join(", ")})`,
      )
      .bind(...chunk.map((r) => r.assetId))
      .all<Stored>();
    for (const s of results) stored.set(s.asset_id, s);
  }

  const now = new Date().toISOString();
  let unknown = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const old = stored.get(r.assetId);
    if (!old) {
      unknown++; // labels only attach to assets Atria has tagged
      continue;
    }
    const samePersona = !r.persona || (old.persona_at != null && old.persona_id === r.persona.id);
    if (
      old.labeled_at &&
      old.awareness === r.awareness &&
      old.belief === r.belief &&
      old.belief_group === r.beliefGroup &&
      (r.offer == null || old.offer === r.offer) &&
      samePersona &&
      (r.motivations == null || (old.motivations_at != null && old.motivations === r.motivations)) &&
      (!r.format || (old.format_at != null && old.format_label === r.format.key))
    )
      continue;
    stmts.push(
      db
        .prepare(
          `UPDATE atria_assets SET awareness = ?2, belief = ?3, belief_group = ?4, labeled_at = ?5, offer = COALESCE(?6, offer),
             persona_id = CASE WHEN ?7 = 1 THEN ?8 ELSE persona_id END, persona_at = CASE WHEN ?7 = 1 THEN ?5 ELSE persona_at END,
             motivations = COALESCE(?9, motivations), motivations_at = CASE WHEN ?9 IS NULL THEN motivations_at ELSE ?5 END,
             format_label = CASE WHEN ?10 = 1 THEN ?11 ELSE format_label END, format_at = CASE WHEN ?10 = 1 THEN ?5 ELSE format_at END
           WHERE asset_id = ?1`,
        )
        .bind(r.assetId, r.awareness, r.belief, r.beliefGroup, now, r.offer, r.persona ? 1 : 0, r.persona?.id ?? null, r.motivations, r.format ? 1 : 0, r.format?.key ?? null),
    );
  }
  if (stmts.length) {
    await db.batch(stmts);
    // Copies of a creative share its labels (see copyTwins).
    const changed = rows.map((r) => r.assetId);
    for (let i = 0; i < changed.length; i += 90) {
      const chunk = changed.slice(i, i + 90);
      await db
        .prepare(
          `UPDATE atria_assets SET (${LABEL_COLS.join(", ")}) = (SELECT ${LABEL_COLS.map((k) => `s.${k}`).join(", ")} FROM atria_assets s WHERE s.asset_id = atria_assets.twin_of)
           WHERE twin_of IN (${chunk.map((_, j) => `?${j + 1}`).join(", ")})`,
        )
        .bind(...chunk)
        .run();
    }
    await bumpVersion(db);
  }
  return c.json({ ok: true, received: rows.length, written: stmts.length, unknown });
});

/**
 * What Claude needs to draft or extend the persona list: the current list and Atria's persona tags
 * across creatives that spent in the last 90 days, by spend.
 */
atria.get("/personas", async (c) => {
  const db = c.env.DB;
  const latest = (await getLatestDate(db)) ?? new Date().toISOString().slice(0, 10);
  const [personas, dismissed, tagged] = await Promise.all([
    loadPersonas(db),
    db.prepare("SELECT name FROM personas WHERE status = 'dismissed'").all<{ name: string }>(),
    db
      .prepare(
        `SELECT t.tags, SUM(d.spend_cents) AS spend FROM atria_assets t JOIN ads a ON a.asset_id = t.asset_id JOIN ad_daily d ON d.ad_id = a.id
         WHERE t.status = 'tagged' AND d.date >= ?1 GROUP BY t.asset_id`,
      )
      .bind(shiftDay(latest, -89))
      .all<{ tags: string; spend: number }>(),
  ]);
  const byTag = new Map<string, { assets: number; spendCents: number }>();
  for (const r of tagged.results)
    for (const tag of (JSON.parse(r.tags) as AtriaTags).persona ?? []) {
      const t = byTag.get(tag) ?? { assets: 0, spendCents: 0 };
      byTag.set(tag, { assets: t.assets + 1, spendCents: t.spendCents + Number(r.spend) });
    }
  return c.json({
    state: personas.length === 0 ? "empty" : confirmed(personas) ? "confirmed" : "draft",
    personas,
    dismissed: dismissed.results.map((d) => d.name),
    atriaPersonas: [...byTag]
      .map(([tag, v]) => ({ tag, ...v }))
      .sort((a, b) => b.spendCents - a.spendCents)
      .slice(0, 80),
  });
});

/**
 * Body: { personas: [{ name, description }], replaceDrafts? }. With no personas yet, these become the
 * draft list (up to 8) for people to edit and confirm. Afterwards each is a suggestion (at most 3
 * waiting) that a person approves or dismisses; names already in use or dismissed are skipped.
 * replaceDrafts: true swaps an unconfirmed draft list for this one; refused once any persona is
 * confirmed (people own the list from then on).
 */
atria.post("/personas", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ personas?: { name?: unknown; description?: unknown }[]; replaceDrafts?: unknown }>().catch(() => null);
  const items = body?.personas;
  if (!Array.isArray(items) || items.length === 0 || items.length > 8) return c.json({ error: "Send 1–8 personas." }, 400);
  const clean = [];
  for (const p of items) {
    const r = cleanPersona(p);
    if (typeof r === "string") return c.json({ error: r }, 400);
    clean.push(r);
  }
  if (body?.replaceDrafts === true) {
    const { results: current } = await db.prepare("SELECT status FROM personas").all<{ status: string }>();
    if (current.some((p) => p.status === "active")) return c.json({ error: "The persona list is confirmed; people change it in Settings." }, 409);
    // Nothing is placed on drafts yet (Claude assigns only after confirmation), so they can go.
    await db.batch([
      db.prepare("UPDATE atria_assets SET persona_id = NULL, persona_at = NULL WHERE persona_id IN (SELECT id FROM personas WHERE status <> 'dismissed')"),
      db.prepare("UPDATE assignments SET persona_id = NULL WHERE persona_id IN (SELECT id FROM personas WHERE status <> 'dismissed')"),
      db.prepare("DELETE FROM personas WHERE status <> 'dismissed'"),
    ]);
  }
  const { results: all } = await db.prepare("SELECT name, status FROM personas").all<{ name: string; status: string }>();
  const taken = new Set(all.map((p) => p.name.toLowerCase()));
  // A list of only dismissed names (after replaceDrafts, say) is drafted afresh too.
  const drafting = all.every((p) => p.status === "dismissed");
  const waiting = all.filter((p) => p.status === "suggested").length;
  const live = all.filter((p) => p.status !== "dismissed").length;
  const room = drafting ? 8 : Math.min(3 - waiting, MAX_PERSONAS - live);
  const fresh = clean.filter((p) => !taken.has(p.name.toLowerCase()) && taken.add(p.name.toLowerCase())).slice(0, Math.max(0, room));
  if (fresh.length) {
    const now = new Date().toISOString();
    const sort = await nextSort(db);
    await db.batch(
      fresh.map((p, i) =>
        db
          .prepare("INSERT INTO personas (id, name, description, status, sort, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'claude', ?6)")
          .bind(newPersonaId(), p.name, p.description, drafting ? "draft" : "suggested", sort + i, now),
      ),
    );
  }
  if (fresh.length) await bumpVersion(db);
  return c.json({ ok: true, added: fresh.length, as: drafting ? "draft" : "suggested", skipped: clean.length - fresh.length });
});
