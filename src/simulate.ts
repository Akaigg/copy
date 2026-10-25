/**
 * Simulador Monte Carlo de banca: "qual a chance real de sair de $X para $Y?"
 *
 * Duas formas de alimentar o modelo:
 *  1. --trades data/paper/trades.jsonl → reamostra (bootstrap) os resultados REAIS das suas
 *     operações em paper/replay. É a forma honesta: usa a vantagem (ou falta dela) que o robô
 *     mostrou com os seus parâmetros.
 *  2. --scenario → distribuições HIPOTÉTICAS, só para ilustrar a matemática de lei de potência
 *     (muitas perdas pequenas + raros ganhos enormes). Não são previsões.
 */

export interface Bucket {
  /** probabilidade do resultado */
  p: number;
  /** retorno sobre o valor da posição, em %, sorteado uniformemente entre min e max */
  min: number;
  max: number;
  label: string;
}

export const SCENARIOS: Record<string, { desc: string; buckets: Bucket[] }> = {
  pessimista: {
    desc: "sem vantagem: os filtros não separam vencedores (perfil do trader médio de memecoin); EV bruto ≈ -6%",
    buckets: [
      { p: 0.7, min: -35, max: -20, label: "stop loss" },
      { p: 0.18, min: -12, max: 5, label: "saída por tempo" },
      { p: 0.08, min: 40, max: 80, label: "take profit 2x" },
      { p: 0.035, min: 100, max: 250, label: "runner 3–6x" },
      { p: 0.005, min: 400, max: 1200, label: "moonshot 10x+" },
    ],
  },
  equilibrado: {
    desc: "vantagem pequena: filtros evitam boa parte dos rugs, saídas disciplinadas; EV bruto ≈ +5%",
    buckets: [
      { p: 0.62, min: -32, max: -18, label: "stop loss" },
      { p: 0.213, min: -10, max: 8, label: "saída por tempo" },
      { p: 0.11, min: 40, max: 80, label: "take profit 2x" },
      { p: 0.05, min: 100, max: 250, label: "runner 3–6x" },
      { p: 0.007, min: 400, max: 1200, label: "moonshot 10x+" },
    ],
  },
  otimista: {
    desc: "vantagem clara: seleção bem acima da média (difícil de sustentar); EV bruto ≈ +15%",
    buckets: [
      { p: 0.56, min: -30, max: -18, label: "stop loss" },
      { p: 0.222, min: -8, max: 10, label: "saída por tempo" },
      { p: 0.14, min: 40, max: 90, label: "take profit 2x" },
      { p: 0.07, min: 100, max: 250, label: "runner 3–6x" },
      { p: 0.008, min: 400, max: 1400, label: "moonshot 10x+" },
    ],
  },
};

export interface SimParams {
  startUsd: number;
  targetUsd: number;
  /** abaixo disso a conta é considerada quebrada (o robô para) */
  floorUsd: number;
  /** % do patrimônio por trade */
  betPct: number;
  /** aposta mínima em USD (abaixo disso as taxas inviabilizam) */
  minBetUsd: number;
  /** taxas fixas de ida+volta por trade em USD (priority + tip) */
  feeUsd: number;
  maxTrades: number;
  runs: number;
  seed?: number;
}

export interface SimResult {
  pTarget: number;
  pRuin: number;
  pUnfinished: number;
  medianTradesToTarget?: number;
  p10Final: number;
  medianFinal: number;
  p90Final: number;
  /** retorno esperado por trade (% da posição), já com as taxas fixas na aposta inicial */
  evPct: number;
  /** crescimento logarítmico esperado por trade da banca (com a fração escolhida) */
  logGrowth: number;
}

export type Sampler = (rand: () => number) => number;

export function bucketSampler(buckets: Bucket[]): Sampler {
  const total = buckets.reduce((a, b) => a + b.p, 0);
  return (rand) => {
    let x = rand() * total;
    for (const b of buckets) {
      if ((x -= b.p) <= 0) return b.min + rand() * (b.max - b.min);
    }
    const last = buckets[buckets.length - 1]!;
    return last.min + rand() * (last.max - last.min);
  };
}

export function bootstrapSampler(returnsPct: number[]): Sampler {
  if (!returnsPct.length) throw new Error("sem trades fechados para reamostrar");
  return (rand) => returnsPct[Math.floor(rand() * returnsPct.length)]!;
}

export function rng(seed = 12345): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

export function simulate(sample: Sampler, p: SimParams): SimResult {
  const rand = rng(p.seed);
  let hit = 0;
  let ruin = 0;
  const tradesToTarget: number[] = [];
  const finals: number[] = [];
  for (let run = 0; run < p.runs; run++) {
    let eq = p.startUsd;
    let done = false;
    for (let t = 1; t <= p.maxTrades; t++) {
      const bet = Math.min(eq, Math.max(p.minBetUsd, (eq * p.betPct) / 100));
      if (eq <= p.floorUsd || bet < p.minBetUsd) {
        ruin++;
        done = true;
        break;
      }
      eq += (bet * sample(rand)) / 100 - p.feeUsd;
      if (eq >= p.targetUsd) {
        hit++;
        tradesToTarget.push(t);
        done = true;
        break;
      }
      if (eq <= p.floorUsd) {
        ruin++;
        done = true;
        break;
      }
    }
    finals.push(eq);
    if (!done) {
      /* não terminou dentro de maxTrades */
    }
  }
  finals.sort((a, b) => a - b);
  tradesToTarget.sort((a, b) => a - b);
  const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))]!;

  // EV e crescimento log estimados por amostragem
  const r2 = rng((p.seed ?? 12345) + 1);
  let ev = 0;
  let lg = 0;
  const n = 20000;
  const bet0 = Math.max(p.minBetUsd, (p.startUsd * p.betPct) / 100);
  for (let i = 0; i < n; i++) {
    const r = sample(r2) - (p.feeUsd / bet0) * 100;
    ev += r;
    lg += Math.log(Math.max(1e-9, 1 + ((p.betPct / 100) * r) / 100));
  }
  return {
    pTarget: hit / p.runs,
    pRuin: ruin / p.runs,
    pUnfinished: 1 - (hit + ruin) / p.runs,
    medianTradesToTarget: tradesToTarget.length ? q(tradesToTarget, 0.5) : undefined,
    p10Final: q(finals, 0.1),
    medianFinal: q(finals, 0.5),
    p90Final: q(finals, 0.9),
    evPct: ev / n,
    logGrowth: lg / n,
  };
}

/** Lê retornos (%) de trades fechados de um trades.jsonl do robô. */
export function returnsFromTrades(lines: string[]): number[] {
  const out: number[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      const t = JSON.parse(l) as { side?: string; pnlPct?: number };
      if (t.side === "sell" && typeof t.pnlPct === "number" && Number.isFinite(t.pnlPct)) out.push(t.pnlPct);
    } catch {
      /* ignora */
    }
  }
  return out;
}
