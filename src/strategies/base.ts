import type { BaseStrategyConfig, StrategyId } from "../config/schema.js";
import type { Signal, TokenContext } from "../core/types.js";
import { clamp } from "../core/utils.js";

export interface Evaluation {
  pass: boolean;
  score: number;
  reasons: string[];
  rejects: string[];
}

export interface Strategy {
  readonly id: StrategyId;
  readonly label: string;
  readonly cfg: BaseStrategyConfig;
  /** Avalia o token. Sempre devolve a avaliação completa (útil para `scan`/debug). */
  evaluate(ctx: TokenContext): Evaluation;
}

/** Normaliza `v` para 0–1 entre `lo` e `hi` (linear, saturado). */
export function lin(v: number | undefined, lo: number, hi: number): number {
  if (v === undefined || !Number.isFinite(v)) return 0;
  if (hi <= lo) return v >= lo ? 1 : 0;
  return clamp((v - lo) / (hi - lo), 0, 1);
}

/**
 * Acumulador de regras: cada `need` é uma condição obrigatória; dados ausentes
 * reprovam (estratégias nunca compram "no escuro").
 */
export class Rules {
  readonly reasons: string[] = [];
  readonly rejects: string[] = [];
  private score = 0;

  need(cond: boolean | undefined, okMsg: string, failMsg: string): this {
    if (cond) this.reasons.push(okMsg);
    else this.rejects.push(failMsg);
    return this;
  }

  min(v: number | undefined, limit: number, label: string): this {
    if (limit <= 0 && v === undefined) return this;
    return this.need(v !== undefined && v >= limit, `${label}=${f(v)}`, `${label} ${f(v)} < ${f(limit)}`);
  }

  max(v: number | undefined, limit: number, label: string): this {
    return this.need(v !== undefined && v <= limit, `${label}=${f(v)}`, `${label} ${f(v)} > ${f(limit)}`);
  }

  range(v: number | undefined, lo: number, hi: number, label: string): this {
    return this.need(
      v !== undefined && v >= lo && v <= hi,
      `${label}=${f(v)}`,
      `${label} ${f(v)} fora de [${f(lo)}, ${f(hi)}]`,
    );
  }

  add(weight: number, factor01: number): this {
    this.score += weight * clamp(factor01, 0, 1);
    return this;
  }

  result(): Evaluation {
    return {
      pass: this.rejects.length === 0,
      score: Math.round(clamp(this.score, 0, 100)),
      reasons: this.reasons,
      rejects: this.rejects,
    };
  }
}

export function toSignal(s: Strategy, ctx: TokenContext, ev: Evaluation): Signal | null {
  if (!ev.pass || ev.score < s.cfg.minScore) return null;
  return { strategyId: s.id, token: ctx.snap, score: ev.score, reasons: ev.reasons };
}

function f(v: number | undefined): string {
  if (v === undefined) return "?";
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}
