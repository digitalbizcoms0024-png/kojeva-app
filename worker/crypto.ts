// AES-GCM encryption for the stored Meta token. The key is derived from the
// TOKEN_KEY secret, so a copy of the database alone doesn't reveal the token.

const enc = new TextEncoder();

function b64(bytes: ArrayBuffer | Uint8Array): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("TOKEN_KEY must be at least 32 characters.");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plain: string, secret: string): Promise<{ cipher: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), enc.encode(plain));
  return { cipher: b64(cipher), iv: b64(iv) };
}

export async function decrypt(cipher: string, iv: string, secret: string): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) as BufferSource },
    await key(secret),
    unb64(cipher) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

export function randomToken(bytes = 24): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/[+/=]/g, "");
}
