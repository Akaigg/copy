import type { Logger } from "../core/logger.js";
import { Priority } from "../core/rateLimiter.js";
import type { TokenSnapshot } from "../core/types.js";
import { errMsg, first, num, SOL_MINT } from "../core/utils.js";
import type { GmgnClient } from "../gmgn/client.js";
import { fromSecurity, fromTokenInfo } from "../scanner/normalize.js";
import type { PriceOracle } from "./types.js";

/** Dados sob demanda: preço das posições, segurança antes da compra e preço do SOL. */
export interface MarketData extends PriceOracle {
  /** Snapshot fresco (preço/liquidez) de cada token. Tokens que falharem ficam fora do mapa. */
  refresh(addresses: string[], now: number): Promise<Map<string, TokenSnapshot>>;
  /** Dados de segurança frescos. undefined = indisponível. */
  security(address: string): Promise<Partial<TokenSnapshot> | undefined>;
}

export class GmgnMarketData implements MarketData {
  private solCache: { price: number; at: number } | null = null;

  constructor(
    private readonly client: GmgnClient,
    private readonly chain: string,
    private readonly solFallback: number,
    private readonly log: Logger,
  ) {}

  async solPriceUsd(): Promise<number> {
    if (this.solCache && Date.now() - this.solCache.at < 60_000) return this.solCache.price;
    try {
      const info = await this.client.getTokenInfo(this.chain, SOL_MINT, Priority.Monitor);
      const p = num(first(info, "price.price", "price"));
      if (p && p > 0) {
        this.solCache = { price: p, at: Date.now() };
        return p;
      }
    } catch (e) {
      this.log.debug(`Preço do SOL indisponível: ${errMsg(e)}`);
    }
    return this.solCache?.price ?? this.solFallback;
  }

  async refresh(addresses: string[], now: number): Promise<Map<string, TokenSnapshot>> {
    const out = new Map<string, TokenSnapshot>();
    await Promise.all(
      addresses.map(async (a) => {
        try {
          const info = await this.client.getTokenInfo(this.chain, a, Priority.Monitor);
          const s = fromTokenInfo({ address: a, ...info }, now);
          if (s?.priceUsd) out.set(a, s);
        } catch (e) {
          this.log.debug(`token/info ${a}: ${errMsg(e)}`);
        }
      }),
    );
    return out;
  }

  async security(address: string): Promise<Partial<TokenSnapshot> | undefined> {
    try {
      return fromSecurity(await this.client.getTokenSecurity(this.chain, address, Priority.Buy));
    } catch (e) {
      this.log.warn(`token/security ${address}: ${errMsg(e)}`);
      return undefined;
    }
  }
}
