import type { StrategyId } from "../config/schema.js";

export type Source =
  | "trenches:new_creation"
  | "trenches:near_completion"
  | "trenches:completed"
  | "rank:1m"
  | "rank:5m"
  | "rank:1h"
  | "rank:6h"
  | "rank:24h"
  | "signal"
  | "info";

/** Estágio do token no ciclo de vida de um launchpad. */
export type Stage = "curve" | "near" | "migrated" | "unknown";

/** Visão normalizada de um token num instante (independente da rota da GMGN). */
export interface TokenSnapshot {
  address: string;
  symbol: string;
  name?: string;
  sources: Source[];
  observedAt: number;

  createdAt?: number;
  openAt?: number;
  stage: Stage;
  launchpad?: string;
  exchange?: string;
  /** Progresso da bonding curve (0–1). */
  progress?: number;

  priceUsd?: number;
  /** Quando `priceUsd` foi observado (ms) — para não comprar com preço velho. */
  priceAt?: number;
  marketCapUsd?: number;
  liquidityUsd?: number;
  holderCount?: number;

  volume1hUsd?: number;
  volume24hUsd?: number;
  /** Volume no intervalo do ranking (rank:1m, rank:5m...). */
  volumeByInterval?: Partial<Record<"1m" | "5m" | "1h" | "6h" | "24h", number>>;
  swaps1m?: number;
  swaps1h?: number;
  buys?: number;
  sells?: number;
  priceChange1mPct?: number;
  priceChange5mPct?: number;
  priceChange1hPct?: number;
  hotLevel?: number;

  smartDegenCount?: number;
  renownedCount?: number;

  // Segurança
  rugRatio?: number;
  top10HolderRate?: number;
  bundlerRate?: number;
  insiderRate?: number;
  devHoldRate?: number;
  top70SniperHoldRate?: number;
  entrapmentRatio?: number;
  sniperCount?: number;
  mintRenounced?: boolean;
  freezeRenounced?: boolean;
  isHoneypot?: boolean;
  isWashTrading?: boolean;
  buyTax?: number;
  sellTax?: number;
  creator?: string;
  creatorClosed?: boolean;

  hasSocial?: boolean;
  twitter?: string;
  website?: string;
  telegram?: string;

  /** Carteiras recém-criadas entre os holders (0–1). */
  freshWalletRate?: number;
  /** Carteiras-robô (0–1). */
  botDegenRate?: number;
  /** Maior market cap histórico (USD). */
  athMarketCapUsd?: number;
  /** Histórico do dev: total de tokens criados e quantos graduaram. */
  devCreatedCount?: number;
  devGraduatedCount?: number;
  /** Fluxo comprador/vendedor em USD na janela de 5 min (token/info). */
  buyVolume5mUsd?: number;
  sellVolume5mUsd?: number;

  /** Feed de sinais da GMGN: disparos por tipo, mcap no 1º sinal e horário do último. */
  signalCounts?: Record<string, number>;
  firstSignalMcUsd?: number;
  lastSignalAt?: number;
}

export interface TokenContext {
  snap: TokenSnapshot;
  /** Snapshots anteriores (mais antigo primeiro), sem o atual. */
  history: TokenSnapshot[];
  now: number;
}

export interface Signal {
  strategyId: StrategyId;
  token: TokenSnapshot;
  /** 0–100: quanto maior, melhor a oportunidade. */
  score: number;
  reasons: string[];
}

export type PositionStatus = "open" | "closed";

export interface Position {
  id: string;
  mode: "paper" | "live";
  tokenAddress: string;
  symbol: string;
  strategyId: StrategyId;
  creator?: string;
  openedAt: number;
  closedAt?: number;
  status: PositionStatus;

  entryPriceUsd: number;
  /** SOL gasto na compra (incluindo taxas). */
  entrySol: number;
  tokenDecimals: number;
  /** Quantidades em unidades mínimas (bigint serializado em string). */
  tokensInitialRaw: string;
  tokensRemainingRaw: string;

  highestPriceUsd: number;
  lowestPriceUsd: number;
  lastPriceUsd: number;
  lastPriceAt: number;

  /** Índices da escada de take profit já executados. */
  tpHits: number[];
  breakEvenArmed: boolean;
  /** SOL recebido em vendas (parciais + final). */
  realizedSol: number;
  exitReasons: string[];
  sellFailures: number;
  nextSellAttemptAt?: number;

  buyOrderId?: string;
  buyTx?: string;
  sellTxs: string[];
  entryScore: number;
  entryReasons: string[];
}

export interface TradeRecord {
  ts: number;
  mode: "paper" | "live";
  side: "buy" | "sell";
  positionId: string;
  strategyId: StrategyId;
  token: string;
  symbol: string;
  sol: number;
  tokensRaw: string;
  priceUsd: number;
  reason?: string;
  tx?: string;
  orderId?: string;
  pnlSol?: number;
  pnlPct?: number;
}
