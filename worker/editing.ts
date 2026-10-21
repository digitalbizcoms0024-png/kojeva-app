// Changes people make in the app: tagging posts, settings, the editor roster.
// Every route requires Cloudflare Access and records who made the change.
import { Hono } from "hono";
import type { AssignmentPatch, Editor } from "../shared/api.ts";
import type { AttributionSettings } from "../shared/attribution.ts";
import type { Targets } from "../shared/metrics.ts";
import { ANGLES, FORMATS, GROUPS, HOOKS, LANDING_PAGES, AWARENESS, MOTIVATIONS, POD_SLOTS } from "../shared/taxonomy.ts";
import { requireAccess } from "./access.ts";
import { loadEditAccess } from "./roles.ts";
import { isMediaBuyer } from "./calls.ts";
import { randomToken } from "./crypto.ts";
import type { AppEnv } from "./env.ts";
import { bumpStats, bumpVersion } from "./cache.ts";
import { attribute } from "./meta/sync.ts";
import { loadAddedPods } from "./pods.ts";
import { cleanPersona, loadPersonas, MAX_PERSONAS, newPersonaId, nextSort, relabelUnplaced } from "./personas.ts";

export const editing = new Hono<AppEnv>();

const MAX_BULK = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Problem = string | null;

/** Validates a patch against the controlled vocabularies and the editor roster. */
async function checkPatch(db: D1Database, p: AssignmentPatch): Promise<Problem> {
  if (p.podId != null && !GROUPS.some((g) => g.id === p.podId)) return `Unknown pod "${p.podId}".`;
  const vocab: [keyof AssignmentPatch, Record<string, string>][] = [
    ["angle", ANGLES],
    ["format", FORMATS],
    ["hook", HOOKS],
    ["landingPage", LANDING_PAGES],
  ];
  for (const [k, v] of vocab) {
    const val = p[k];
    if (val != null && (typeof val !== "string" || !(val in v))) return `Unknown ${k} "${String(val)}".`;
  }
  if (p.awareness != null && !(p.awareness in AWARENESS)) return `Unknown awareness "${String(p.awareness)}".`;
  if (p.beliefGroup != null && (typeof p.beliefGroup !== "string" || !p.beliefGroup.trim() || p.beliefGroup.length > 60))
    return "Belief group must be 1–60 characters.";
  if (p.personaId != null) {
    const e = await db.prepare("SELECT 1 FROM personas WHERE id = ?1 AND status = 'active'").bind(p.personaId).first();
    if (!e) return "Unknown persona.";
  }
  if (p.offer !== undefined && p.offer !== null && typeof p.offer !== "boolean") return "offer must be true, false or null.";
  if (p.motivations != null && (!Array.isArray(p.motivations) || p.motivations.some((m) => typeof m !== "string" || !(m in MOTIVATIONS))))
    return `motivations must be a list of ${Object.keys(MOTIVATIONS).join(", ")}, or null.`;
  if (p.editorId != null) {
    const e = await db.prepare("SELECT 1 FROM editors WHERE id = ?1").bind(p.editorId).first();
    if (!e) return "Unknown editor.";
  }
  if (p.reset && (!Array.isArray(p.reset) || p.reset.some((r) => r !== "pod" && r !== "tags"))) return "reset must list pod and/or tags.";
  return null;
}

/**
 * One UPSERT per post. Setting a pod or tag marks it manual so syncs leave it alone;
 * reset hands it back to automatic (the re-attribution that follows fills it in).
 */
