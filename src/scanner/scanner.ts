import type { Config } from "../config/schema.js";
import type { Logger } from "../core/logger.js";
import type { TokenSnapshot } from "../core/types.js";
import { errMsg } from "../core/utils.js";
import type { GmgnClient } from "../gmgn/client.js";
import { fromRank, fromTrenches, mergeSnapshots } from "./normalize.js";

type RankInterval = "1m" | "5m" | "1h" | "6h" | "24h";

/** Fonte de descoberta de tokens (permite trocar GMGN por dados gravados no replay). */
export interface Scanner {
  scan(now: number): Promise<TokenSnapshot[]>;
}

/**
 * Busca tokens na GMGN a cada ciclo:
 *  - Trenches: recém-criados (bonding curve), quase graduando e recém-graduados
 *  - Ranking "hot" por intervalo (1m/5m/1h...), restrito a tokens jovens
 * Cada fonte falha de forma independente — uma rota fora do ar não para o robô.
 */
export class GmgnScanner implements Scanner {
  private tick = 0;
  private failures = new Map<string, number>();

  constructor(
    private readonly client: GmgnClient,
    private readonly cfg: Config,
    private readonly log: Logger,
  ) {}

  async scan(now = Date.now()): Promise<TokenSnapshot[]> {
    this.tick++;
    const jobs: Promise<TokenSnapshot[]>[] = [];
    const sc = this.cfg.scanner;

    if (sc.trenches.enabled && sc.trenches.types.length) jobs.push(this.guard("trenches", () => this.trenches(now)));

    if (sc.trending.enabled) {
      for (const interval of sc.trending.intervals) {
        const every = sc.trending.everyNTicks[interval] ?? 1;
        if ((this.tick - 1) % every !== 0) continue;
        jobs.push(this.guard(`rank:${interval}`, () => this.rank(interval, now)));
      }
    }

    const results = await Promise.all(jobs);
    const byAddr = new Map<string, TokenSnapshot>();
    for (const list of results) {
      for (const s of list) {
        const prev = byAddr.get(s.address);
        byAddr.set(s.address, prev ? mergeSnapshots(prev, s) : s);
      }
    }
    return [...byAddr.values()];
  }

  private async guard(name: string, fn: () => Promise<TokenSnapshot[]>): Promise<TokenSnapshot[]> {
    try {
      const out = await fn();
      this.failures.set(name, 0);
      return out;
    } catch (e) {
      const n = (this.failures.get(name) ?? 0) + 1;
      this.failures.set(name, n);
      // Evita inundar o log: avisa na 1ª falha e depois a cada 10.
      if (n === 1 || n % 10 === 0) this.log.warn(`Fonte ${name} falhou (${n}x seguidas): ${errMsg(e)}`);
      return [];
    }
  }

  private async trenches(now: number): Promise<TokenSnapshot[]> {
    const t = this.cfg.scanner.trenches;
    const section: Record<string, unknown> = {
      filters: ["offchain", "onchain"],
      launchpad_platform_v2: true,
      limit: t.limit,
      quote_address_type: [4, 5, 3, 1, 13, 0],
      ...t.serverFilters,
    };
    if (t.platforms.length) section.launchpad_platform = t.platforms;
    const body: Record<string, unknown> = { version: "v2" };
    for (const type of t.types) body[type] = { ...section };

    const data = await this.client.getTrenches(this.cfg.chain, body);
    const out: TokenSnapshot[] = [];
    for (const type of t.types) {
      const list = (data?.[type] ?? []) as unknown[];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const s = fromTrenches(item as Record<string, unknown>, type, now);
        if (s) out.push(s);
      }
    }
    return out;
  }

  private async rank(interval: RankInterval, now: number): Promise<TokenSnapshot[]> {
    const t = this.cfg.scanner.trending;
    const extra: Record<string, string | number | string[]> = { limit: t.limit, order_by: t.orderBy, direction: "desc" };
    if (t.filters.length) extra.filters = t.filters;
    if (t.platforms.length) extra.platforms = t.platforms;
    if (t.maxCreatedMin) extra.max_created = `${t.maxCreatedMin}m`;

    const data = await this.client.getRank(this.cfg.chain, interval, extra);
    const list = Array.isArray(data) ? data : (data?.rank ?? []);
    const out: TokenSnapshot[] = [];
    for (const item of list) {
      const s = fromRank(item as Record<string, unknown>, interval, now);
      if (s) out.push(s);
    }
    return out;
  }
}
