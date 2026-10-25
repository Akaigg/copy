import type { SafetyConfig } from "../config/schema.js";
import type { TokenSnapshot } from "../core/types.js";

export interface SafetyResult {
  ok: boolean;
  failures: string[];
}

/**
 * Filtros anti-rug obrigatórios. Rodam antes de qualquer estratégia e novamente,
 * com dados frescos de /token/security, imediatamente antes da compra.
 */
export function checkSafety(s: TokenSnapshot, cfg: SafetyConfig): SafetyResult {
  const f: string[] = [];
  const strict = cfg.strictMissing;

  const requireTrue = (v: boolean | undefined, label: string) => {
    if (v === false || (v === undefined && strict)) f.push(label);
  };
  const rejectTrue = (v: boolean | undefined, label: string) => {
    if (v === true || (v === undefined && strict)) f.push(label);
  };
  const max = (v: number | undefined, limit: number, label: string) => {
    if (v === undefined) {
      if (strict) f.push(`${label}: sem dado`);
    } else if (v > limit) f.push(`${label} ${fmt(v)} > ${fmt(limit)}`);
  };
  const min = (v: number | undefined, limit: number, label: string) => {
    if (limit <= 0) return;
    if (v === undefined) {
      if (strict) f.push(`${label}: sem dado`);
    } else if (v < limit) f.push(`${label} ${fmt(v)} < ${fmt(limit)}`);
  };

  if (cfg.blacklistTokens.includes(s.address)) f.push("token na blacklist");
  if (s.creator && cfg.blacklistCreators.includes(s.creator)) f.push("criador na blacklist");

  if (cfg.requireMintRenounced) requireTrue(s.mintRenounced, "mint authority ativa");
  if (cfg.requireFreezeRenounced) requireTrue(s.freezeRenounced, "freeze authority ativa");
  if (cfg.rejectHoneypot && s.isHoneypot === true) f.push("honeypot");
  if (cfg.rejectWashTrading) rejectTrue(s.isWashTrading, "wash trading");
  if (cfg.requireCreatorClosed) requireTrue(s.creatorClosed, "dev ainda segura tokens");
  if (cfg.requireSocial) requireTrue(s.hasSocial, "sem redes sociais");

  max(s.rugRatio, cfg.maxRugRatio, "rug_ratio");
  max(s.top10HolderRate, cfg.maxTop10HolderRate, "top10");
  max(s.bundlerRate, cfg.maxBundlerRate, "bundler");
  max(s.insiderRate, cfg.maxInsiderRate, "insider");
  max(s.devHoldRate, cfg.maxDevHoldRate, "dev_hold");
  max(s.top70SniperHoldRate, cfg.maxTop70SniperHoldRate, "snipers");
  max(s.entrapmentRatio, cfg.maxEntrapmentRatio, "entrapment");
  max(s.buyTax, cfg.maxBuyTax, "buy_tax");
  max(s.sellTax, cfg.maxSellTax, "sell_tax");
  min(s.liquidityUsd, cfg.minLiquidityUsd, "liquidez");
  min(s.holderCount, cfg.minHolders, "holders");
  if (s.freshWalletRate !== undefined && s.freshWalletRate > cfg.maxFreshWalletRate) {
    f.push(`carteiras novas ${fmt(s.freshWalletRate)} > ${fmt(cfg.maxFreshWalletRate)}`);
  }
  if (s.botDegenRate !== undefined && s.botDegenRate > cfg.maxBotDegenRate) {
    f.push(`robôs ${fmt(s.botDegenRate)} > ${fmt(cfg.maxBotDegenRate)}`);
  }
  if (cfg.maxDrop5mPct > 0 && s.priceChange5mPct !== undefined && s.priceChange5mPct <= -cfg.maxDrop5mPct) {
    f.push(`faca caindo: ${s.priceChange5mPct.toFixed(1)}% em 5m`);
  }
  if (cfg.rejectBundlerSelling && (s.signalCounts?.["10"] ?? 0) > 0) f.push("bundlers vendendo");
  f.push(...devFailures(s.devCreatedCount, s.devGraduatedCount, cfg));

  return { ok: f.length === 0, failures: f };
}

/** Regras de histórico do dev (usadas com dados do trenches e de /user/created_tokens). */
export function devFailures(created: number | undefined, graduated: number | undefined, cfg: SafetyConfig): string[] {
  if (created === undefined) return [];
  const out: string[] = [];
  const grad = graduated ?? 0;
  const failed = Math.max(0, created - grad);
  if (cfg.maxDevFailedLaunches > 0 && failed > cfg.maxDevFailedLaunches) {
    out.push(`dev fábrica: ${failed} lançamentos sem graduar`);
  }
  if (cfg.minDevGraduationRatio > 0 && created >= 5 && grad / created < cfg.minDevGraduationRatio) {
    out.push(`dev gradua ${((grad / created) * 100).toFixed(1)}% < ${(cfg.minDevGraduationRatio * 100).toFixed(1)}%`);
  }
  return out;
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(3);
}

export function mergeSafety(base: SafetyConfig, override: Partial<SafetyConfig>): SafetyConfig {
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  // Blacklists são somadas, nunca substituídas.
  out.blacklistTokens = [...new Set([...base.blacklistTokens, ...(override.blacklistTokens ?? [])])];
  out.blacklistCreators = [...new Set([...base.blacklistCreators, ...(override.blacklistCreators ?? [])])];
  return out;
}
