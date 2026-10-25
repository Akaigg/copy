import type { SurvivorConfig } from "../config/schema.js";
import type { TokenContext } from "../core/types.js";
import { buySellRatio } from "../scanner/normalize.js";
import { valueAgo } from "../scanner/tokenStore.js";
import { lin, Rules, type Evaluation, type Strategy } from "./base.js";

/**
 * Sobrevivente pós-migração ("segunda perna").
 *
 * Base na pesquisa: só ~1% dos tokens gradua, ~79% morrem no 1º dia e a maioria dos que
 * graduam despenca logo após migrar. Em vez de comprar NA migração, esta estratégia espera
 * 30+ min e só entra em quem sobreviveu: holders altos e crescendo, liquidez real, smart
 * money presente, recuo saudável do topo (nem no pico, nem morto) e repique começando.
 */
export class SurvivorStrategy implements Strategy {
  readonly id = "survivor" as const;
  readonly label = "Sobrevivente pós-migração (2ª perna)";
  constructor(readonly cfg: SurvivorConfig) {}

  evaluate(ctx: TokenContext): Evaluation {
    const { snap: s, history, now } = ctx;
    const c = this.cfg;
    const r = new Rules();
    const ratio = buySellRatio(s);
    const sinceOpenMin = s.openAt ? (now - s.openAt) / 60_000 : undefined;
    const retrace =
      s.athMarketCapUsd && s.marketCapUsd && s.athMarketCapUsd > 0
        ? Math.max(0, (1 - s.marketCapUsd / s.athMarketCapUsd) * 100)
        : undefined;

    r.need(s.stage === "migrated" || !!s.openAt, "migrado", "não migrou");
    r.range(sinceOpenMin, c.minMinutesSinceOpen, c.maxMinutesSinceOpen, "min desde migração");
    r.range(retrace, c.minAthRetracePct, c.maxAthRetracePct, "recuo do topo%");
    r.min(s.holderCount, c.minHolders, "holders");
    r.min(s.liquidityUsd, c.minLiquidityUsd, "liquidez");
    r.min(s.volume1hUsd ?? s.volumeByInterval?.["1h"], c.minVolume1hUsd, "vol1h");
    r.range(s.marketCapUsd, c.minMarketCapUsd, c.maxMarketCapUsd, "mcap");
    r.min(ratio, c.minBuySellRatio, "compras/vendas");
    r.min(s.priceChange1mPct, c.minPriceChange1mPct, "Δ1m%");
    r.min(s.smartDegenCount ?? 0, c.minSmartDegenCount, "smart");
    r.need(s.priceUsd !== undefined && s.priceUsd > 0, "preço ok", "sem preço");

    let growthPct: number | undefined;
    const past = valueAgo(history, "holderCount", now, 600_000);
    if (past && s.holderCount && (past.value as number) > 0 && now - past.at >= 60_000) {
      growthPct = ((s.holderCount - (past.value as number)) / (past.value as number)) * 100;
    }
    if (c.minHolderGrowthPct > 0) r.min(growthPct, c.minHolderGrowthPct, "Δholders%");

    // Liquidez/market cap saudável: pools muito rasas para o mcap são frágeis.
    const liqRatio = s.liquidityUsd && s.marketCapUsd ? s.liquidityUsd / s.marketCapUsd : undefined;
    r.add(25, lin(s.holderCount, c.minHolders, c.minHolders * 5))
      .add(20, lin(s.smartDegenCount, c.minSmartDegenCount, c.minSmartDegenCount + 8))
      .add(20, lin(ratio, 1, 2))
      .add(15, lin(liqRatio, 0.05, 0.2))
      .add(10, lin(growthPct, 0, 10))
      .add(10, s.hasSocial ? 1 : 0);
    return r.result();
  }
}
