import type { SniperConfig } from "../config/schema.js";
import type { TokenContext } from "../core/types.js";
import { ageSec, buySellRatio } from "../scanner/normalize.js";
import { valueAgo } from "../scanner/tokenStore.js";
import { lin, Rules, type Evaluation, type Strategy } from "./base.js";

/**
 * Sniper de lançamento: tokens recém-criados na bonding curve (Pump.fun, letsbonk...)
 * que já mostram tração real nos primeiros minutos — muitos swaps, mais compras que
 * vendas, holders crescendo — mas ainda com market cap baixo.
 */
export class SniperStrategy implements Strategy {
  readonly id = "sniper" as const;
  readonly label = "Sniper de lançamento";
  constructor(readonly cfg: SniperConfig) {}

  evaluate(ctx: TokenContext): Evaluation {
    const { snap: s, history, now } = ctx;
    const c = this.cfg;
    const r = new Rules();
    const age = ageSec(s, now);
    const ratio = buySellRatio(s);

    r.need(s.sources.includes("trenches:new_creation") || s.stage === "curve", "na bonding curve", "não é lançamento novo");
    r.range(age, c.minAgeSec, c.maxAgeSec, "idade(s)");
    r.min(s.holderCount, c.minHolders, "holders");
    r.min(s.swaps1m, c.minSwaps1m, "swaps1m");
    r.min(ratio, c.minBuySellRatio, "compras/vendas");
    r.range(s.marketCapUsd, c.minMarketCapUsd, c.maxMarketCapUsd, "mcap");
    r.min(s.volume1hUsd, c.minVolume1hUsd, "vol1h");
    r.min(s.smartDegenCount ?? 0, c.minSmartDegenCount, "smart");
    r.need(s.priceUsd !== undefined && s.priceUsd > 0, "preço ok", "sem preço");

    let growth: number | undefined;
    const past = valueAgo(history, "holderCount", now, 120_000);
    if (past && s.holderCount !== undefined && now - past.at >= 15_000) {
      growth = ((s.holderCount - (past.value as number)) / (now - past.at)) * 60_000;
    }
    if (c.minHolderGrowthPerMin > 0) r.min(growth, c.minHolderGrowthPerMin, "holders/min");

    // Já está despejando? Market cap caiu >25% do pico recente => não entra.
    const peak = Math.max(0, ...history.filter((h) => now - h.observedAt < 180_000).map((h) => h.marketCapUsd ?? 0));
    if (peak > 0 && s.marketCapUsd !== undefined) {
      r.need(s.marketCapUsd >= peak * 0.75, "sem dump recente", `mcap caiu ${(100 - (s.marketCapUsd / peak) * 100).toFixed(0)}% do pico`);
    }

    r.add(30, lin(ratio, 1, 3))
      .add(25, lin(s.swaps1m, c.minSwaps1m, c.minSwaps1m * 4))
      .add(20, lin(s.holderCount, c.minHolders, c.minHolders * 4))
      .add(15, lin(s.smartDegenCount, 0, 3))
      .add(10, s.hasSocial ? 1 : 0);
    return r.result();
  }
}
