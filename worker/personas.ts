// Personas for the coverage map. Claude drafts the list and suggests additions through the Atria
// ingest routes; people edit, confirm, merge and approve them through the editing routes.
import type { Persona } from "../shared/api.ts";
import { randomToken } from "./crypto.ts";

export const MAX_PERSONAS = 12;

export const newPersonaId = () => `pe_${randomToken(6)}`;

/** Non-dismissed personas: active first, then drafts, then suggestions, each in the order added. */
export async function loadPersonas(db: D1Database): Promise<Persona[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, description, status FROM personas WHERE status <> 'dismissed'
       ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, sort, created_at`,
    )
    .all<Persona>();
  return results;
}

/** The list counts as confirmed once any persona is active; until then Claude doesn't assign personas. */
export const confirmed = (list: Persona[]) => list.some((p) => p.status === "active");

/** Next sort position. */
export async function nextSort(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM personas").first<{ n: number }>();
  return Number(r?.n ?? 1);
}

/** Text checks shared by both sides: a name up to 60 characters, a description up to 240. */
export function cleanPersona(v: { name?: unknown; description?: unknown }): { name: string; description: string } | string {
  const name = typeof v.name === "string" ? v.name.trim() : "";
  const description = typeof v.description === "string" ? v.description.trim() : "";
  if (!name || name.length > 60) return "A persona needs a name of up to 60 characters.";
  if (description.length > 240) return "Keep the description to 240 characters.";
  return { name, description };
}

/**
 * Asks Claude to look again at creatives it couldn't place, e.g. after a persona is added.
 * Only rows already labelled "fits none" change, so this stays cheap.
 */
export const relabelUnplaced = (db: D1Database) => db.prepare("UPDATE atria_assets SET persona_at = NULL WHERE persona_at IS NOT NULL AND persona_id IS NULL");