function patchStatements(db: D1Database, postIds: string[], p: AssignmentPatch, by: string | null) {
  const now = new Date().toISOString();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const col = (sql: string, v: unknown) => {
    vals.push(v);
    sets.push(sql.replace("?", `?${vals.length + 3}`));
  };
  if (p.podId !== undefined) {
    col("pod_id = ?", p.podId);
    sets.push("pod_source = 'manual'");
  }
  if (p.editorId !== undefined) col("editor_id = ?", p.editorId);
  const tagCols: [keyof AssignmentPatch, string][] = [
    ["angle", "angle"],
    ["format", "format"],
    ["hook", "hook"],
    ["landingPage", "landing_page"],
  ];
  let tags = false;
  for (const [k, c] of tagCols)
    if (p[k] !== undefined) {
      col(`${c} = ?`, p[k]);
      tags = true;
    }
  if (tags) sets.push("tags_source = 'manual'");
  // Hand-set labels live in their own columns; null hands them back to Claude's labels.
  if (p.awareness !== undefined) col("awareness = ?", p.awareness);
  if (p.beliefGroup !== undefined) col("belief_group = ?", p.beliefGroup?.trim() ?? null);
  if (p.personaId !== undefined) col("persona_id = ?", p.personaId);
  if (p.offer !== undefined) col("offer = ?", p.offer == null ? null : p.offer ? 1 : 0);
  if (p.motivations !== undefined) col("motivations = ?", p.motivations == null ? null : JSON.stringify([...new Set(p.motivations)].sort()));
  if (p.reset?.includes("pod")) sets.push("pod_source = NULL");
  if (p.reset?.includes("tags")) sets.push("tags_source = NULL");
  sets.push("updated_at = ?2", "updated_by = ?3");

  return postIds
    .map((id) =>
      db
        .prepare(
          `INSERT INTO assignments (post_id, updated_at, updated_by) VALUES (?1, ?2, ?3)
         ON CONFLICT(post_id) DO NOTHING;`,
        )
        .bind(id, now, by),
    )
    .concat(postIds.map((id) => db.prepare(`UPDATE assignments SET ${sets.join(", ")} WHERE post_id = ?1`).bind(id, now, by, ...vals)));
}

async function applyPatch(db: D1Database, postIds: string[], p: AssignmentPatch, by: string | null) {
  const stmts = patchStatements(db, postIds, p, by);
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  // Resets need the automatic values filled back in.
  if (p.reset?.length) await attribute(db);
}

editing.patch("/posts/:id/assignment", requireAccess, async (c) => {
  const db = c.env.DB;
  const postId = c.req.param("id");
  const patch = await c.req.json<AssignmentPatch>().catch(() => null);
  if (!patch || typeof patch !== "object") return c.json({ error: "Send the fields to change as JSON." }, 400);
  const problem = await checkPatch(db, patch);
  if (problem) return c.json({ error: problem }, 400);
  if (!(await db.prepare("SELECT 1 FROM posts WHERE id = ?1").bind(postId).first())) return c.json({ error: "Not found" }, 404);
  await applyPatch(db, [postId], patch, c.get("userEmail"));
  return c.json({ ok: true });
});

editing.post("/assignments/bulk", requireAccess, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ postIds?: string[]; patch?: AssignmentPatch }>().catch(() => null);
  const ids = [...new Set(body?.postIds ?? [])].filter((x) => typeof x === "string");
  if (!ids.length || !body?.patch) return c.json({ error: "Send postIds and patch." }, 400);
  if (ids.length > MAX_BULK) return c.json({ error: `At most ${MAX_BULK} posts at a time.` }, 400);
  const problem = await checkPatch(db, body.patch);
  if (problem) return c.json({ error: problem }, 400);
  await applyPatch(db, ids, body.patch, c.get("userEmail"));
  return c.json({ ok: true, updated: ids.length });
});

// ---- Settings ----

