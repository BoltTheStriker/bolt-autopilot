// Minimal signed client for Strike's copy-trading API (API-wallet auth, Ed25519).
// Uses Node's built-in crypto, no dependencies. API wallets can trade but can never
// withdraw; bind the key to a dedicated sub-account so it can only touch that money.
import { createHash, createPrivateKey, randomUUID, sign, type KeyObject } from "node:crypto";

export type SubAccount = { account_id: string; name: string; status?: string; equity?: string; available_balance?: string; margin_used_pct?: string };

export type CopySub = {
  subscription_id: string;
  account_id?: string; // with scope=all: the (sub-)account the copy runs in
  total_volume?: string; // the copy's traded volume so far (USD)
  filled_order_count?: number;
  lead_account_id: string;
  lead_platform: string;
  copy_mode: string;
  copy_amount?: string;
  stop_loss_amount?: string;
  status: string;
  stop_reason?: string;
  pnl?: string;
  realized_pnl?: string;
  total_worth?: string;
  total_margin?: string;
  created_at_ms?: number;
};

/** One copy's slice of an open position (GET /v2/copy/positions). `pnl` is unrealized at mark. */
export type CopyPosition = {
  subscription_id?: string;
  own?: boolean;
  market: string;
  side: string;
  entry_price?: string;
  mark_price?: string;
  size?: string;
  pnl?: string;
};

export class StrikeClient {
  private key: KeyObject;
  private publicKeyHex: string;
  private base: string;
  constructor(publicKeyHex: string, privateKeyHex: string, base = "https://api.strikefinance.org") {
    this.publicKeyHex = publicKeyHex.trim();
    this.base = base;
    // Accept a 32-byte seed or a 64-byte expanded key (first 32 bytes are the seed).
    const raw = Buffer.from(privateKeyHex.trim(), "hex");
    const seed = raw.length === 64 ? raw.subarray(0, 32) : raw;
    if (seed.length !== 32) throw new Error("STRIKE_API_PRIVATE_KEY must be 64 or 128 hex chars");
    // Wrap the raw seed as PKCS#8 DER so Node can load it as an Ed25519 key.
    const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
    this.key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  }

  /** Signed request. Message: METHOD:PATH(+query):TIMESTAMP:NONCE:sha256hex(body). */
  async request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const bodyStr = body === undefined ? "" : JSON.stringify(body);
    const ts = Math.floor(Date.now() / 1000).toString();
    const nonce = randomUUID();
    const bodyHash = createHash("sha256").update(bodyStr).digest("hex");
    const signature = sign(null, Buffer.from(`${method}:${path}:${ts}:${nonce}:${bodyHash}`), this.key).toString("hex");
    const res = await fetch(this.base + path, {
      method,
      headers: {
        "X-API-Wallet-Public-Key": this.publicKeyHex,
        "X-API-Wallet-Signature": signature,
        "X-API-Wallet-Timestamp": ts,
        "X-API-Wallet-Nonce": nonce,
        ...(bodyStr ? { "content-type": "application/json" } : {}),
        accept: "application/json",
      },
      body: bodyStr || undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) throw new Error(`Strike ${method} ${path} → ${res.status} ${typeof data === "string" ? data : JSON.stringify(data)}`.slice(0, 400));
    return { status: res.status, data: data as T };
  }

  account() {
    return this.request<Record<string, unknown>>("GET", "/v2/account").then((r) => r.data);
  }

  /** Open positions split per copy subscription (rows with `own: true` aren't copies). */
  /** `all`: include every sub-account (isolated copies live in their own sub-accounts). */
  async copyPositions(all = false): Promise<CopyPosition[]> {
    const { data } = await this.request<CopyPosition[] | { positions?: CopyPosition[] }>("GET", `/v2/copy/positions${all ? "?scope=all" : ""}`);
    return Array.isArray(data) ? data : data?.positions ?? [];
  }

  async subscriptions(status: "active" | "stopped" = "active", all = false): Promise<CopySub[]> {
    const { data } = await this.request<{ subscriptions: CopySub[] }>("GET", `/v2/copy/subscriptions?status=${status}${all ? "&scope=all" : ""}`);
    return data?.subscriptions ?? [];
  }

  /** Fixed-ratio copy of a Hyperliquid lead with Strike-side caps and stop-loss, including its open positions. */
  subscribe(lead: string, copyAmount: number, stopLossUsd: number) {
    const usd = (n: number) => n.toFixed(2);
    return this.request<CopySub>("POST", "/v2/copy/subscribe", {
      lead_account_id: lead,
      platform: "hyperliquid",
      copy_mode: "fixed_ratio",
      copy_amount: usd(copyAmount),
      max_margin_total: usd(copyAmount),
      stop_loss_amount: usd(stopLossUsd),
      // Also enter the lead's already-open positions once, at mark, so the copy is invested
      // from the start (like the paper engine) instead of waiting for the lead's next trade.
      copy_existing_positions: true,
    }).then((r) => r.data);
  }

