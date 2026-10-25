import type { BaseStrategyConfig } from "../config/schema.js";
import type { TokenSnapshot } from "../core/types.js";
import type { KlineReading } from "../filters/kline.js";

/**
 * Slippage dinâmico — fórmula publicada pela GMGN:
 *   2% + imposto + impacto × 1,5 + |Δ5m| × 0,5  (+3% se o token tem menos de 1h)
 * O resultado fica entre `minSlippagePct` e o teto `slippagePct` da estratégia.
 * Slippage fixo alto é dinheiro dado a bots de sandwich; fixo baixo faz a ordem falhar.
 */
export function dynamicSlippage(t: TokenSnapshot, sizeUsd: number, s: BaseStrategyConfig, now: number): number {
  if (!s.dynamicSlippage) return s.slippagePct;
  const impact = t.liquidityUsd && t.liquidityUsd > 0 ? (sizeUsd / (t.liquidityUsd / 2)) * 100 : 5;
  const tax = (t.buyTax ?? 0) * 100;
  const vol = Math.abs(t.priceChange5mPct ?? 0);
  const young = t.createdAt && now - t.createdAt < 3_600_000 ? 3 : 0;
  const raw = 2 + tax + impact * 1.5 + vol * 0.5 + young;
  return Math.round(Math.min(s.slippagePct, Math.max(s.minSlippagePct, raw)) * 10) / 10;
}

/** Confirmação pelo gráfico: devolve o motivo da recusa ou null. */
export function klineVeto(r: KlineReading | null, s: BaseStrategyConfig): string | null {
  if (s.klineMinScore <= 0) return null;
  if (!r) return null; // poucos candles (token muito novo): não veta
  if ((s.klineRejectPatterns as string[]).includes(r.pattern)) return `padrão gráfico ${r.pattern} (score ${r.score})`;
  if (r.score < s.klineMinScore) return `score gráfico ${r.score} < ${s.klineMinScore}`;
  return null;
}
