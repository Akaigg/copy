import { Priority, RateLimiter } from "../core/rateLimiter.js";
import type { Logger } from "../core/logger.js";
import { errMsg, sleep } from "../core/utils.js";
import { buildAuthQuery, buildMessage, buildUrl, detectAlgorithm, sign, type QueryValue, type SignAlgorithm } from "./signer.js";

/** Peso de cada rota no rate-limit da GMGN (documentação oficial do gmgn-cli). */
export const ROUTE_WEIGHTS: Record<string, number> = {
  "/v1/trenches": 2,
  "/v1/market/rank": 3,
  "/v1/market/token_kline": 2,
  "/v1/market/token_signal": 1,
  "/v1/token/info": 1,
  "/v1/token/security": 1,
  "/v1/token/pool_info": 1,
  "/v1/user/info": 1,
  "/v1/user/wallet_token_balance": 2,
  "/v1/trade/quote": 10,
  "/v1/trade/swap": 10,
  "/v1/trade/query_order": 5,
  "/v1/trade/gas_price": 1,
};

const PLAN_LIMITS = { free: { rate: 5, capacity: 5 }, plus: { rate: 20, capacity: 20 }, pro: { rate: 50, capacity: 50 } };

export class GmgnApiError extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly status: number,
    readonly apiCode?: number | string,
    readonly apiError?: string,
    readonly resetAtMs?: number,
  ) {
    super(message);
    this.name = "GmgnApiError";
  }
  get isRateLimit() {
    return this.status === 429 || (this.apiError ?? "").startsWith("RATE_LIMIT") || this.apiError === "ERROR_RATE_LIMIT_BLOCKED";
  }
  get isPlanUpgrade() {
    return this.apiError === "PLAN_UPGRADE_REQUIRED";
  }
  get isAuth() {
    return this.status === 401 || this.status === 403;
  }
}

export interface GmgnClientOptions {
  host: string;
  apiKey: string;
  privateKeyPem?: string;
  plan: keyof typeof PLAN_LIMITS;
  rateOverride?: number;
  capacityOverride?: number;
  rateSafetyFactor: number;
  timeoutMs: number;
  maxRetries: number;
  logger: Logger;
}

interface RequestOpts {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  signed?: boolean;
  priority?: Priority;
  /** Rotas que alteram estado (swap) nunca são repetidas automaticamente. */
  idempotent?: boolean;
}

export interface SwapParams {
  chain: string;
  from_address: string;
  input_token: string;
  output_token: string;
  input_amount: string;
  input_amount_bps?: string;
  slippage?: number;
  auto_slippage?: boolean;
  is_anti_mev?: boolean;
  priority_fee?: string;
  tip_fee?: string;
  condition_orders?: unknown[];
}

/** Cliente da OpenAPI oficial da GMGN (https://openapi.gmgn.ai). */
export class GmgnClient {
  readonly limiter: RateLimiter;
  private readonly host: string;
  private readonly algo?: SignAlgorithm;
  private readonly log: Logger;

  constructor(private readonly opts: GmgnClientOptions) {
    this.host = opts.host.replace(/\/$/, "");
    const plan = PLAN_LIMITS[opts.plan];
    const rate = (opts.rateOverride ?? plan.rate) * opts.rateSafetyFactor;
    const capacity = opts.capacityOverride ?? plan.capacity;
    this.limiter = new RateLimiter(rate, capacity);
    this.algo = opts.privateKeyPem ? detectAlgorithm(opts.privateKeyPem) : undefined;
    this.log = opts.logger.child("gmgn");
  }

  get canSign() {
    return !!this.algo;
  }

  // ---------- Dados de mercado ----------

  getTrenches(chain: string, body: Record<string, unknown>) {
    return this.request<Record<string, unknown>>({ method: "POST", path: "/v1/trenches", query: { chain }, body, idempotent: true });
  }

  getRank(chain: string, interval: string, extra: Record<string, QueryValue> = {}) {
    return this.request<{ rank?: unknown[] } | unknown[]>({
      method: "GET",
      path: "/v1/market/rank",
      query: { chain, interval, ...extra },
    });
  }

  getTokenInfo(chain: string, address: string, priority = Priority.Monitor) {
    return this.request<Record<string, unknown>>({ method: "GET", path: "/v1/token/info", query: { chain, address }, priority });
  }

  getTokenSecurity(chain: string, address: string, priority = Priority.Buy) {
    return this.request<Record<string, unknown>>({ method: "GET", path: "/v1/token/security", query: { chain, address }, priority });
  }