  /**
   * Autopilot copy from the user's main account (like the live bot's copies): Strike reserves the
   * copy amount there, and stopping the copy releases it back to the main balance, so it stays
   * withdrawable. The user's limits ride along: money cap, per-market cap, excluded markets,
   * multiplier, stop-loss, and the leverage new positions open at (`leverage: false` leaves it out).
   */
  subscribeShared(spec: { lead: string; amount: number; stopLossUsd: number; maxLeverage: number; multiplier: number; maxMarginPerSymbol: number; excludedSymbols: string[] }, leverage = true) {
    const usd = (n: number) => n.toFixed(2);
    return this.request<CopySub & { status?: string; error?: string }>("POST", "/v2/copy/subscribe", {
      lead_account_id: spec.lead,
      platform: "hyperliquid",
      copy_mode: "fixed_ratio",
      copy_amount: usd(spec.amount),
      max_margin_total: usd(spec.amount),
      max_margin_per_symbol: usd(spec.maxMarginPerSymbol),
      ratio_multiplier: String(Math.round(spec.multiplier)),
      stop_loss_amount: usd(spec.stopLossUsd),
      excluded_symbols: spec.excludedSymbols,
      ...(leverage ? { margin_settings: { default_leverage: Math.round(spec.maxLeverage) } } : {}),
      copy_existing_positions: true,
    }).then((r) => r.data);
  }

  /**
   * Autopilot copy: its own Strike sub-account (so one bad copy can't take margin from the others)
   * with the user's limits enforced by Strike: leverage cap, per-symbol cap, excluded markets,
   * multiplier and stop-loss. Setup is asynchronous: Strike answers 202 while it creates and funds
   * the sub-account; repeat the same call (same request id and body) until it's `active`.
   */
  subscribeIsolated(spec: { requestId: string; sourceAccountId: string; lead: string; amount: number; stopLossUsd: number; maxLeverage: number; multiplier: number; maxMarginPerSymbol: number; excludedSymbols: string[] }) {
    const usd = (n: number) => n.toFixed(2);
    return this.request<CopySub & { status: string; error?: string; sub_account_id?: string }>("POST", "/v2/copy/subscribe", {
      auto_create_sub_account: true,
      request_id: spec.requestId,
      source_account_id: spec.sourceAccountId,
      lead_account_id: spec.lead,
      platform: "hyperliquid",
      copy_mode: "fixed_ratio",
      copy_amount: usd(spec.amount),
      max_margin_total: usd(spec.amount),
      max_margin_per_symbol: usd(spec.maxMarginPerSymbol),
      ratio_multiplier: String(Math.round(spec.multiplier)),
      stop_loss_amount: usd(spec.stopLossUsd),
      excluded_symbols: spec.excludedSymbols,
      leverage_source: "lead",
      max_leverage: Math.round(spec.maxLeverage),
      margin_settings: { default_leverage: Math.round(spec.maxLeverage) },
      copy_existing_positions: true,
    }).then((r) => r.data);
  }

  /** The caller's sub-accounts (copy sub-accounts included) with balances. */
  async subAccounts(): Promise<SubAccount[]> {
    const { data } = await this.request<{ sub_accounts?: SubAccount[] }>("GET", "/v2/sub-accounts");
    return data?.sub_accounts ?? [];
  }

  /** Starts a copy inside an existing sub-account that already holds the money (e.g. one whose
   *  earlier copy ended: Strike leaves the money there). Synchronous: 201 active. */
  subscribeInto(subAccountId: string, spec: { lead: string; amount: number; stopLossUsd: number; maxLeverage: number; multiplier: number; maxMarginPerSymbol: number; excludedSymbols: string[] }) {
    const usd = (n: number) => n.toFixed(2);
    return this.request<CopySub & { status: string; error?: string }>("POST", "/v2/copy/subscribe", {
      sub_account_id: subAccountId,
      lead_account_id: spec.lead,
      platform: "hyperliquid",
      copy_mode: "fixed_ratio",
      copy_amount: usd(spec.amount),
      max_margin_total: usd(spec.amount),
      max_margin_per_symbol: usd(spec.maxMarginPerSymbol),
      ratio_multiplier: String(Math.round(spec.multiplier)),
      stop_loss_amount: usd(spec.stopLossUsd),
      excluded_symbols: spec.excludedSymbols,
      leverage_source: "lead",
      max_leverage: Math.round(spec.maxLeverage),
      margin_settings: { default_leverage: Math.round(spec.maxLeverage) },
      copy_existing_positions: true,
    }).then((r) => r.data);
  }

  /** Stops copying and closes the copied positions at market. */
  stop(subscriptionId: string, subAccountId?: string) {
    return this.request<null>("DELETE", `/v2/copy/subscribe/${subscriptionId}${subAccountId ? `?sub_account_id=${subAccountId}` : ""}`);
  }
}
