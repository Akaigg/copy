import type { DipBuyConfig } from "../config/schema.js";
import type { TokenContext } from "../core/types.js";
import { ageSec, buySellRatio } from "../scanner/normalize.js";
import { lin, Rules, type Evaluation, type Strategy } from "./base.js";

/**
 * Compra no recuo: token hot que subiu forte na última hora, corrigiu nos últimos
 * 5 minutos e começa a repicar no último minuto (continuação de tendência).
 */
export class DipBuyStrategy implements Strategy {
  readonly id = "dipBuy" as const;
  readonly label = "Compra no recuo (pullback)";
  constructor(readonly cfg: DipBuyConfig) {}

  evaluate(ctx: TokenContext): Evaluation {
    const { snap: s, now } = ctx;
    const c = this.cfg;
    const r = new Rules();
    const ratio = buySellRatio(s);
    const age = ageSec(s, now);
    const volume = s.volumeByInterval?.["1h"] ?? s.volume1hUsd ?? s.volumeByInterval?.["5m"];

    r.min(s.priceChange1hPct, c.minPriceChange1hPct, "Δ1h%");
    r.range(s.priceChange5mPct, c.minPriceChange5mPct, c.maxPriceChange5mPct, "Δ5m%");
    r.min(s.priceChange1mPct, c.minPriceChange1mPct, "Δ1m%");
    r.min(s.liquidityUsd, c.minLiquidityUsd, "liquidez");
    r.min(volume, c.minVolumeUsd, "volume");
    r.min(ratio, c.minBuySellRatio, "compras/vendas");
    r.max(age === undefined ? undefined : age / 3600, c.maxAgeHours, "idade(h)");
    r.min(s.holderCount, c.minHolders, "holders");
    r.need(s.priceUsd !== undefined && s.priceUsd > 0, "preço ok", "sem preço");

    r.add(40, lin(s.priceChange1hPct, c.minPriceChange1hPct, c.minPriceChange1hPct * 3))
      .add(30, lin(ratio, c.minBuySellRatio, 2))
      .add(30, lin(s.liquidityUsd, c.minLiquidityUsd, c.minLiquidityUsd * 5));
    return r.result();
  }
}
