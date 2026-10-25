import type { SmartMoneyConfig } from "../config/schema.js";
import type { TokenContext } from "../core/types.js";
import { ageSec } from "../scanner/normalize.js";
import { valueAgo } from "../scanner/tokenStore.js";
import { lin, Rules, type Evaluation, type Strategy } from "./base.js";

/**
 * Segue o smart money: entra quando o número de carteiras "smart degen"/KOL
 * segurando o token AUMENTA dentro da janela (não apenas quando já é alto).
 */
export class SmartMoneyStrategy implements Strategy {
  readonly id = "smartMoney" as const;
  readonly label = "Seguir smart money";
  constructor(readonly cfg: SmartMoneyConfig) {}

  evaluate(ctx: TokenContext): Evaluation {
    const { snap: s, history, now } = ctx;
    const c = this.cfg;
    const r = new Rules();
    const age = ageSec(s, now);
    const smart = s.smartDegenCount;

    r.min(smart, c.minSmartDegenCount, "smart");
    r.min(s.renownedCount ?? 0, c.minRenownedCount, "KOLs");
    r.min(s.liquidityUsd, c.minLiquidityUsd, "liquidez");
    r.max(s.marketCapUsd, c.maxMarketCapUsd, "mcap");
    r.max(age === undefined ? undefined : age / 3600, c.maxAgeHours, "idade(h)");
    r.need(s.priceUsd !== undefined && s.priceUsd > 0, "preço ok", "sem preço");

    const past = valueAgo(history, "smartDegenCount", now, c.lookbackSec * 1000);
    let delta: number | undefined;
    if (past && smart !== undefined) {
      delta = smart - (past.value as number);
      r.min(delta, c.minSmartIncrease, "Δsmart");
    } else {
      r.min(smart, c.minSmartOnFirstSeen, "smart(1ª vez)");
    }

    r.add(50, lin(smart, c.minSmartDegenCount, c.minSmartDegenCount * 3))
      .add(30, delta === undefined ? 0.5 : lin(delta, c.minSmartIncrease, Math.max(c.minSmartIncrease, 1) * 4))
      .add(20, lin(s.renownedCount, 0, 3));
    return r.result();
  }
}