function checkTargets(t: Partial<Targets>): Problem {
  const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  if (t.targetCpa !== undefined && !num(t.targetCpa, 0.01, 10_000)) return "Target CPA must be a positive amount.";
  if (t.targetRoas !== undefined && !num(t.targetRoas, 0.01, 100)) return "Target ROAS must be a positive number.";
  if (t.testWindowDays !== undefined && !(Number.isInteger(t.testWindowDays) && num(t.testWindowDays, 1, 30)))
    return "Judging days must be a whole number from 1 to 30.";
  if (t.minTestSpend !== undefined && !num(t.minTestSpend, 0, 100_000)) return "Minimum spend must be 0 or more.";
  if (t.hitRule !== undefined && t.hitRule !== "both" && t.hitRule !== "either") return 'Hit rule must be "both" or "either".';
  if (t.lateWindowDays !== undefined && !(Number.isInteger(t.lateWindowDays) && num(t.lateWindowDays, 0, 30)))
    return "The late-hit window must be a whole number of days from 0 to 30.";
  if (t.cpaWarnMax !== undefined && t.cpaWarnMax !== null && !num(t.cpaWarnMax, 0.01, 10_000))
    return "The amber CPA limit must be a positive amount, or empty for 25% over target.";
  if (t.cpaWarnMax != null && t.targetCpa !== undefined && t.cpaWarnMax <= t.targetCpa) return "The amber CPA limit must be above the target CPA.";
  if (t.winnerMinRoas !== undefined && !num(t.winnerMinRoas, 0.1, 20)) return "Winner ROAS must be between 0.1 and 20.";
  if (t.winnerMinSpend !== undefined && !num(t.winnerMinSpend, 0, 1_000_000)) return "Winner spend must be a positive amount.";
  if (t.winnerMinDays !== undefined && !(Number.isInteger(t.winnerMinDays) && num(t.winnerMinDays, 1, 90))) return "Winner days must be a whole number from 1 to 90.";
  if (t.superWinnerMinSpend !== undefined && !num(t.superWinnerMinSpend, 0, 10_000_000)) return "Super winner spend must be a positive amount.";
  if (t.rankMinSpendPerDay !== undefined && !num(t.rankMinSpendPerDay, 0, 100_000)) return "The ranking minimum must be 0 or more per day.";
  return null;
}

function checkAttribution(a: Partial<AttributionSettings>): Problem {
  if (a.agencyPrefixes !== undefined) {
    if (!Array.isArray(a.agencyPrefixes) || a.agencyPrefixes.some((p) => typeof p !== "string" || !/^[A-Za-z0-9]{1,8}$/.test(p)))
      return "Agency codes must be short letters/numbers, like ME or QW.";
  }
  if (a.podsStartDate !== undefined && a.podsStartDate !== null && !DAY.test(a.podsStartDate))
    return "Pods start date must be YYYY-MM-DD, or empty to detect it.";
  return null;
}

async function mergeSetting<T extends object>(db: D1Database, key: string, patch: Partial<T>, by: string | null) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first<{ value: string }>();
  const next = { ...(row ? (JSON.parse(row.value) as T) : {}), ...patch };
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, JSON.stringify(next))
    .run();
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(`${key}_updated`, JSON.stringify({ at: new Date().toISOString(), by }))
    .run();
}

editing.put("/settings", requireAccess, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ targets?: Partial<Targets>; attribution?: Partial<AttributionSettings> }>().catch(() => null);
  if (!body) return c.json({ error: "Send targets and/or attribution as JSON." }, 400);
  const problem = (body.targets && checkTargets(body.targets)) || (body.attribution && checkAttribution(body.attribution));
  if (problem) return c.json({ error: problem }, 400);
  // Winner thresholds feed the media buyer's calls, so only they set them.
  const winnerKeys = ["winnerMinRoas", "winnerMinSpend", "winnerMinDays", "superWinnerMinSpend"] as const;
  if (body.targets && winnerKeys.some((k) => body.targets![k] !== undefined) && !isMediaBuyer(c.env, c.get("userEmail")))
    return c.json({ error: "Only the media buyer can change the hit (call) thresholds." }, 403);
  const by = c.get("userEmail");
  if (body.targets) {
    await mergeSetting(db, "targets", body.targets, by);
    // Hit results and fatigue depend on the targets; the ranking minimum is applied per request, so it alone needs no recompute.
    if (Object.keys(body.targets).some((k) => k !== "rankMinSpendPerDay")) await bumpStats(db);
  }
  if (body.attribution) {
    const a = { ...body.attribution };
    if (a.agencyPrefixes) a.agencyPrefixes = [...new Set(a.agencyPrefixes.map((p) => p.toUpperCase()))];
    // A full-timestamp start date compares correctly with ads' ISO created times.
    if (a.podsStartDate) a.podsStartDate = `${a.podsStartDate}T00:00:00.000Z`;
    await mergeSetting(db, "attribution", a, by);
    await attribute(db);
  }
  return c.json({ ok: true });
});

