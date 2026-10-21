// node --experimental-strip-types --test worker/autopilotStore.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { StrikeClient } from "./strike-live.ts";
import { checkSession, decrypt, encrypt, newApiKeyPair, newSession, publicKeyOf, publicUser, type AutoUser } from "./autopilotStore.ts";

const user = (): AutoUser => ({ stake: "stake1x", address: "addr1x", accountId: "acc", apiPublicKey: "", apiPrivateKeyEnc: "", network: "testnet", createdAt: 0, rules: null, mode: "off", managed: {}, log: [], sessions: [] });

test("API key pairs are Strike-compatible: the seed loads in our Strike client and matches its public key", () => {
  const k = newApiKeyPair();
  assert.match(k.publicKey, /^[0-9a-f]{64}$/);
  assert.match(k.privateKey, /^[0-9a-f]{64}$/);
  assert.equal(publicKeyOf(k.privateKey), k.publicKey);
  assert.doesNotThrow(() => new StrikeClient(k.publicKey, k.privateKey));
});

test("keys are encrypted at rest; the wrong secret can't read them; tampering is caught", () => {
  const enc = encrypt("seed-hex", "secret-1");
  assert.ok(!enc.includes("seed-hex"));
  assert.equal(decrypt(enc, "secret-1"), "seed-hex");
  assert.throws(() => decrypt(enc, "secret-2"));
  const [iv, tag, body] = enc.split(".");
  assert.throws(() => decrypt([iv, tag, (body[0] === "a" ? "b" : "a") + body.slice(1)].join("."), "secret-1"));
});

test("sessions: only the issued token works, until it expires; the public view hides secrets", () => {
  const u = user();
  const t = newSession(u, 1000);
  assert.ok(checkSession(u, t, 2000));
  assert.ok(!checkSession(u, "nope", 2000));
  assert.ok(!checkSession(u, t, 1000 + 31 * 86_400_000));
  assert.ok(!JSON.stringify(u.sessions).includes(t)); // only the hash is stored
  u.apiPrivateKeyEnc = "secret";
  assert.ok(!JSON.stringify(publicUser(u)).includes("secret"));
});
