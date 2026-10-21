// View-only vs edit access. Cloudflare Access decides who can open the hub at all; this
// list decides who among them can change things. See docs/ARCHITECTURE.md → "Access".
import type { AppEnv } from "./env.ts";

/** Emails on the edit list, sorted. */
export async function loadEditAccess(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare("SELECT email FROM edit_access ORDER BY email").all<{ email: string }>();
  return results.map((r) => r.email);
}

/**
 * Whether this signed-in person can make changes: Access must be on, it must be a person
 * (not a service token), and either the list is empty or their email is on it.
 */
export function canEditWith(env: AppEnv["Bindings"], email: string | null, list: string[]): boolean {
  if (!env.ACCESS_TEAM_DOMAIN || !email || email.startsWith("service:")) return false;
  return list.length === 0 || list.includes(email.toLowerCase());
}

export async function canEdit(env: AppEnv["Bindings"], email: string | null): Promise<boolean> {
  return canEditWith(env, email, await loadEditAccess(env.DB));
}
