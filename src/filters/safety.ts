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

  return { ok: f.length === 0, failures: f };
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
