import { existsSync } from "node:fs";
import type { Config } from "../config/schema.js";
import type { Logger } from "../core/logger.js";
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
    if (st.daily.realizedPnlSol <= -r.dailyLossLimitSol) return `limite de perda diária atingido (${st.daily.realizedPnlSol.toFixed(4)} SOL)`;
    if (r.dailyProfitTargetSol > 0 && st.daily.realizedPnlSol >= r.dailyProfitTargetSol) return "meta de lucro diária atingida";
    return null;
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

    let size = scfg.buySol;
    const exposure = open.reduce((acc, p) => acc + p.entrySol, 0);
    const room = r.maxTotalExposureSol - exposure;
    if (room <= 0) return no(`exposição máxima ${r.maxTotalExposureSol} SOL atingida`);
    size = Math.min(size, room);

    if (balanceSol !== undefined) {
      const fees = scfg.priorityFeeSol + scfg.tipFeeSol;
      const usable = balanceSol - r.minSolReserve - fees;
      size = Math.min(size, (balanceSol * r.maxPositionPctOfBalance) / 100, usable);
    }
    // Abaixo de 20% do tamanho configurado não vale a pena (taxas comem o resultado).
    if (size < scfg.buySol * 0.2 || size <= 0) return no(`saldo/espaço insuficiente (${size.toFixed(4)} SOL)`);

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
