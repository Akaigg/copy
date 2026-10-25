import type { Source, Stage, TokenSnapshot } from "../core/types.js";
import { bool, first, num, pct, str, tsMs } from "../core/utils.js";

/**
 * Normalizadores: as rotas da GMGN usam nomes de campos diferentes para a mesma
 * informação (ex.: `bundler_rate` no ranking e `bundler_trader_amount_rate` no trenches).
 * Tudo vira um `TokenSnapshot` único para que filtros e estratégias não dependam da rota.
 */

type Raw = Record<string, unknown>;

const TRENCH_STAGE: Record<string, Stage> = {
  new_creation: "curve",
  near_completion: "near",
  completed: "migrated",
};

function common(r: Raw): Omit<TokenSnapshot, "address" | "symbol" | "sources" | "observedAt" | "stage"> {
  const creatorStatus = str(first(r, "creator_token_status", "dev.creator_token_status"));
  const creatorClose = bool(r["creator_close"]);
  const twitter = str(first(r, "twitter", "twitter_username", "link.twitter_username"));
  const website = str(first(r, "website", "link.website"));
  const telegram = str(first(r, "telegram", "link.telegram"));
  const hasSocialFlag = bool(first(r, "has_at_least_one_social", "has_social"));
  const honeypot = r["is_honeypot"];
  return {
    name: str(r["name"]),
    createdAt: tsMs(first(r, "created_timestamp", "creation_timestamp")),
    openAt: tsMs(r["open_timestamp"]),
    launchpad: str(first(r, "launchpad_platform", "launchpad")),
    exchange: str(r["exchange"]),
    progress: num(first(r, "progress", "launchpad_progress", "bonding_curve_progress")),
    liquidityUsd: num(r["liquidity"]),
    holderCount: num(r["holder_count"]),
    smartDegenCount: num(r["smart_degen_count"]),
    renownedCount: num(r["renowned_count"]),
    hotLevel: num(r["hot_level"]),
    rugRatio: num(r["rug_ratio"]),
    top10HolderRate: num(first(r, "top_10_holder_rate", "stat.top_10_holder_rate")),
    bundlerRate: num(first(r, "bundler_trader_amount_rate", "bundler_rate")),
    insiderRate: num(first(r, "rat_trader_amount_rate", "suspected_insider_hold_rate", "insider_rate")),
    devHoldRate: num(first(r, "dev_team_hold_rate", "creator_balance_rate")),
    top70SniperHoldRate: num(r["top70_sniper_hold_rate"]),
    entrapmentRatio: num(r["entrapment_ratio"]),
    sniperCount: num(r["sniper_count"]),
    mintRenounced: bool(r["renounced_mint"]),
    freezeRenounced: bool(r["renounced_freeze_account"]),
    isHoneypot: honeypot === "" ? undefined : bool(honeypot),
    isWashTrading: bool(r["is_wash_trading"]),
    buyTax: num(r["buy_tax"]) ?? (r["buy_tax"] === "" ? 0 : undefined),
    sellTax: num(r["sell_tax"]) ?? (r["sell_tax"] === "" ? 0 : undefined),
    creator: str(first(r, "creator", "creator_address", "dev.creator_address")),
    creatorClosed:
      creatorClose ?? (creatorStatus ? creatorStatus === "creator_close" || creatorStatus === "sell" : undefined),
    hasSocial: hasSocialFlag ?? (twitter || website || telegram ? true : undefined),
    twitter,
    website,
    telegram,
    freshWalletRate: num(first(r, "fresh_wallet_rate", "stat.fresh_wallet_rate")),
    botDegenRate: num(first(r, "bot_degen_rate", "stat.top_bot_degen_percentage")),
    athMarketCapUsd: num(first(r, "history_highest_market_cap", "ath_mc")),
    devCreatedCount: num(first(r, "creator_created_count", "dev.creator_created_count")),
    devGraduatedCount: num(first(r, "creator_created_open_count", "dev.creator_created_open_count")),
  };
}

function priceFrom(r: Raw, mcap: number | undefined): number | undefined {
  const p = num(r["price"]);
  if (p !== undefined && p > 0) return p;
  const supply = num(first(r, "circulating_supply", "total_supply"));
  if (mcap !== undefined && supply) return mcap / supply;
  return undefined;
}

