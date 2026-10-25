import type { GraduationConfig } from "../config/schema.js";
import type { TokenContext } from "../core/types.js";
import { ageSec, buySellRatio } from "../scanner/normalize.js";
import { lin, Rules, type Evaluation, type Strategy } from "./base.js";

/**
 * Pré-graduação: token quase completando a bonding curve (85%+). A migração para a DEX
 * costuma trazer um pico de volume/visibilidade; a ideia é entrar antes e sair no hype.
 */
export class GraduationStrategy implements Strategy {
  readonly id = "graduation" as const;
  readonly label = "Pré-graduação (bonding curve)";
  constructor(readonly cfg: GraduationConfig) {}

  evaluate(ctx: TokenContext): Evaluation {
    const { snap: s, now } = ctx;
    const c = this.cfg;
    const r = new Rules();
    const age = ageSec(s, now);
    const ratio = buySellRatio(s);

    r.need(s.sources.includes("trenches:near_completion") || s.stage === "near", "quase graduando", "não está perto da graduação");
    r.range(s.progress, c.minProgress, c.maxProgress, "progresso");
    r.min(s.holderCount, c.minHolders, "holders");
    r.min(s.volume1hUsd, c.minVolume1hUsd, "vol1h");
    r.min(ratio, c.minBuySellRatio, "compras/vendas");
    r.max(age === undefined ? undefined : age / 60, c.maxAgeMin, "idade(min)");
    r.min(s.smartDegenCount ?? 0, c.minSmartDegenCount, "smart");
    r.need(s.priceUsd !== undefined && s.priceUsd > 0, "preço ok", "sem preço");

    r.add(35, lin(s.progress, c.minProgress, c.maxProgress))
      .add(25, lin(ratio, 1, 2.5))
      .add(20, lin(s.volume1hUsd, c.minVolume1hUsd, c.minVolume1hUsd * 5))
      .add(20, lin(s.smartDegenCount, 0, 5));
    return r.result();
  }
}
