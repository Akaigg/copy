import type { Config } from "../config/schema.js";
import type { StateStore } from "../core/store.js";
import { fromRaw, toRaw } from "../core/utils.js";
import type { BuyRequest, BuyResult, Executor, PriceOracle, SellRequest, SellResult } from "./types.js";

/** Decimais padrão de tokens de launchpad na Solana (Pump.fun, letsbonk = 6). */
const DEFAULT_DECIMALS = 6;

/**
 * Execução simulada (paper trading): usa o preço atual da GMGN e modela
 * impacto de preço pela liquidez, slippage extra, taxa da plataforma, priority fee/tip
 * e falhas aleatórias. Nada é enviado para a blockchain.
 */
export class PaperExecutor implements Executor {
  readonly mode = "paper" as const;

  constructor(
    private readonly cfg: Config,
    private readonly store: StateStore,
    private readonly oracle: PriceOracle,
    private readonly random: () => number = Math.random,
  ) {}

  /** Impacto aproximado numa pool x*y=k: tamanho / (liquidez/2). */
  private impactPct(usd: number, liquidityUsd?: number): number {
    if (!liquidityUsd || liquidityUsd <= 0) return 3;
    return Math.min(50, (usd / (liquidityUsd / 2)) * 100);
  }

  async buy(req: BuyRequest): Promise<BuyResult> {
    const p = this.cfg.paper;
    const price = req.token.priceUsd;
    if (!price) return { ok: false, error: "sem preço para simular" };
    if (this.random() < p.failureRate) return { ok: false, error: "falha simulada (paper)" };

    const fees = req.strategy.priorityFeeSol + req.strategy.tipFeeSol;
    const total = req.sizeSol + fees;
    if (this.store.state.paperBalanceSol < total) return { ok: false, error: "saldo paper insuficiente" };

    const sol = await this.oracle.solPriceUsd();
    const usdIn = req.sizeSol * sol * (1 - p.feePct / 100);
    const slip = this.impactPct(usdIn, req.token.liquidityUsd) + p.extraSlippagePct;
    if (slip > req.strategy.slippagePct) return { ok: false, error: `slippage simulado ${slip.toFixed(1)}% > limite` };
    const fillPrice = price * (1 + slip / 100);
    const tokens = usdIn / fillPrice;

    this.store.state.paperBalanceSol -= total;
    this.store.markDirty();
    return {
      ok: true,
      tokensRaw: toRaw(tokens, DEFAULT_DECIMALS),
      decimals: DEFAULT_DECIMALS,
      priceUsd: fillPrice,
      spentSol: total,
      orderId: `paper-${Date.now()}`,
    };
  }

  async sell(req: SellRequest): Promise<SellResult> {
    const p = this.cfg.paper;
    if (this.random() < p.failureRate) return { ok: false, error: "falha simulada (paper)" };
    const sol = await this.oracle.solPriceUsd();
    const tokens = fromRaw(req.amountRaw, req.position.tokenDecimals);
    const grossUsd = tokens * req.priceUsd;
    const slip = this.impactPct(grossUsd, req.liquidityUsd) + p.extraSlippagePct;
    const fillPrice = req.priceUsd * (1 - Math.min(slip, 95) / 100);
    const netUsd = tokens * fillPrice * (1 - p.feePct / 100);
    const fees = req.strategy.priorityFeeSol + req.strategy.tipFeeSol;
    const receivedSol = Math.max(0, netUsd / sol - fees);

    this.store.state.paperBalanceSol += receivedSol;
    this.store.markDirty();
    return { ok: true, soldRaw: req.amountRaw, receivedSol, priceUsd: fillPrice, orderId: `paper-${Date.now()}` };
  }

  async getSolBalance(): Promise<number> {
    return this.store.state.paperBalanceSol;
  }

  async getTokenBalanceRaw(): Promise<bigint | undefined> {
    return undefined;
  }
}