// Recompute the stored summaries (worker/cache.ts, stats version) from the daily data.
editing.post("/stats/rebuild", requireAccess, async (c) => {
  await bumpStats(c.env.DB);
  return c.json({ ok: true });
});

// ---- Editors ----

editing.post("/editors", requireAccess, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ name?: string; podId?: string | null }>().catch(() => null);
  const name = body?.name?.trim();
  if (!name || name.length > 60) return c.json({ error: "Give the editor a name (up to 60 characters)." }, 400);
  if (body?.podId && !GROUPS.some((g) => g.id === body.podId)) return c.json({ error: "Unknown pod." }, 400);
  const editor: Editor = { id: `ed_${randomToken(8)}`, name, podId: body?.podId ?? null };
  await db.prepare("INSERT INTO editors (id, name, pod_id) VALUES (?1, ?2, ?3)").bind(editor.id, editor.name, editor.podId).run();
  return c.json(editor, 201);
});

editing.delete("/editors/:id", requireAccess, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  await db.batch([
    db.prepare("UPDATE assignments SET editor_id = NULL WHERE editor_id = ?1").bind(id),
    db.prepare("DELETE FROM editors WHERE id = ?1").bind(id),
  ]);
  return c.json({ ok: true });
});

// ---- Who can edit ----

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Adds someone to the edit list ({ email }). The first time, the person adding is put on it
 * too, so turning on view-only can't lock them out.
 */
editing.post("/edit-access", requireAccess, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ email?: string }>().catch(() => null);
  const email = body?.email?.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL.test(email)) return c.json({ error: "Enter an email address." }, 400);
  const me = c.get("userEmail")!.toLowerCase();
  const now = new Date().toISOString();
  const add = (e: string) => db.prepare("INSERT OR IGNORE INTO edit_access (email, added_by, added_at) VALUES (?1, ?2, ?3)").bind(e, me, now);
  const empty = !(await db.prepare("SELECT 1 AS x FROM edit_access LIMIT 1").first());
  await db.batch(empty && email !== me ? [add(me), add(email)] : [add(email)]);
  return c.json({ editAccess: await loadEditAccess(db) }, 201);
});

/** Takes someone off the edit list (they keep view access). You can't remove yourself. */
editing.delete("/edit-access/:email", requireAccess, async (c) => {
  const db = c.env.DB;
  const email = decodeURIComponent(c.req.param("email")).toLowerCase();
  if (email === c.get("userEmail")!.toLowerCase()) return c.json({ error: "You can't remove yourself. Ask another editor to." }, 400);
  await db.prepare("DELETE FROM edit_access WHERE email = ?1").bind(email).run();
  return c.json({ editAccess: await loadEditAccess(db) });
});

// ---- Pods ----

/**
 * Adds a pod matched by an ad set name part ({ name, prefix }). It takes the next free color
 * slot (shared/taxonomy.ts → POD_SLOTS); ads are re-credited right away, manual pods untouched.
 */
