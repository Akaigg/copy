import type { BaseStrategyConfig } from "../config/schema.js";
import type { Position, TokenSnapshot } from "../core/types.js";

export interface BuyRequest {
  token: TokenSnapshot;
  sizeSol: number;
  strategy: BaseStrategyConfig;
}

export type BuyResult =
  | { ok: true; tokensRaw: bigint; decimals: number; priceUsd: number; spentSol: number; orderId?: string; tx?: string }
  | { ok: false; error: string; /** estado incerto: a ordem pode ter executado */ uncertain?: boolean; orderId?: string };

export interface SellRequest {
  position: Position;
  amountRaw: bigint;
  full: boolean;
  /** Preço/liquidez atuais (usados na simulação do paper). */
  priceUsd: number;
  liquidityUsd?: number;
  strategy: BaseStrategyConfig;
}

export type SellResult =
  | { ok: true; soldRaw: bigint; receivedSol: number; priceUsd: number; tx?: string; orderId?: string }
  | { ok: false; error: string; uncertain?: boolean };

export interface Executor {
  readonly mode: "paper" | "live";
  buy(req: BuyRequest): Promise<BuyResult>;
  sell(req: SellRequest): Promise<SellResult>;
  /** Saldo disponível em SOL (undefined se não for possível consultar). */
  getSolBalance(): Promise<number | undefined>;
  /** Saldo real do token na carteira (live). undefined = desconhecido. */
  getTokenBalanceRaw(token: string, decimals: number): Promise<bigint | undefined>;
}

export interface PriceOracle {
  solPriceUsd(): Promise<number>;
}