  getUserInfo() {
    return this.request<Record<string, unknown>>({ method: "GET", path: "/v1/user/info", query: {} });
  }

  getWalletTokenBalance(chain: string, wallet: string, token: string, priority = Priority.Monitor) {
    return this.request<Record<string, unknown>>({
      method: "GET",
      path: "/v1/user/wallet_token_balance",
      query: { chain, wallet_address: wallet, token_address: token },
      priority,
    });
  }

  // ---------- Trading ----------

  quote(chain: string, from: string, inputToken: string, outputToken: string, amount: string, slippage: number) {
    return this.request<Record<string, unknown>>({
      method: "GET",
      path: "/v1/trade/quote",
      query: { chain, from_address: from, input_token: inputToken, output_token: outputToken, input_amount: amount, slippage },
      priority: Priority.Buy,
    });
  }

  swap(params: SwapParams, priority: Priority) {
    return this.request<Record<string, unknown>>({
      method: "POST",
      path: "/v1/trade/swap",
      body: params,
      signed: true,
      priority,
      idempotent: false,
    });
  }

  queryOrder(chain: string, orderId: string, priority: Priority) {
    return this.request<Record<string, unknown>>({
      method: "GET",
      path: "/v1/trade/query_order",
      query: { order_id: orderId, chain },
      signed: true,
      priority,
    });
  }

  // ---------- Núcleo HTTP ----------

  private async request<T>(o: RequestOpts): Promise<T> {
    const idempotent = o.idempotent ?? o.method === "GET";
    const attempts = idempotent ? this.opts.maxRetries + 1 : 1;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.limiter.acquire(ROUTE_WEIGHTS[o.path] ?? 1, o.priority ?? Priority.Scan);
        return await this.once<T>(o);
      } catch (e) {
        lastErr = e;
        if (e instanceof GmgnApiError) {
          if (e.isRateLimit) {
            const until = e.resetAtMs ?? Date.now() + 5000;
            this.limiter.pauseUntil(until + 500);
            this.log.warn(`Rate limit da GMGN (${e.apiError ?? e.status}); pausando ${Math.ceil((until - Date.now()) / 1000)}s`);
          } else if (e.isPlanUpgrade || e.isAuth || (e.status >= 400 && e.status < 500)) {
            throw e; // erro de negócio: repetir não ajuda
          }
        }
        if (attempt < attempts) await sleep(300 * attempt);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(errMsg(lastErr));
  }

  private async once<T>(o: RequestOpts): Promise<T> {
    const auth = buildAuthQuery();
    const query: Record<string, QueryValue> = { ...(o.query ?? {}), timestamp: auth.timestamp, client_id: auth.client_id };
    const bodyStr = o.body !== undefined ? JSON.stringify(o.body) : "";
    const headers: Record<string, string> = {
      "X-APIKEY": this.opts.apiKey,
      "Content-Type": "application/json",
      "User-Agent": "gmgn-hot-bot/1.0",
    };
    if (o.signed) {
      if (!this.algo || !this.opts.privateKeyPem) {
        throw new Error("GMGN_PRIVATE_KEY é obrigatória para swap/ordens/saldo (rotas assinadas)");
      }
      headers["X-Signature"] = sign(buildMessage(o.path, query, bodyStr, auth.timestamp), this.opts.privateKeyPem, this.algo);
    }
    const url = buildUrl(`${this.host}${o.path}`, query);

    let res: Response;
    try {
      res = await fetch(url, {
        method: o.method,
        headers,
        body: bodyStr || undefined,
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (e) {
      throw new Error(`${o.method} ${o.path} falhou na rede: ${errMsg(e)}`);
    }

    const text = await res.text();
    let json: { code?: number | string; data?: T; error?: string; message?: string; msg?: string; reset_at?: number };
    try {
      json = JSON.parse(text);
    } catch {
      throw new GmgnApiError(`${o.method} ${o.path}: HTTP ${res.status} (resposta não-JSON)`, o.path, res.status);
    }
    if (res.status >= 400 || (json.code !== 0 && json.code !== "0" && json.code !== undefined)) {
      const resetHeader = Number(res.headers.get("x-ratelimit-reset"));
      const resetAt = json.reset_at ?? (Number.isFinite(resetHeader) && resetHeader > 0 ? resetHeader : undefined);
      throw new GmgnApiError(
        `${o.method} ${o.path}: HTTP ${res.status} code=${json.code} ${json.error ?? ""} ${json.message ?? json.msg ?? ""}`.trim(),
        o.path,
        res.status,
        json.code,
        json.error,
        resetAt ? resetAt * 1000 : undefined,
      );
    }
    return json.data as T;
  }
}
