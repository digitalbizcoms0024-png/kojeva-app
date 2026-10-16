// Test helper: a signing key and a stubbed Access certs endpoint, so tests can call
// routes behind Cloudflare Access with a genuinely signed token.
import { vi } from "vitest";

export const TEST_TEAM = "test-team.cloudflareaccess.com";

const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function accessFixture(email = "nosa@kojeva.com") {
  const keys = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const kid = `k${Math.random().toString(36).slice(2)}`;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid };
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `https://${TEST_TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    return realFetch(input, init);
  }) as typeof fetch);

  const h = b64url(JSON.stringify({ alg: "RS256", kid }));
  const p = b64url(JSON.stringify({ aud: ["aud"], iss: `https://${TEST_TEAM}`, email, exp: Math.floor(Date.now() / 1000) + 3600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${h}.${p}`));
  const token = `${h}.${p}.${b64url(new Uint8Array(sig))}`;
  return { token, headers: { "Cf-Access-Jwt-Assertion": token, "Content-Type": "application/json" } };
}