editing.post("/pods", requireAccess, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ name?: unknown; prefix?: unknown }>().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const prefix = typeof body?.prefix === "string" ? body.prefix.trim().toUpperCase() : "";
  if (!/^[\p{L}\p{N} .'-]{2,30}$/u.test(name)) return c.json({ error: "Give the pod a name of 2–30 letters." }, 400);
  if (!/^[A-Z0-9]{2,12}$/.test(prefix)) return c.json({ error: "The ad set prefix must be 2–12 letters or numbers, like TRYBE." }, 400);
  const { results: pods } = await db.prepare("SELECT id, code, name, prefix, slot FROM pods").all<{ id: string; code: string; name: string; prefix: string | null; slot: number | null }>();
  if (pods.some((p) => p.name.toLowerCase() === name.toLowerCase())) return c.json({ error: "A pod with that name exists." }, 400);
  if (pods.some((p) => (p.prefix ?? p.name).toUpperCase() === prefix)) return c.json({ error: "Another pod already uses that prefix." }, 400);
  const attr = await db.prepare("SELECT value FROM settings WHERE key = 'attribution'").first<{ value: string }>();
  const agency = (attr ? (JSON.parse(attr.value) as Partial<AttributionSettings>).agencyPrefixes : undefined) ?? ["ME", "QW", "TV", "YD"];
  if (agency.some((a) => a.toUpperCase() === prefix)) return c.json({ error: `${prefix} is an agency code (Settings → Pods & agency).` }, 400);
  const used = new Set(pods.map((p) => p.slot).filter((s) => s != null));
  const slot = POD_SLOTS.findIndex((_, i) => !used.has(i));
  if (slot < 0) return c.json({ error: `All ${POD_SLOTS.length} colors for added pods are in use; remove one first.` }, 400);
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `pod-${slot}`;
  if (pods.some((p) => p.id === id)) return c.json({ error: "A pod with that name exists." }, 400);
  const base = name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X");
  let code = base;
  for (let n = 2; pods.some((p) => p.code === code); n++) code = `${base.slice(0, 2)}${n}`;
  await db
    .prepare("INSERT INTO pods (id, code, name, color, kind, prefix, slot) VALUES (?1, ?2, ?3, ?4, 'pod', ?5, ?6)")
    .bind(id, code, name, POD_SLOTS[slot]!.light, prefix, slot)
    .run();
  await bumpVersion(db);
  await loadAddedPods(db);
  await attribute(db);
  return c.json({ id, code, slot }, 201);
});

/** Removes an added pod: its ads go back to automatic crediting, its editors keep no pod. */
editing.delete("/pods/:id", requireAccess, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const row = await db.prepare("SELECT prefix FROM pods WHERE id = ?1").bind(id).first<{ prefix: string | null }>();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!row.prefix) return c.json({ error: "Built-in pods can't be removed." }, 400);
  await db.batch([
    db.prepare("UPDATE assignments SET pod_id = NULL, pod_source = NULL WHERE pod_id = ?1").bind(id),
    db.prepare("UPDATE editors SET pod_id = NULL WHERE pod_id = ?1").bind(id),
    db.prepare("DELETE FROM concepts WHERE pod_id = ?1").bind(id),
    db.prepare("UPDATE ads SET concept_id = NULL WHERE concept_id NOT IN (SELECT id FROM concepts)"),
    db.prepare("DELETE FROM pods WHERE id = ?1").bind(id),
  ]);
  await bumpVersion(db);
  await loadAddedPods(db);
  await attribute(db);
  return c.json({ ok: true });
});

// ---- Personas ----

/** Adds a persona: active once the list is confirmed, otherwise another draft. */
editing.post("/personas", requireAccess, async (c) => {
  const db = c.env.DB;
  const p = cleanPersona((await c.req.json<{ name?: unknown; description?: unknown }>().catch(() => null)) ?? {});
  if (typeof p === "string") return c.json({ error: p }, 400);
  const list = await loadPersonas(db);
  if (list.length >= MAX_PERSONAS) return c.json({ error: `At most ${MAX_PERSONAS} personas; merge or delete one first.` }, 400);
  if (list.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) return c.json({ error: "A persona with that name exists." }, 400);
  const live = list.some((x) => x.status === "active");
  const id = newPersonaId();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare("INSERT INTO personas (id, name, description, status, sort, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(id, p.name, p.description, live ? "active" : "draft", await nextSort(db), c.get("userEmail"), now),
    // Ads that fit no persona get another look against the new one.
    ...(live ? [relabelUnplaced(db)] : []),
  ]);
  return c.json({ id }, 201);
});

