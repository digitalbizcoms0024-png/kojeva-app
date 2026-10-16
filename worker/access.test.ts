import { beforeAll, describe, expect, it } from "vitest";
import { verifyAccessJwt } from "./access.ts";

const TEAM = "kojeva.cloudflareaccess.com";
const AUD = "aud-tag-123";
let keys: CryptoKeyPair;
let certsFetch: typeof fetch;

const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sign(payload: Record<string, unknown>, kid = "k1", key = keys.privateKey) {
  const h = b64url(JSON.stringify({ alg: "RS256", kid }));
  const p = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

const valid = () => ({ aud: [AUD], iss: `https://${TEAM}`, email: "founder@kojeva.com", exp: Math.floor(Date.now() / 1000) + 600 });

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1" };
  certsFetch = (async (url: string) => {
    expect(url).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
    return Response.json({ keys: [jwk] });
  }) as unknown as typeof fetch;
});

describe("verifyAccessJwt", () => {
  it("accepts a valid token and returns the email", async () => {
    expect(await verifyAccessJwt(await sign(valid()), TEAM, AUD, certsFetch)).toBe("founder@kojeva.com");
  });

  it("rejects expired, wrong-audience and wrong-issuer tokens", async () => {
    expect(await verifyAccessJwt(await sign({ ...valid(), exp: 1 }), TEAM, AUD, certsFetch)).toBeNull();
    expect(await verifyAccessJwt(await sign({ ...valid(), aud: ["other"] }), TEAM, AUD, certsFetch)).toBeNull();
    expect(await verifyAccessJwt(await sign({ ...valid(), iss: "https://evil.cloudflareaccess.com" }), TEAM, AUD, certsFetch)).toBeNull();
  });

  it("accepts any audience from the team when no AUD is configured", async () => {
    expect(await verifyAccessJwt(await sign({ ...valid(), aud: ["other-app"] }), TEAM, undefined, certsFetch)).toBe("founder@kojeva.com");
    expect(await verifyAccessJwt(await sign({ ...valid(), iss: "https://evil.cloudflareaccess.com" }), TEAM, undefined, certsFetch)).toBeNull();
  });

  it("rejects a token signed by another key or with a tampered payload", async () => {
    const other = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    expect(await verifyAccessJwt(await sign(valid(), "k1", other.privateKey), TEAM, AUD, certsFetch)).toBeNull();
    const [h, , s] = (await sign(valid())).split(".");
    const forged = `${h}.${b64url(JSON.stringify({ ...valid(), email: "attacker@x.com" }))}.${s}`;
    expect(await verifyAccessJwt(forged, TEAM, AUD, certsFetch)).toBeNull();
    expect(await verifyAccessJwt("not-a-jwt", TEAM, AUD, certsFetch)).toBeNull();
  });
});
