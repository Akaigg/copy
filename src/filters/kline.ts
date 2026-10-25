import { num } from "../core/utils.js";

/**
 * Leitura de padrão gráfico — implementação do método publicado pela GMGN
 * (skill gmgn-kline-pattern): seis medidas, classificação em padrões e score 0–100.
 * Um padrão descreve o que já aconteceu; aqui ele serve só como filtro de confirmação.
 */
export type KlinePattern =
  | "verticalRunUp"
  | "uptrendChannel"
  | "breakdown"
  | "bounceOffLows"
  | "distribution"
  | "slowBleed"
  | "basing"
  | "wideChop"
  | "bullishConsolidation"
  | "bearishConsolidation"
  | "sidewaysConsolidation";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface KlineReading {
  pattern: KlinePattern;
  score: number;
  slope: number;
  volatility: number;
  drawdown: number;
  volRatio?: number;
  upFromLow?: number;
  trend: "up" | "down" | "flat";
  evidence: string[];
}

export function parseCandles(data: unknown): Candle[] {
  const list = Array.isArray(data) ? data : ((data as { list?: unknown[] } | null)?.list ?? []);
  const out: Candle[] = [];
  for (const c of list as Record<string, unknown>[]) {
    const close = num(c["close"]);
    const high = num(c["high"]);
    const low = num(c["low"]);
    const time = num(c["time"]);
    if (!close || !high || !low || close <= 0 || high <= 0 || low <= 0 || time === undefined) continue;
    // `amount` é volume em USD; `volume` é quantidade de tokens. O método usa USD.
    out.push({ time, open: num(c["open"]) ?? close, high, low, close, volume: num(c["amount"]) ?? num(c["volume"]) ?? 0 });
  }
  return out.sort((a, b) => a.time - b.time);
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

/** Retorna null com menos de 8 candles (não há padrão a ler). */
export function readPattern(candles: Candle[]): KlineReading | null {
  const N = candles.length;
  if (N < 8) return null;
  const C = candles.map((c) => c.close);
  const V = candles.map((c) => c.volume);
  const ev: string[] = [];

  const m9 = mean(C.slice(-9));
  const m21 = mean(C.slice(-21));
  const trend = m9 > m21 ? "up" : m9 < m21 ? "down" : "flat";
  let slope: number;
  if (N >= 24) {
    const base = mean(C.slice(-24, -19));
    slope = base ? (mean(C.slice(-5)) - base) / base : 0;
  } else slope = (C[N - 1]! - C[0]!) / C[0]!;
  const volatility = mean(candles.slice(-14).map((c) => (c.high - c.low) / c.close));
  const maxHigh = Math.max(...candles.map((c) => c.high));
  const minLow = Math.min(...candles.map((c) => c.low));
  const last = C[N - 1]!;
  const drawdown = (maxHigh - last) / maxHigh;
  const avgV = mean(V.slice(-21, -1));
  const volRatio = avgV > 0 ? V[N - 1]! / avgV : undefined;
  const upFromLow = minLow > 0 ? (last - minLow) / minLow : undefined;

  let pattern: KlinePattern;
  if (slope > 0.25 && drawdown < 0.12) pattern = "verticalRunUp";
  else if (slope > 0.08 && drawdown < 0.25) pattern = "uptrendChannel";
  else if (drawdown > 0.55 && slope < -0.1) pattern = "breakdown";
  else if (drawdown > 0.55 && slope > 0.02) pattern = "bounceOffLows";
  else if (drawdown > 0.35 && Math.abs(slope) < 0.08) pattern = "distribution";
  else if (slope < -0.2) pattern = "slowBleed";
  else if (Math.abs(slope) < 0.05 && volatility < 0.05 && upFromLow !== undefined && upFromLow < 0.2) pattern = "basing";
  else if (Math.abs(slope) < 0.08 && volatility > 0.08) pattern = "wideChop";
  else pattern = trend === "up" ? "bullishConsolidation" : trend === "down" ? "bearishConsolidation" : "sidewaysConsolidation";

  let score = 50;
  const add = (d: number, why: string) => {
    score += d;
    ev.push(`${d > 0 ? "+" : ""}${d} ${why}`);
  };
  if (trend === "up") add(12, "média 9 > média 21");
  if (trend === "down") add(-12, "média 9 < média 21");
  if (slope > 0.15) add(15, `tendência +${(slope * 100).toFixed(0)}%`);
  else if (slope > 0.02) add(6, "alta suave");
  else if (slope < -0.15) add(-15, `tendência ${(slope * 100).toFixed(0)}%`);
  else if (slope < -0.02) add(-6, "sangria lenta");
  const lastC = candles[N - 1]!;
  if (volRatio !== undefined) {
    if (volRatio > 3 && lastC.close >= lastC.open) add(8, `volume ${volRatio.toFixed(1)}x em vela verde`);
    if (volRatio > 3 && lastC.close < lastC.open) add(-10, `volume ${volRatio.toFixed(1)}x em vela vermelha`);
    if (volRatio < 0.3) add(-5, "volume secando");
  }
  if (drawdown > 0.6) add(-15, `-${(drawdown * 100).toFixed(0)}% do topo`);
  else if (drawdown > 0.3) add(-6, `-${(drawdown * 100).toFixed(0)}% do topo`);
  else if (drawdown < 0.05) add(8, "na máxima do período");
  if (N > 40 && Math.max(...C.slice(-20)) > Math.max(...C.slice(-40, -20)) * 1.02 && mean(V.slice(-20)) < mean(V.slice(-40, -20)) * 0.7) {
    add(-10, "divergência: nova máxima com volume menor");
  }
  return { pattern, score: Math.max(0, Math.min(100, score)), slope, volatility, drawdown, volRatio, upFromLow, trend, evidence: ev };
}
