// Connecting Meta (Facebook login or a pasted token) and running syncs.
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ConnectionStatus } from "../../shared/api.ts";
import { accessConfigured, requireAccess } from "../access.ts";
import { canEdit } from "../roles.ts";
import { encrypt, randomToken } from "../crypto.ts";
import type { AppEnv, Env } from "../env.ts";
import { appGet, GraphError, graphClient } from "./graph.ts";
import { MAX_WINDOW_DAYS, runSync, wipeSampleData } from "./sync.ts";

const STATE_COOKIE = "kh_oauth_state";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const connection = new Hono<AppEnv>();

function missingSecrets(env: Env): string[] {
  const missing: string[] = [];
  if (!env.META_APP_SECRET) missing.push("META_APP_SECRET");
  if (!env.TOKEN_KEY) missing.push("TOKEN_KEY");
  return missing;
}

function callbackUrl(reqUrl: string) {
  return `${new URL(reqUrl).origin}/api/connection/facebook/callback`;
}

/** Long-lived token + who it belongs to + proof it can read the ad account. */
async function finishConnect(env: Env, shortToken: string, method: "oauth" | "pasted", by: string | null) {
  const v = env.META_GRAPH_VERSION;
  const long = await appGet<{ access_token: string; expires_in?: number }>(
    "oauth/access_token",
    { grant_type: "fb_exchange_token", client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET!, fb_exchange_token: shortToken },
    v,
  );
  const token = long.access_token;
  const debug = await appGet<{ data: { expires_at?: number; scopes?: string[]; is_valid?: boolean } }>(
    "debug_token",
    { input_token: token, access_token: `${env.META_APP_ID}|${env.META_APP_SECRET}` },
    v,
  );
  if (!debug.data.is_valid) throw new Error("Meta says this token isn't valid. Generate a new one and try again.");
  if (!debug.data.scopes?.includes("ads_read")) throw new Error("The token is missing the ads_read permission.");

  const gc = graphClient({ token, version: v, appSecret: env.META_APP_SECRET });
  const me = await gc.get<{ id: string; name: string }>("me", { fields: "id,name" });
  await gc.get(env.META_AD_ACCOUNT_ID, { fields: "name" }); // throws if this login can't see the account

  const expiresAt =
    debug.data.expires_at && debug.data.expires_at > 0
      ? new Date(debug.data.expires_at * 1000).toISOString()
      : long.expires_in
        ? new Date(Date.now() + long.expires_in * 1000).toISOString()
        : null;
  const { cipher, iv } = await encrypt(token, env.TOKEN_KEY!);
  await env.DB.prepare(
    `INSERT INTO meta_connections (id, method, user_id, user_name, ad_account_id, token_cipher, token_iv, expires_at, connected_at, connected_by)
     VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(id) DO UPDATE SET method = excluded.method, user_id = excluded.user_id, user_name = excluded.user_name,
       ad_account_id = excluded.ad_account_id, token_cipher = excluded.token_cipher, token_iv = excluded.token_iv,
       expires_at = excluded.expires_at, connected_at = excluded.connected_at, connected_by = excluded.connected_by`,
  )
    .bind(method, me.id, me.name, env.META_AD_ACCOUNT_ID, cipher, iv, expiresAt, new Date().toISOString(), by)
    .run();
  await wipeSampleData(env.DB);
  return { userName: me.name, expiresAt };
}

connection.get("/", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT method, user_name, ad_account_id, expires_at, connected_at, connected_by FROM meta_connections WHERE id = 1",
  ).first<Record<string, string | null>>();
  // Whose Facebook account is connected, and who connected it, is for editors only.
  const editor = await canEdit(c.env, c.get("userEmail"));
  const body: ConnectionStatus = {
    accessProtected: accessConfigured(c.env),
    userEmail: c.get("userEmail"),
    missingSecrets: missingSecrets(c.env),
    appId: c.env.META_APP_ID,
    adAccountId: c.env.META_AD_ACCOUNT_ID,
    redirectUri: callbackUrl(c.req.url),
    systemToken: Boolean(c.env.META_SYSTEM_TOKEN),
    connection: row
      ? {
          method: String(row.method),
          userName: editor ? (row.user_name ?? null) : null,
          expiresAt: row.expires_at ?? null,
          connectedAt: String(row.connected_at),
          connectedBy: editor ? (row.connected_by ?? null) : null,
        }
      : null,
    maxWindowDays: MAX_WINDOW_DAYS,
  };
  return c.json(body);
});

