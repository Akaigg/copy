import type { Config } from "../config/schema.js";
import type { Logger } from "../core/logger.js";
import { Priority } from "../core/rateLimiter.js";
import { errMsg, first, lamportsToSol, num, SOL_MINT, solToLamports, sleep, str, toRaw } from "../core/utils.js";
import { GmgnApiError, type GmgnClient, type SwapParams } from "../gmgn/client.js";
import type { BuyRequest, BuyResult, Executor, PriceOracle, SellRequest, SellResult } from "./types.js";

const SUCCESS = new Set(["confirmed", "successful", "success", "finalized"]);
const FAILURE = new Set(["failed", "expired", "fail", "error", "cancelled", "canceled"]);

interface OrderOutcome {
  status: "success" | "failed" | "timeout";
  data?: Record<string, unknown>;
  orderId?: string;
  error?: string;
}

/**
 * Execução real via OpenAPI da GMGN (POST /v1/trade/swap + polling em /v1/trade/query_order).
 * A carteira usada é a vinculada à API key na GMGN; o robô nunca toca na chave da carteira.
 */
export class LiveExecutor implements Executor {
  readonly mode = "live" as const;
  private readonly log: Logger;

  constructor(
    private readonly cfg: Config,
    private readonly client: GmgnClient,
    private readonly wallet: string,
    private readonly oracle: PriceOracle,
    logger: Logger,
  ) {
    this.log = logger.child("live");
  }

  private baseParams(s: BuyRequest["strategy"]): Partial<SwapParams> {
    return {
      chain: this.cfg.chain,
      from_address: this.wallet,
      is_anti_mev: s.antiMev,
      priority_fee: String(s.priorityFeeSol),
      tip_fee: String(s.tipFeeSol),
    };
  }

  async buy(req: BuyRequest): Promise<BuyResult> {
    const lamports = solToLamports(req.sizeSol);
    const params: SwapParams = {
      ...(this.baseParams(req.strategy) as SwapParams),
      input_token: SOL_MINT,
      output_token: req.token.address,
      input_amount: lamports.toString(),
      slippage: req.strategy.slippagePct,
    };
    const out = await this.submit(params, Priority.Buy);
    if (out.status === "failed") return { ok: false, error: out.error ?? "ordem falhou", orderId: out.orderId };
    if (out.status === "timeout") return { ok: false, error: out.error ?? "timeout", uncertain: true, orderId: out.orderId };

    const rep = (out.data?.["report"] ?? {}) as Record<string, unknown>;
    const decimals = num(rep["output_token_decimals"]) ?? 6;
    let tokensRaw = parseBig(rep["output_amount"]);
    if (tokensRaw === undefined || tokensRaw === 0n) {
      // Sem relatório: lê o saldo on-chain do token.
      tokensRaw = (await this.getTokenBalanceRaw(req.token.address, decimals)) ?? 0n;
    }
    if (tokensRaw === 0n) return { ok: false, error: "ordem confirmada mas sem tokens recebidos", uncertain: true, orderId: out.orderId };

    const spentLamports = parseBig(rep["input_amount"]) ?? lamports;
    const fees = req.strategy.priorityFeeSol + req.strategy.tipFeeSol;
    const spentSol = lamportsToSol(spentLamports) + fees;
    let priceUsd = num(rep["price_usd"]);
    if (!priceUsd) {
      const sol = await this.oracle.solPriceUsd();
      priceUsd = (lamportsToSol(spentLamports) * sol) / (Number(tokensRaw) / 10 ** decimals);
    }
    return {
      ok: true,
      tokensRaw,
      decimals,
      priceUsd,
      spentSol,
      orderId: out.orderId,
      tx: str(out.data?.["hash"]),
    };
  }

