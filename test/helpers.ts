import { ConfigSchema, type Config } from "../src/config/schema.js";
import type { Position, TokenSnapshot } from "../src/core/types.js";

export function cfg(over: Record<string, unknown> = {}): Config {
  return ConfigSchema.parse(over);
}

export function snap(over: Partial<TokenSnapshot> = {}): TokenSnapshot {
  return {
    address: "Tok111111111111111111111111111111111111111",
    symbol: "TEST",
    sources: ["trenches:new_creation"],
    observedAt: 1_000_000,
    stage: "curve",
    createdAt: 1_000_000 - 60_000,
    priceUsd: 0.00001,
    marketCapUsd: 10_000,
    liquidityUsd: 8_000,
    holderCount: 60,
    swaps1m: 40,
    buys: 300,
    sells: 120,
    volume1hUsd: 9_000,
    smartDegenCount: 1,
    rugRatio: 0.05,
    top10HolderRate: 0.2,
    bundlerRate: 0.05,
    insiderRate: 0.05,
    devHoldRate: 0.03,
    mintRenounced: true,
    freezeRenounced: true,
    isWashTrading: false,
    ...over,
  };
}

export function position(over: Partial<Position> = {}): Position {
  return {
    id: "p1",
    mode: "paper",
    tokenAddress: "Tok1",
    symbol: "TEST",
    strategyId: "sniper",
    openedAt: 0,
    status: "open",
    entryPriceUsd: 1,
    entrySol: 0.1,
    tokenDecimals: 6,
    tokensInitialRaw: "1000000000",
    tokensRemainingRaw: "1000000000",
    highestPriceUsd: 1,
    lowestPriceUsd: 1,
    lastPriceUsd: 1,
    lastPriceAt: 0,
    tpHits: [],
    breakEvenArmed: false,
    realizedSol: 0,
    exitReasons: [],
    sellFailures: 0,
    sellTxs: [],
    entryScore: 80,
    entryReasons: [],
    ...over,
  };
}
