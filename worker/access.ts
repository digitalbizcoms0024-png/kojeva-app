// Verifies the Cloudflare Access JWT on each request, so the app stays locked even
// if the Access setting in the dashboard is switched off by mistake.
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env.ts";

interface Jwk extends JsonWebKey {
  kid: string;
}

let certCache: { team: string; keys: Jwk[]; at: number } | null = null;

async function certs(team: string, fetcher: typeof fetch): Promise<Jwk[]> {
  if (certCache && certCache.team === team && Date.now() - certCache.at < 3_600_000) return certCache.keys;
  const res = await fetcher(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Couldn't load Access certificates (${res.status})`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  certCache = { team, keys, at: Date.now() };
  return keys;
}

function b64urlDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Returns the signed-in email, or null if the token is missing or invalid. */
export async function verifyAccessJwt(
  token: string,
  team: string,
  aud: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<string | null> {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h))) as { kid?: string; alg?: string };
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as {
      aud?: string | string[];
      exp?: number;
      iss?: string;
      email?: string;
    };
    if (header.alg !== "RS256") return null;
    const jwk = (await certs(team, fetcher)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const cryptoKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      b64urlDecode(s) as BufferSource,
      new TextEncoder().encode(`${h}.${p}`),
    );
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!ok || !auds.includes(aud) || payload.iss !== `https://${team}`) return null;
    if (!payload.exp || payload.exp * 1000 < now) return null;
    return payload.email ?? "unknown";
  } catch {
    return null;
  }
}

export function accessConfigured(env: AppEnv["Bindings"]): boolean {
  return Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
}

/**
 * When Access is configured, every /api request must carry a valid Access JWT.
 * When it isn't, reads still work (sample data) but routes that touch Meta refuse.
 */
export const accessMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("userEmail", null);
  if (!accessConfigured(c.env)) return next();
  const token =
    c.req.header("Cf-Access-Jwt-Assertion") ??
    /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(c.req.header("Cookie") ?? "")?.[1];
  const email = token ? await verifyAccessJwt(token, c.env.ACCESS_TEAM_DOMAIN!, c.env.ACCESS_AUD!) : null;
  if (!email) return c.json({ error: "Sign in through Cloudflare Access to use Kojeva Hub." }, 401);
  c.set("userEmail", email);
  return next();
};

/** Guards routes that read or store Meta credentials. */
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!accessConfigured(c.env))
    return c.json(
      { error: "Turn on Cloudflare Access for this app before connecting Meta (see Settings)." },
      403,
    );
  return next();
};
