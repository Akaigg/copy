import type { MomentumConfig } from "../config/schema.js";
import type { Source, TokenContext } from "../core/types.js";
import { ageSec, buySellRatio } from "../scanner/normalize.js";
import { lin, Rules, type Evaluation, type Strategy } from "./base.js";

/**
 * Momentum "hot": tokens jovens no ranking de 1m/5m da GMGN com alta forte e
 * pressão compradora — mas sem perseguir velas já esticadas demais.
 */
export class MomentumStrategy implements Strategy {
  readonly id = "momentum" as const;
  readonly label = "Momentum hot (ranking)";
  constructor(readonly cfg: MomentumConfig) {}

  evaluate(ctx: TokenContext): Evaluation {
    const { snap: s, now } = ctx;
    const c = this.cfg;
    const r = new Rules();
    const ratio = buySellRatio(s);
    const age = ageSec(s, now);
    const volume = s.volumeByInterval?.[c.interval];

    r.need(s.sources.includes(`rank:${c.interval}` as Source), `no ranking ${c.interval}`, `fora do ranking ${c.interval}`);
    r.range(s.priceChange1mPct, c.minPriceChange1mPct, c.maxPriceChange1mPct, "Δ1m%");
    r.min(s.priceChange5mPct, c.minPriceChange5mPct, "Δ5m%");
    if (s.priceChange1hPct !== undefined) r.max(s.priceChange1hPct, c.maxPriceChange1hPct, "Δ1h%");
    r.min(volume, c.minVolumeUsd, `vol${c.interval}`);
    r.min(ratio, c.minBuySellRatio, "compras/vendas");
    r.min(s.liquidityUsd, c.minLiquidityUsd, "liquidez");
    r.max(age === undefined ? undefined : age / 3600, c.maxAgeHours, "idade(h)");
    r.min(s.holderCount, c.minHolders, "holders");
    r.need(s.priceUsd !== undefined && s.priceUsd > 0, "preço ok", "sem preço");

    r.add(30, lin(s.priceChange1mPct, c.minPriceChange1mPct, c.maxPriceChange1mPct * 0.6))
      .add(25, lin(ratio, c.minBuySellRatio, 3))
      .add(25, lin(volume, c.minVolumeUsd, c.minVolumeUsd * 5))
      .add(20, lin(s.smartDegenCount, 0, 4));
    return r.result();
  }
}