/** Rename / redescribe, or approve one of Claude's suggestions ({ status: "active" }). */
editing.patch("/personas/:id", requireAccess, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json<{ name?: unknown; description?: unknown; status?: unknown }>().catch(() => null);
  const row = await db
    .prepare("SELECT name, description, status FROM personas WHERE id = ?1")
    .bind(id)
    .first<{ name: string; description: string; status: string }>();
  if (!row || row.status === "dismissed") return c.json({ error: "Not found" }, 404);
  const p = cleanPersona({ name: body?.name ?? row.name, description: body?.description ?? row.description });
  if (typeof p === "string") return c.json({ error: p }, 400);
  const clash = await db.prepare("SELECT 1 FROM personas WHERE lower(name) = lower(?1) AND id <> ?2").bind(p.name, id).first();
  if (clash) return c.json({ error: "A persona with that name exists." }, 400);
  if (body?.status !== undefined && !(body.status === "active" && row.status === "suggested"))
    return c.json({ error: "Only a suggestion can be approved." }, 400);
  const approve = body?.status === "active";
  await db.batch([
    db
      .prepare("UPDATE personas SET name = ?2, description = ?3, status = ?4, updated_at = ?5 WHERE id = ?1")
      .bind(id, p.name, p.description, approve ? "active" : row.status, new Date().toISOString()),
    ...(approve ? [relabelUnplaced(db)] : []),
  ]);
  return c.json({ ok: true });
});

/** Turns the drafts into the live list; Claude starts assigning ads on its next run. */
editing.post("/personas/confirm", requireAccess, async (c) => {
  const db = c.env.DB;
  const r = await db.prepare("UPDATE personas SET status = 'active', updated_at = ?1 WHERE status = 'draft'").bind(new Date().toISOString()).run();
  if (!r.meta.changes) return c.json({ error: "No draft personas to confirm." }, 400);
  return c.json({ ok: true, confirmed: r.meta.changes });
});

/**
 * Deletes a persona. ?into=<id> merges it: its ads move to that persona. Without it, its ads go
 * back to Claude to place again. A suggestion is dismissed instead, so it isn't suggested again.
 */
editing.delete("/personas/:id", requireAccess, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const into = c.req.query("into") ?? null;
  const row = await db.prepare("SELECT status FROM personas WHERE id = ?1").bind(id).first<{ status: string }>();
  if (!row || row.status === "dismissed") return c.json({ error: "Not found" }, 404);
  if (row.status === "suggested") {
    await db.prepare("UPDATE personas SET status = 'dismissed', updated_at = ?2 WHERE id = ?1").bind(id, new Date().toISOString()).run();
    return c.json({ ok: true, dismissed: true });
  }
  if (into) {
    const target = await db.prepare("SELECT status FROM personas WHERE id = ?1").bind(into).first<{ status: string }>();
    if (!target || into === id || (target.status !== "active" && target.status !== "draft")) return c.json({ error: "Merge into an existing persona." }, 400);
  }
  await db.batch([
    into
      ? db.prepare("UPDATE atria_assets SET persona_id = ?2 WHERE persona_id = ?1").bind(id, into)
      : db.prepare("UPDATE atria_assets SET persona_id = NULL, persona_at = NULL WHERE persona_id = ?1").bind(id),
    db.prepare("UPDATE assignments SET persona_id = ?2 WHERE persona_id = ?1").bind(id, into),
    db.prepare("DELETE FROM personas WHERE id = ?1").bind(id),
  ]);
  return c.json({ ok: true });
});

/** Re-credits every post from stored data, after a settings change or on request. */
editing.post("/attribute", requireAccess, async (c) => {
  await attribute(c.env.DB);
  return c.json({ ok: true });
});
