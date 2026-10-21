import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto.ts";

const KEY = "a-test-key-that-is-definitely-longer-than-32-chars";

describe("token encryption", () => {
  it("round-trips and uses a fresh IV each time", async () => {
    const a = await encrypt("EAAB-secret-token", KEY);
    const b = await encrypt("EAAB-secret-token", KEY);
    expect(a.cipher).not.toBe(b.cipher);
    expect(a.cipher).not.toContain("EAAB");
    expect(await decrypt(a.cipher, a.iv, KEY)).toBe("EAAB-secret-token");
  });
  it("fails with the wrong key", async () => {
    const a = await encrypt("token", KEY);
    await expect(decrypt(a.cipher, a.iv, `${KEY}-other`)).rejects.toThrow();
  });
  it("rejects short keys", async () => {
    await expect(encrypt("token", "short")).rejects.toThrow(/32 characters/);
  });
});