export function fromTrenches(r: Raw, category: string, now: number): TokenSnapshot | null {
  const address = str(r["address"]);
  if (!address) return null;
  const mcap = num(first(r, "usd_market_cap", "market_cap"));
  return {
    ...common(r),
    address,
    symbol: str(r["symbol"]) ?? "?",
    sources: [`trenches:${category}` as Source],
    observedAt: now,
    stage: TRENCH_STAGE[category] ?? "unknown",
    marketCapUsd: mcap,
    priceUsd: priceFrom(r, mcap),
    priceAt: now,
    volume1hUsd: num(r["volume_1h"]),
    volume24hUsd: num(r["volume_24h"]),
    swaps1m: num(r["swaps_1m"]),
    swaps1h: num(r["swaps_1h"]),
    buys: num(first(r, "buys_24h", "buys")),
    sells: num(first(r, "sells_24h", "sells")),
  };
}

export function fromRank(r: Raw, interval: "1m" | "5m" | "1h" | "6h" | "24h", now: number): TokenSnapshot | null {
  const address = str(r["address"]);
  if (!address) return null;
  const mcap = num(first(r, "market_cap", "usd_market_cap"));
  const openAt = tsMs(r["open_timestamp"]);
  const volume = num(r["volume"]);
  const c = common(r);
  return {
    ...c,
    address,
    symbol: str(r["symbol"]) ?? "?",
    sources: [`rank:${interval}` as Source],
    observedAt: now,
    stage: openAt ? "migrated" : c.progress !== undefined && c.progress >= 0.85 ? "near" : "unknown",
    marketCapUsd: mcap,
    priceUsd: priceFrom(r, mcap),
    priceAt: now,
    volumeByInterval: volume !== undefined ? { [interval]: volume } : undefined,
    volume1hUsd: interval === "1h" ? volume : undefined,
    volume24hUsd: interval === "24h" ? volume : undefined,
    buys: num(r["buys"]),
    sells: num(r["sells"]),
    swaps1m: interval === "1m" ? num(r["swaps"]) : undefined,
    swaps1h: interval === "1h" ? num(r["swaps"]) : undefined,
    priceChange1mPct: num(r["price_change_percent1m"]) ?? (interval === "1m" ? num(r["price_change_percent"]) : undefined),
    priceChange5mPct: num(r["price_change_percent5m"]) ?? (interval === "5m" ? num(r["price_change_percent"]) : undefined),
    priceChange1hPct: num(r["price_change_percent1h"]) ?? (interval === "1h" ? num(r["price_change_percent"]) : undefined),
  };
}

/** /v1/token/info -> campos de preço/liquidez (usado no monitoramento de posições). */
export function fromTokenInfo(r: Raw, now: number): TokenSnapshot | null {
  const address = str(r["address"]);
  if (!address) return null;
  const price = num(first(r, "price.price", "price"));
  const supply = num(first(r, "circulating_supply", "total_supply"));
  const p1m = num(first(r, "price.price_1m"));
  const p5m = num(first(r, "price.price_5m"));
  const p1h = num(first(r, "price.price_1h"));
  const status = num(r["launchpad_status"]);
  return {
    ...common(r),
    address,
    symbol: str(r["symbol"]) ?? "?",
    sources: ["info"],
    observedAt: now,
    stage: status === 2 ? "migrated" : status === 1 ? "curve" : "unknown",
    progress: num(r["launchpad_progress"]),
    priceUsd: price,
    priceAt: now,
    marketCapUsd: price !== undefined && supply ? price * supply : undefined,
    volume1hUsd: num(first(r, "price.volume_1h")),
    volume24hUsd: num(first(r, "price.volume_24h")),
    swaps1m: num(first(r, "price.swaps_1m")),
    swaps1h: num(first(r, "price.swaps_1h")),
    buys: num(first(r, "price.buys_1h")),
    sells: num(first(r, "price.sells_1h")),
    hotLevel: num(first(r, "price.hot_level")),
    buyVolume5mUsd: num(first(r, "price.buy_volume_5m")),
    sellVolume5mUsd: num(first(r, "price.sell_volume_5m")),
    priceChange1mPct: price !== undefined && p1m ? pct(p1m, price) : undefined,
    priceChange5mPct: price !== undefined && p5m ? pct(p5m, price) : undefined,
    priceChange1hPct: price !== undefined && p1h ? pct(p1h, price) : undefined,
  };
}

/** /v1/token/security -> somente campos de segurança. */
export function fromSecurity(r: Raw): Partial<TokenSnapshot> {
  const c = common(r);
  const out: Partial<TokenSnapshot> = {};
  for (const k of [
    "rugRatio",
    "top10HolderRate",
    "bundlerRate",
    "insiderRate",
    "devHoldRate",
    "top70SniperHoldRate",
    "entrapmentRatio",
    "mintRenounced",
    "freezeRenounced",
    "isHoneypot",
    "isWashTrading",
    "buyTax",
    "sellTax",
    "creatorClosed",
    "creator",
    "freshWalletRate",
    "botDegenRate",
  ] as const) {
    if (c[k] !== undefined) (out as Record<string, unknown>)[k] = c[k];
  }
  return out;
}

