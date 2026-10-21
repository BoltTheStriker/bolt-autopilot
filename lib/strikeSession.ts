// The user's own Strike login, in their browser: the same wallet-signature login Strike's app uses.
// Bolt needs it only for what builder API keys can't do, like moving money from a copy sub-account
// back to the main account before a withdrawal. The token goes from Strike to this browser and is
// never sent to Bolt's server.
import { signHexPayload } from "./wallet";

export const strikeApi = (network: "mainnet" | "testnet") => (network === "mainnet" ? "https://api.strikefinance.org" : "https://api-v2-testnet.strikefinance.org");

const toHex = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

async function post<T>(url: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ? `Strike: ${j.error}` : `Strike ${res.status}`);
  return j as T;
}

/** Logs in to Strike with the wallet (one free signature). `address` is the account's bech32 address. */
export async function strikeLogin(api: string, walletKey: string, address: string): Promise<string> {
  const { message } = await post<{ message: string }>(`${api}/auth/request-signature`, { address, chain: "cardano" });
  const payload = /^[0-9a-fA-F]+$/.test(message) && message.length % 2 === 0 ? message.toLowerCase() : toHex(message);
  const sig = await signHexPayload(walletKey, payload);
  if (sig.address !== address) throw new Error("Sign with the wallet linked to your Strike account.");
  const r = await post<{ token?: string }>(`${api}/auth/verify-signature`, { address, chain: "cardano", message, signature: sig.wallet_signature });
  if (!r.token) throw new Error("Strike didn't log you in.");
  return r.token;
}

/** Moves USD between the user's own Strike accounts (a copy sub-account → the main account). */
export function moveBetweenAccounts(api: string, token: string, from: string, to: string, amount: number) {
  return post<unknown>(`${api}/v2/sub-accounts/transfer`, { from_account_id: from, to_account_id: to, amount: amount.toFixed(2), request_id: crypto.randomUUID() }, token);
}
