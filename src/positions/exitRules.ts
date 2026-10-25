import type { ExitConfig } from "../config/schema.js";
import type { Position } from "../core/types.js";

export interface ExitDecision {
  /** Quantidade (raw) a vender. */
  sellRaw: bigint;
  /** true = encerra a posição inteira. */
  full: boolean;
  reason: string;
  /** Índices de take profit atendidos por esta venda. */
  tpIndexes: number[];
}

/**
 * Regras de saída (função pura, testável). Ordem de prioridade:
 *  1. stop loss (ou stop de break-even, se armado)
 *  2. trailing stop
 *  3. escada de take profit (parciais)
 *  4. tempo máximo / posição parada
 */
export function decideExit(p: Position, price: number, now: number, cfg: ExitConfig): ExitDecision | null {
  const remaining = BigInt(p.tokensRemainingRaw);
  if (remaining <= 0n || price <= 0) return null;
  const initial = BigInt(p.tokensInitialRaw);
  const gainPct = ((price - p.entryPriceUsd) / p.entryPriceUsd) * 100;
  const peak = Math.max(p.highestPriceUsd, price);
  const peakGainPct = ((peak - p.entryPriceUsd) / p.entryPriceUsd) * 100;
  const all = (reason: string): ExitDecision => ({ sellRaw: remaining, full: true, reason, tpIndexes: [] });

  // 1. Stop loss / break-even
  const breakEven = p.breakEvenArmed || (cfg.breakEvenAtPct !== null && peakGainPct >= cfg.breakEvenAtPct);
  const stopPrice = breakEven
    ? p.entryPriceUsd * (1 + cfg.breakEvenBufferPct / 100)
    : p.entryPriceUsd * (1 - cfg.stopLossPct / 100);
  if (price <= stopPrice) {
    return all(breakEven ? `break-even stop (${gainPct.toFixed(1)}%)` : `stop loss (${gainPct.toFixed(1)}%)`);
  }

  // 2. Trailing stop (com folga crescente conforme o lucro)
  if (cfg.trailing.enabled && peakGainPct >= cfg.trailing.activateAtPct) {
    const drawdown = trailingDrawdown(cfg, peakGainPct);
    const trailPrice = peak * (1 - drawdown / 100);
    if (price <= trailPrice) {
      return all(`trailing stop ${drawdown}% (pico +${peakGainPct.toFixed(0)}%, agora ${gainPct.toFixed(1)}%)`);
    }
  }

  // 3. Take profits (pode atender vários níveis num salto)
  const hits: number[] = [];
  let pctToSell = 0;
  cfg.takeProfits.forEach((tp, i) => {
    if (!p.tpHits.includes(i) && gainPct >= tp.atPct) {
      hits.push(i);
      pctToSell += tp.sellPct;
    }
  });
  if (hits.length) {
    let sell = (initial * BigInt(Math.round(pctToSell * 100))) / 10000n;
    if (sell > remaining) sell = remaining;
    const left = remaining - sell;
    const dust = (initial * BigInt(Math.round(cfg.dustPct * 100))) / 10000n;
    const full = left <= dust;
    if (full) sell = remaining;
    if (sell > 0n) {
      const levels = hits.map((i) => `+${cfg.takeProfits[i]!.atPct}%`).join(", ");
      return { sellRaw: sell, full, reason: `take profit ${levels} (${gainPct.toFixed(1)}%)`, tpIndexes: hits };
    }
  }

  // 4. Tempo (o moonbag, depois de um take profit, pode ter um prazo maior)
  const heldMin = (now - p.openedAt) / 60_000;
  const maxHold = p.tpHits.length && cfg.maxHoldAfterTpMin > 0 ? cfg.maxHoldAfterTpMin : cfg.maxHoldMin;
  if (maxHold > 0 && heldMin >= maxHold) return all(`tempo máximo ${maxHold}min (${gainPct.toFixed(1)}%)`);
  if (cfg.staleAfterMin > 0 && heldMin >= cfg.staleAfterMin && peakGainPct < cfg.staleMinGainPct) {
    return all(`posição parada ${cfg.staleAfterMin}min (${gainPct.toFixed(1)}%)`);
  }
  return null;
}

/** Atualiza máximas/mínimas e arma o break-even. Chamar a cada novo preço. */
export function trackPrice(p: Position, price: number, now: number, cfg: ExitConfig) {
  p.lastPriceUsd = price;
  p.lastPriceAt = now;
  if (price > p.highestPriceUsd) p.highestPriceUsd = price;
  if (price < p.lowestPriceUsd) p.lowestPriceUsd = price;
  if (!p.breakEvenArmed && cfg.breakEvenAtPct !== null) {
    const peakGain = ((p.highestPriceUsd - p.entryPriceUsd) / p.entryPriceUsd) * 100;
    if (peakGain >= cfg.breakEvenAtPct) p.breakEvenArmed = true;
  }
}

/** Drawdown do trailing para o lucro de pico atual (usa o maior degrau atingido). */
export function trailingDrawdown(cfg: ExitConfig, peakGainPct: number): number {
  let dd = cfg.trailing.drawdownPct;
  let best = -Infinity;
  for (const t of cfg.trailing.tiers) {
    if (peakGainPct >= t.atPct && t.atPct > best) {
      best = t.atPct;
      dd = t.drawdownPct;
    }
  }
  return dd;
}
