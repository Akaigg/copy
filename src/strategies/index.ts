import type { Config } from "../config/schema.js";
import type { Strategy } from "./base.js";
import { DipBuyStrategy } from "./dipBuy.js";
import { GraduationStrategy } from "./graduation.js";
import { MigrationStrategy } from "./migration.js";
import { MomentumStrategy } from "./momentum.js";
import { SmartMoneyStrategy } from "./smartMoney.js";
import { SmartSignalStrategy } from "./smartSignal.js";
import { SniperStrategy } from "./sniper.js";
import { SurvivorStrategy } from "./survivor.js";

export type { Evaluation, Strategy } from "./base.js";
export { toSignal } from "./base.js";

/** Cria todas as estratégias (habilitadas ou não). */
export function createStrategies(cfg: Config): Strategy[] {
  const s = cfg.strategies;
  return [
    new SniperStrategy(s.sniper),
    new GraduationStrategy(s.graduation),
    new MigrationStrategy(s.migration),
    new MomentumStrategy(s.momentum),
    new SmartMoneyStrategy(s.smartMoney),
    new DipBuyStrategy(s.dipBuy),
    new SmartSignalStrategy(s.smartSignal),
    new SurvivorStrategy(s.survivor),
  ];
}