/**
 * /v1/market/token_signal: um item por evento. Agrega por token (contagem por tipo,
 * mcap no primeiro sinal, horário do último). Itens não trazem preço — o scanner
 * completa com token/info quando necessário.
 */
export function fromSignals(items: Raw[], now: number): TokenSnapshot[] {
  const by = new Map<string, TokenSnapshot>();
  for (const it of items) {
    const address = str(first(it, "token_address", "address"));
    if (!address) continue;
    const type = String(num(it["signal_type"]) ?? "?");
    const triggerAt = tsMs(it["trigger_at"]);
    const prev = by.get(address);
    const counts: Record<string, number> = { ...(prev?.signalCounts ?? {}) };
    const byType = it["signal_times_by_type"];
    if (byType && typeof byType === "object") {
      for (const [k, v] of Object.entries(byType as Record<string, unknown>)) {
        const n = num(v);
        if (n !== undefined) counts[k] = Math.max(counts[k] ?? 0, n);
      }
    }
    counts[type] = Math.max(counts[type] ?? 0, 1);
    const firstMc = num(first(it, "first_trigger_mc", "trigger_mc"));
    const snap: TokenSnapshot = {
      ...(prev ?? { address, symbol: str(first(it, "symbol", "data.symbol")) ?? "?", sources: ["signal"], observedAt: now, stage: "unknown" }),
      marketCapUsd: num(it["market_cap"]) ?? prev?.marketCapUsd,
      athMarketCapUsd: num(it["ath"]) ?? prev?.athMarketCapUsd,
      holderCount: num(first(it, "cur_data.holder_count")) ?? prev?.holderCount,
      liquidityUsd: num(first(it, "cur_data.liquidity")) ?? prev?.liquidityUsd,
      top10HolderRate: num(first(it, "cur_data.top_10_holder_rate")) ?? prev?.top10HolderRate,
      signalCounts: counts,
      firstSignalMcUsd:
        firstMc !== undefined ? Math.min(firstMc, prev?.firstSignalMcUsd ?? Infinity) : prev?.firstSignalMcUsd,
      lastSignalAt: Math.max(triggerAt ?? 0, prev?.lastSignalAt ?? 0) || undefined,
    };
    by.set(address, snap);
  }
  return [...by.values()];
}

/** Total de disparos dos tipos pedidos. */
export function signalCount(s: TokenSnapshot, types: number[]): number {
  if (!s.signalCounts) return 0;
  return types.reduce((acc, t) => acc + (s.signalCounts?.[String(t)] ?? 0), 0);
}

/** Junta dois snapshots do mesmo token: valores definidos de `b` prevalecem. */
export function mergeSnapshots(a: TokenSnapshot, b: Partial<TokenSnapshot>): TokenSnapshot {
  const out: TokenSnapshot = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    if (k === "sources") {
      out.sources = Array.from(new Set([...a.sources, ...(v as Source[])]));
    } else if (k === "priceAt") {
      // Só vale se este snapshot trouxe preço de fato.
      if (b.priceUsd !== undefined) out.priceAt = v as number;
    } else if (k === "signalCounts") {
      const merged: Record<string, number> = { ...(a.signalCounts ?? {}) };
      for (const [t, n] of Object.entries(v as Record<string, number>)) merged[t] = Math.max(merged[t] ?? 0, n);
      out.signalCounts = merged;
    } else if (k === "firstSignalMcUsd") {
      out.firstSignalMcUsd = Math.min(a.firstSignalMcUsd ?? Infinity, v as number);
    } else if (k === "volumeByInterval") {
      out.volumeByInterval = { ...(a.volumeByInterval ?? {}), ...(v as object) };
    } else if (k === "stage") {
      if (v !== "unknown") out.stage = v as Stage;
    } else {
      (out as unknown as Record<string, unknown>)[k] = v;
    }
  }
  out.observedAt = Math.max(a.observedAt, b.observedAt ?? 0);
  return out;
}

export function ageSec(s: TokenSnapshot, now: number): number | undefined {
  return s.createdAt ? Math.max(0, (now - s.createdAt) / 1000) : undefined;
}

export function buySellRatio(s: TokenSnapshot): number | undefined {
  if (s.buys === undefined || s.sells === undefined) return undefined;
  return s.sells === 0 ? (s.buys > 0 ? s.buys : undefined) : s.buys / s.sells;
}
