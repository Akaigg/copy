import type { MigrationConfig } from "../config/schema.js";
import type { TokenContext } from "../core/types.js";
import { buySellRatio } from "../scanner/normalize.js";
import { lin, Rules, type Evaluation, type Strategy } from "./base.js";

/**
 * Recém-graduado: token que acabou de migrar para a DEX (PumpSwap/Raydium/Meteora)
 * com liquidez, holders e volume saudáveis — segunda perna de alta pós-migração.
 */
export class MigrationStrategy implements Strategy {
  readonly id = "migration" as const;
  readonly label = "Recém-graduado (pós-migração)";
  constructor(readonly cfg: MigrationConfig) {}

  evaluate(ctx: TokenContext): Evaluation {
    const { snap: s, now } = ctx;
    const c = this.cfg;
    const r = new Rules();
    const ratio = buySellRatio(s);
    const sinceOpenMin = s.openAt ? (now - s.openAt) / 60_000 : undefined;

    r.need(s.sources.includes("trenches:completed") || s.stage === "migrated", "migrado", "não migrou");
    r.max(sinceOpenMin, c.maxMinutesSinceOpen, "min desde migração");
    r.min(s.liquidityUsd, c.minLiquidityUsd, "liquidez");
    r.min(s.holderCount, c.minHolders, "holders");
    r.min(s.volume1hUsd, c.minVolume1hUsd, "vol1h");
    r.range(s.marketCapUsd, c.minMarketCapUsd, c.maxMarketCapUsd, "mcap");
    r.min(ratio, c.minBuySellRatio, "compras/vendas");
    r.need(s.priceUsd !== undefined && s.priceUsd > 0, "preço ok", "sem preço");

    r.add(30, lin(ratio, 1, 2.5))
      .add(25, lin(s.liquidityUsd, c.minLiquidityUsd, c.minLiquidityUsd * 5))
      .add(25, lin(s.holderCount, c.minHolders, c.minHolders * 4))
      .add(20, lin(s.smartDegenCount, 0, 5));
    return r.result();
  }
}
