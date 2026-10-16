// Changes people make in the app: tagging posts, settings, the editor roster.
// Every route requires Cloudflare Access and records who made the change.
import { Hono } from "hono";
import type { AssignmentPatch, Editor } from "../shared/api.ts";
import type { AttributionSettings } from "../shared/attribution.ts";
import type { Targets } from "../shared/metrics.ts";
import { ANGLES, FORMATS, GROUPS, HOOKS, LANDING_PAGES } from "../shared/taxonomy.ts";
import { requireAccess } from "./access.ts";
import { randomToken } from "./crypto.ts";
import type { AppEnv } from "./env.ts";
import { attribute } from "./meta/sync.ts";

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
  if (p.reset?.includes("pod")) sets.push("pod_source = NULL");
  if (p.reset?.includes("tags")) sets.push("tags_source = NULL");
  sets.push("updated_at = ?2", "updated_by = ?3");

  return postIds.map((id) =>
    db
      .prepare(
        `INSERT INTO assignments (post_id, updated_at, updated_by) VALUES (?1, ?2, ?3)
         ON CONFLICT(post_id) DO NOTHING;`,
      )
      .bind(id, now, by),
  ).concat(
    postIds.map((id) =>
      db.prepare(`UPDATE assignments SET ${sets.join(", ")} WHERE post_id = ?1`).bind(id, now, by, ...vals),
    ),
  );
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
  const by = c.get("userEmail");
  if (body.targets) await mergeSetting(db, "targets", body.targets, by);
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

/** Re-credits every post from stored data, after a settings change or on request. */
editing.post("/attribute", requireAccess, async (c) => {
  await attribute(c.env.DB);
  return c.json({ ok: true });
});
