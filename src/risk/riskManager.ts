import { existsSync } from "node:fs";
import type { Config } from "../config/schema.js";
import type { Logger } from "../core/logger.js";
import { localDate } from "../core/logger.js";
import type { StateStore } from "../core/store.js";
import type { Position, Signal } from "../core/types.js";

export interface RiskDecision {
  ok: boolean;
  reason?: string;
  sizeSol: number;
}

/** Arquivo de "kill switch": se existir no diretório atual, o robô para de comprar. */
export const STOP_FILE = "STOP";

/**
 * Gestão de risco: decide SE e QUANTO comprar, e reage a resultados
 * (limite de perda diária, sequência de perdas, cooldown, blacklist de devs).
 */
export class RiskManager {
  constructor(
    private readonly cfg: Config,
    private readonly store: StateStore,
    private readonly log: Logger,
  ) {}

  /** Motivo pelo qual novas compras estão bloqueadas (ou null). */
  blockReason(now: number): string | null {
    const st = this.store.state;
    const r = this.cfg.risk;
    if (existsSync(STOP_FILE)) return `arquivo ${STOP_FILE} presente (kill switch)`;
    if (st.manualPause) return "pausado manualmente";
    if (st.pausedUntil > now) return `pausa por perdas até ${new Date(st.pausedUntil).toLocaleTimeString()}`;
    const limit = this.dailyLossLimitSol();
    if (st.daily.realizedPnlSol <= -limit) return `limite de perda diária atingido (${st.daily.realizedPnlSol.toFixed(4)} / -${limit.toFixed(4)} SOL)`;
    if (r.dailyProfitTargetSol > 0 && st.daily.realizedPnlSol >= r.dailyProfitTargetSol) return "meta de lucro diária atingida";
    if (st.equity.goalReachedAt !== undefined) return `META ATINGIDA ($${st.equity.lastUsd.toFixed(0)}) — compras encerradas; ajuste goal.targetUsd para continuar`;
    if (st.equity.floorHitAt !== undefined) return `patrimônio abaixo do piso ($${st.equity.lastUsd.toFixed(0)} < $${r.goal.floorUsd}) — compras encerradas`;
    return null;
  }

  /** Limite de perda diária efetivo (o menor entre o fixo e o % do patrimônio do início do dia). */
  dailyLossLimitSol(): number {
    const r = this.cfg.risk;
    const eq = this.store.state.equity;
    if (r.dailyLossLimitPctOfEquity > 0 && eq.dayStartSol > 0) {
      return Math.min(r.dailyLossLimitSol, (eq.dayStartSol * r.dailyLossLimitPctOfEquity) / 100);
    }
    return r.dailyLossLimitSol;
  }

  /**
   * Atualiza o patrimônio (saldo + posições a preço de mercado) e verifica meta e piso.
   * Retorna o evento ocorrido, se houver, para o motor notificar.
   */
  updateEquity(equitySol: number, solUsd: number, now: number): "goal" | "floor" | null {
    const eq = this.store.state.equity;
    const g = this.cfg.risk.goal;
    const today = localDate(new Date(now));
    eq.lastSol = equitySol;
    eq.lastUsd = equitySol * solUsd;
    eq.updatedAt = now;
    eq.peakSol = Math.max(eq.peakSol, equitySol);
    if (eq.dayDate !== today) {
      eq.dayDate = today;
      eq.dayStartSol = equitySol;
    }
    this.store.markDirty();
    // Meta ou piso alterados no config depois de atingidos: libera de novo.
    if (eq.goalReachedAt !== undefined && eq.goalTargetUsd !== g.targetUsd) eq.goalReachedAt = undefined;
    if (eq.floorHitAt !== undefined && eq.floorUsd !== g.floorUsd) eq.floorHitAt = undefined;
    if (g.targetUsd > 0 && eq.goalReachedAt === undefined && eq.lastUsd >= g.targetUsd) {
      eq.goalReachedAt = now;
      eq.goalTargetUsd = g.targetUsd;
      return "goal";
    }
    if (g.floorUsd > 0 && eq.floorHitAt === undefined && eq.lastUsd > 0 && eq.lastUsd < g.floorUsd) {
      eq.floorHitAt = now;
      eq.floorUsd = g.floorUsd;
      return "floor";
    }
    return null;
  }

  /** Capital ainda em risco numa posição: o que entrou menos o que já voltou. */
  static atRisk(p: Position): number {
    return Math.max(0, p.entrySol - p.realizedSol);
  }