connection.use("/facebook/*", requireAccess);
connection.use("/token", requireAccess);
connection.use("/disconnect", requireAccess);

connection.get("/facebook/start", (c) => {
  const missing = missingSecrets(c.env);
  if (missing.length) return c.redirect(`/?meta_error=${encodeURIComponent(`Missing secrets: ${missing.join(", ")}`)}#/settings`);
  const state = randomToken();
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "Lax", path: "/api/connection", maxAge: 600 });
  const dialog = new URL(`https://www.facebook.com/${c.env.META_GRAPH_VERSION}/dialog/oauth`);
  dialog.searchParams.set("client_id", c.env.META_APP_ID);
  dialog.searchParams.set("redirect_uri", callbackUrl(c.req.url));
  dialog.searchParams.set("state", state);
  dialog.searchParams.set("scope", "ads_read");
  dialog.searchParams.set("response_type", "code");
  return c.redirect(dialog.toString());
});

connection.get("/facebook/callback", async (c) => {
  const back = (q: string) => c.redirect(`/?${q}#/settings`);
  const state = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/api/connection" });
  const err = c.req.query("error_description") ?? c.req.query("error");
  if (err) return back(`meta_error=${encodeURIComponent(err)}`);
  if (!state || state !== c.req.query("state")) return back(`meta_error=${encodeURIComponent("Login expired. Click Connect again.")}`);
  try {
    const short = await appGet<{ access_token: string }>(
      "oauth/access_token",
      {
        client_id: c.env.META_APP_ID,
        client_secret: c.env.META_APP_SECRET!,
        redirect_uri: callbackUrl(c.req.url),
        code: c.req.query("code") ?? "",
      },
      c.env.META_GRAPH_VERSION,
    );
    await finishConnect(c.env, short.access_token, "oauth", c.get("userEmail"));
    return back("meta=connected");
  } catch (e) {
    return back(`meta_error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
});

connection.post("/token", async (c) => {
  const missing = missingSecrets(c.env);
  if (missing.length) return c.json({ error: `Add these secrets in Cloudflare first: ${missing.join(", ")}` }, 400);
  const { token } = await c.req.json<{ token?: string }>().catch(() => ({ token: undefined }));
  if (!token || token.length < 20) return c.json({ error: "Paste the full access token." }, 400);
  try {
    return c.json(await finishConnect(c.env, token.trim(), "pasted", c.get("userEmail")));
  } catch (e) {
    const status = e instanceof GraphError ? 400 : 500;
    return c.json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});

connection.post("/disconnect", async (c) => {
  await c.env.DB.prepare("DELETE FROM meta_connections WHERE id = 1").run();
  return c.json({ ok: true });
});

export const sync = new Hono<AppEnv>();
sync.use("*", requireAccess);

// The dashboard warm-up (warmDashboard in worker/index.ts), set from there to avoid an import cycle.
let warmUp: ((env: Env, ctx: ExecutionContext) => Promise<unknown>) | null = null;
export function setWarmUp(fn: typeof warmUp) {
  warmUp = fn;
}

/**
 * Body: { since, until, ads, warm }. The app calls this in ≤31-day windows for a backfill; `warm`
 * (the last window, and the Dashboard's Sync now) rebuilds the dashboard's numbers before answering.
 */
sync.post("/", async (c) => {
  const body = await c.req.json<{ since?: string; until?: string; ads?: boolean; warm?: boolean }>().catch(() => ({}) as Record<string, never>);
  const { since, until } = body;
  if (!since || !until || !DAY.test(since) || !DAY.test(until) || since > until)
    return c.json({ error: "Give since and until as YYYY-MM-DD." }, 400);
  if ((Date.parse(until) - Date.parse(since)) / 86_400_000 + 1 > MAX_WINDOW_DAYS)
    return c.json({ error: `Sync at most ${MAX_WINDOW_DAYS} days per request.` }, 400);
  const result = await runSync(c.env, { since, until, ads: Boolean(body.ads) });
  if (result.ok && body.warm && warmUp) await warmUp(c.env, c.executionCtx as unknown as ExecutionContext).catch(() => undefined);
  return c.json(result, result.ok ? 200 : 502);
});
