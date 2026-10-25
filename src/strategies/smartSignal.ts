import type { SmartSignalConfig } from "../config/schema.js";
import type { TokenContext } from "../core/types.js";
import { buySellRatio, signalCount } from "../scanner/normalize.js";
import { lin, Rules, type Evaluation, type Strategy } from "./base.js";

/**
 * Sinal smart money / KOL (feed oficial de sinais da GMGN).
 *
 * Base na pesquisa: copiar carteiras lucrativas só funciona se a entrada não ficar muito pior
 * que a do líder ("penalidade de imitação": 11–24% de preço pior com ~5s de atraso numa
 * bonding curve). Por isso exige VÁRIOS disparos independentes (confluência) e recusa entrar
 * se o market cap já andou demais desde o primeiro sinal.
 */
export class SmartSignalStrategy implements Strategy {
  readonly id = "smartSignal" as const;
  readonly label = "Confluência de smart money/KOL (sinais GMGN)";
  constructor(readonly cfg: SmartSignalConfig) {}

  evaluate(ctx: TokenContext): Evaluation {
    const { snap: s, now } = ctx;
    const c = this.cfg;
    const r = new Rules();
    const count = signalCount(s, c.signalTypes);
    const chase = s.firstSignalMcUsd && s.marketCapUsd ? s.marketCapUsd / s.firstSignalMcUsd : undefined;
    const ageSec = s.lastSignalAt ? (now - s.lastSignalAt) / 1000 : undefined;
    const ratio = buySellRatio(s);

    r.min(count, c.minSignalCount, "sinais");
    r.max(ageSec, c.maxSignalAgeSec, "idade do sinal(s)");
    r.max(chase, c.maxChaseMultiple, "mcap/1º sinal");
    r.range(s.marketCapUsd, c.minMarketCapUsd, c.maxMarketCapUsd, "mcap");
    r.min(s.liquidityUsd, c.minLiquidityUsd, "liquidez");
    r.min(s.holderCount, c.minHolders, "holders");
    if (ratio !== undefined) r.min(ratio, c.minBuySellRatio, "compras/vendas");
    r.need(s.priceUsd !== undefined && s.priceUsd > 0, "preço ok", "sem preço");

    const kol = s.signalCounts?.["20"] ?? 0;
    const smart = s.signalCounts?.["12"] ?? 0;
    r.add(35, lin(count, c.minSignalCount, c.minSignalCount * 3))
      // Entrar perto do preço do líder vale mais que qualquer outra coisa.
      .add(30, chase === undefined ? 0.3 : lin(c.maxChaseMultiple - chase, 0, c.maxChaseMultiple - 1))
      .add(15, kol > 0 && smart > 0 ? 1 : 0.4)
      .add(10, lin(s.smartDegenCount, 0, 6))
      .add(10, s.hasSocial ? 1 : 0);
    return r.result();
  }
}