  async sell(req: SellRequest): Promise<SellResult> {
    const steps = this.cfg.execution.sellSlippageStepsPct;
    let lastErr = "";
    for (const slippage of steps) {
      const params: SwapParams = {
        ...(this.baseParams(req.strategy) as SwapParams),
        input_token: req.position.tokenAddress,
        output_token: SOL_MINT,
        // Venda total usa bps=10000 para limpar a carteira (inclui poeira).
        input_amount: req.full ? "0" : req.amountRaw.toString(),
        slippage,
      };
      if (req.full) params.input_amount_bps = "10000";
      const out = await this.submit(params, Priority.Sell);
      if (out.status === "success") {
        const rep = (out.data?.["report"] ?? {}) as Record<string, unknown>;
        const received = parseBig(rep["output_amount"]);
        const sold = parseBig(rep["input_amount"]) ?? req.amountRaw;
        const fees = req.strategy.priorityFeeSol + req.strategy.tipFeeSol;
        let receivedSol = received !== undefined ? lamportsToSol(received) : undefined;
        if (receivedSol === undefined) {
          const sol = await this.oracle.solPriceUsd();
          receivedSol = ((Number(sold) / 10 ** req.position.tokenDecimals) * req.priceUsd) / sol;
          this.log.warn(`Venda sem relatório; SOL recebido estimado em ${receivedSol.toFixed(4)}`);
        }
        return {
          ok: true,
          soldRaw: sold,
          receivedSol: Math.max(0, receivedSol - fees),
          priceUsd: num(rep["price_usd"]) ?? req.priceUsd,
          tx: str(out.data?.["hash"]),
          orderId: out.orderId,
        };
      }
      lastErr = out.error ?? out.status;
      if (out.status === "timeout") return { ok: false, error: lastErr, uncertain: true };
      this.log.warn(`Venda de ${req.position.symbol} falhou com slippage ${slippage}%: ${lastErr}`);
    }
    return { ok: false, error: lastErr };
  }

  /** Envia o swap e acompanha o status até confirmar, falhar ou estourar o timeout. */
  private async submit(params: SwapParams, priority: Priority): Promise<OrderOutcome> {
    let resp: Record<string, unknown>;
    try {
      resp = await this.client.swap(params, priority);
    } catch (e) {
      // Erro 4xx explícito do servidor = ordem não criada. Rede/5xx = estado incerto.
      if (e instanceof GmgnApiError && e.status < 500) return { status: "failed", error: e.message };
      return { status: "timeout", error: errMsg(e) };
    }
    const orderId = str(resp?.["order_id"]);
    let data = resp;
    const deadline = Date.now() + this.cfg.execution.orderTimeoutMs;
    while (true) {
      const status = (str(data?.["status"]) ?? "").toLowerCase();
      if (SUCCESS.has(status)) return { status: "success", data, orderId };
      if (FAILURE.has(status)) {
        const err = [str(data?.["error_code"]), str(data?.["error_status"])].filter(Boolean).join(" ");
        return { status: "failed", data, orderId, error: err || status };
      }
      if (!orderId) return { status: "timeout", data, error: "resposta sem order_id" };
      if (Date.now() > deadline) return { status: "timeout", data, orderId, error: `ordem ${orderId} sem confirmação` };
      await sleep(this.cfg.execution.orderPollIntervalMs);
      try {
        data = await this.client.queryOrder(this.cfg.chain, orderId, priority);
      } catch (e) {
        this.log.debug(`query_order ${orderId}: ${errMsg(e)}`);
      }
    }
  }

  async getSolBalance(): Promise<number | undefined> {
    try {
      const d = await this.client.getWalletTokenBalance(this.cfg.chain, this.wallet, SOL_MINT, Priority.Monitor);
      const lamports = num(first(d, "native_balance", "raw_balance", "amount_raw"));
      if (lamports !== undefined) return lamports / 1e9;
      return num(first(d, "balance", "amount", "amount_cur"));
    } catch (e) {
      this.log.debug(`Saldo SOL indisponível: ${errMsg(e)}`);
      return undefined;
    }
  }

  async getTokenBalanceRaw(token: string, decimals: number): Promise<bigint | undefined> {
    try {
      const d = await this.client.getWalletTokenBalance(this.cfg.chain, this.wallet, token, Priority.Monitor);
      const raw = parseBig(first(d, "raw_balance", "amount_raw", "raw_amount"));
      if (raw !== undefined) return raw;
      const human = num(first(d, "balance", "amount", "amount_cur"));
      return human === undefined ? undefined : toRaw(human, decimals);
    } catch (e) {
      this.log.debug(`Saldo de ${token} indisponível: ${errMsg(e)}`);
      return undefined;
    }
  }
}

function parseBig(v: unknown): bigint | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  try {
    const s = String(v).split(".")[0]!;
    return BigInt(s);
  } catch {
    return undefined;
  }
}