  canOpen(sig: Signal, now: number, balanceSol: number | undefined): RiskDecision {
    const st = this.store.state;
    const r = this.cfg.risk;
    const scfg = this.cfg.strategies[sig.strategyId];
    const no = (reason: string): RiskDecision => ({ ok: false, reason, sizeSol: 0 });

    const block = this.blockReason(now);
    if (block) return no(block);

    const open = this.store.openPositions;
    if (open.some((p) => p.tokenAddress === sig.token.address)) return no("já possui posição neste token");
    if (st.pendingBuys.some((p) => p.token === sig.token.address)) return no("compra em andamento");
    const cd = st.tokenCooldowns[sig.token.address];
    if (cd && cd > now) return no(`token em cooldown até ${new Date(cd).toLocaleTimeString()}`);
    if (st.blacklistTokens.includes(sig.token.address)) return no("token na blacklist");
    if (sig.token.creator && st.blacklistCreators.includes(sig.token.creator)) return no("dev na blacklist");

    if (open.length + st.pendingBuys.length >= r.maxOpenPositions) return no(`máximo de ${r.maxOpenPositions} posições`);
    const sameStrat = open.filter((p) => p.strategyId === sig.strategyId).length;
    if (sameStrat >= scfg.maxOpenPositions) return no(`máximo de ${scfg.maxOpenPositions} posições em ${sig.strategyId}`);

    const recent = st.recentBuys.filter((t) => now - t < 3_600_000).length;
    if (recent >= r.maxBuysPerHour) return no(`máximo de ${r.maxBuysPerHour} compras/hora`);

    // ---- tamanho
    const equity = st.equity.lastSol > 0 ? st.equity.lastSol : balanceSol;
    let size: number;
    let base: number;
    if (r.sizing.mode === "equityPct" && equity) {
      base = ((equity * r.sizing.equityPct) / 100) * scfg.sizeMultiplier;
      // Freio de drawdown: longe do pico, aposta menor (preserva a banca para a recuperação).
      const peak = st.equity.peakSol;
      if (r.sizing.throttleDrawdownPct > 0 && peak > 0 && equity < peak * (1 - r.sizing.throttleDrawdownPct / 100)) {
        base *= r.sizing.throttleFactor;
      }
      base = Math.min(r.sizing.maxSol, base);
      size = base;
    } else {
      base = scfg.buySol;
      size = base;
    }

    // ---- exposição
    const exposure = open.reduce((acc, p) => acc + RiskManager.atRisk(p), 0);
    let maxExposure = r.maxTotalExposureSol;
    if (r.maxTotalExposurePctOfEquity > 0 && equity) maxExposure = Math.min(maxExposure, (equity * r.maxTotalExposurePctOfEquity) / 100);
    const room = maxExposure - exposure;
    if (room <= 0) return no(`exposição máxima ${maxExposure.toFixed(4)} SOL atingida`);
    size = Math.min(size, room);

    const fees = scfg.priorityFeeSol + scfg.tipFeeSol;
    if (balanceSol !== undefined) {
      const usable = balanceSol - r.minSolReserve - fees;
      size = Math.min(size, (balanceSol * r.maxPositionPctOfBalance) / 100, usable);
    }

    const minSize = r.sizing.mode === "equityPct" ? r.sizing.minSol : base * 0.2;
    if (size <= 0 || size < minSize) return no(`saldo/espaço insuficiente (${Math.max(0, size).toFixed(4)} SOL)`);

    // ---- taxas: ida + volta não podem comer o trade
    if (r.maxFeePctOfTrade > 0) {
      const feePct = ((2 * fees) / size) * 100;
      if (feePct > r.maxFeePctOfTrade) {
        return no(`taxas fixas ${feePct.toFixed(1)}% do trade > ${r.maxFeePctOfTrade}% (reduza priority/tip ou aumente o tamanho)`);
      }
    }
    return { ok: true, sizeSol: Number(size.toFixed(6)) };
  }

  onBuy(now: number) {
    this.store.state.recentBuys.push(now);
    this.store.state.daily.buys++;
    this.store.markDirty();
  }

  onClose(p: Position, now: number) {
    const st = this.store.state;
    const r = this.cfg.risk;
    const pnl = p.realizedSol - p.entrySol;
    const pnlPct = p.entrySol > 0 ? (pnl / p.entrySol) * 100 : 0;

    st.daily.realizedPnlSol += pnl;
    st.daily.trades++;
    st.totals.realizedPnlSol += pnl;
    st.totals.trades++;
    if (pnl >= 0) {
      st.daily.wins++;
      st.totals.wins++;
      st.consecutiveLosses = 0;
    } else {
      st.daily.losses++;
      st.totals.losses++;
      st.consecutiveLosses++;
      if (st.consecutiveLosses >= r.maxConsecutiveLosses && r.pauseAfterLossesMin > 0) {
        st.pausedUntil = now + r.pauseAfterLossesMin * 60_000;
        st.consecutiveLosses = 0;
        this.log.warn(`${r.maxConsecutiveLosses} perdas seguidas — pausando compras por ${r.pauseAfterLossesMin} min`);
      }
    }
    if (r.tokenCooldownMin > 0) st.tokenCooldowns[p.tokenAddress] = now + r.tokenCooldownMin * 60_000;
    if (r.blacklistCreatorOnLossPct > 0 && pnlPct <= -r.blacklistCreatorOnLossPct && p.creator) {
      if (!st.blacklistCreators.includes(p.creator)) {
        st.blacklistCreators.push(p.creator);
        this.log.warn(`Dev ${p.creator} adicionado à blacklist (perda de ${pnlPct.toFixed(0)}% em ${p.symbol})`);
      }
    }
    this.store.markDirty();
    return { pnl, pnlPct };
  }
}
