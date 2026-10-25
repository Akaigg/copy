import type { Config } from "./config/schema.js";
import type { Logger } from "./core/logger.js";
import type { Recorder } from "./core/recorder.js";
import type { StateStore } from "./core/store.js";
import type { Position, Signal, TokenSnapshot, TradeRecord } from "./core/types.js";
import { errMsg, fmtSol, fmtUsd, fromRaw, shortAddr, sleep } from "./core/utils.js";
import type { MarketData } from "./execution/marketData.js";
import type { Executor } from "./execution/types.js";
import { checkSafety, mergeSafety } from "./filters/safety.js";
import type { Notifier } from "./notify/notifier.js";
import { decideExit, trackPrice, type ExitDecision } from "./positions/exitRules.js";
import { RiskManager } from "./risk/riskManager.js";
import { mergeSnapshots } from "./scanner/normalize.js";
import type { Scanner } from "./scanner/scanner.js";
import { TokenStore } from "./scanner/tokenStore.js";
import { createStrategies, toSignal, type Strategy } from "./strategies/index.js";

export interface EngineDeps {
  cfg: Config;
  log: Logger;
  store: StateStore;
  executor: Executor;
  market: MarketData;
  scanner: Scanner;
  notifier: Notifier;
  recorder?: Recorder;
  /** Relógio injetável (replay usa tempo simulado). */
  clock?: () => number;
}

export interface EngineStatus {
  mode: "paper" | "live";
  startedAt: number;
  now: number;
  blockReason: string | null;
  balanceSol?: number;
  solPriceUsd?: number;
  tokensTracked: number;
  lastScanAt: number;
  lastScanCount: number;
  signalsLastScan: number;
  rateLimiterQueue?: number;
  positions: Array<Position & { pnlPct: number; valueSol: number; unrealizedSol: number }>;
  daily: StateStore["state"]["daily"];
  totals: StateStore["state"]["totals"];
  recentTrades: TradeRecord[];
}

/**
 * Motor do robô. Três ciclos independentes:
 *  - scan: descobre tokens → filtros de segurança → estratégias → risco → compra
 *  - posições: atualiza preços → regras de saída → venda
 *  - manutenção: reconciliação de saldo (live), revalidação de segurança, virada do dia
 */
export class Engine {
  readonly tokens: TokenStore;
  readonly risk: RiskManager;
  readonly strategies: Strategy[];
  private readonly cfg: Config;
  private readonly log: Logger;
  private readonly store: StateStore;
  private readonly executor: Executor;
  private readonly market: MarketData;
  private readonly scanner: Scanner;
  private readonly notifier: Notifier;
  private readonly recorder?: Recorder;
  private readonly now: () => number;

  private running = false;
  private timers = new Map<string, NodeJS.Timeout>();
  /** Tokens com ordem em andamento (evita ordens duplicadas). */
  private inflight = new Set<string>();
  /** Tokens temporariamente ignorados (ex.: reprovados na checagem de segurança). */
  private skipUntil = new Map<string, number>();
  private lastSafetyCheck = new Map<string, number>();
  private startedAt = 0;
  private lastScanAt = 0;
  private lastScanCount = 0;
  private signalsLastScan = 0;
  private lastReconcile = 0;
  private cachedBalance?: number;
  private cachedBalanceAt = 0;
  private cachedSolPrice?: number;
  private recentTrades: TradeRecord[] = [];
  rateLimiterQueue?: () => number;

  constructor(d: EngineDeps) {
    this.cfg = d.cfg;
    this.log = d.log.child("engine");
    this.store = d.store;
    this.executor = d.executor;
    this.market = d.market;
    this.scanner = d.scanner;
    this.notifier = d.notifier;
    this.recorder = d.recorder;
    this.now = d.clock ?? Date.now;
    this.tokens = new TokenStore(d.cfg.scanner.historySize, d.cfg.scanner.forgetAfterMin * 60_000);
    this.risk = new RiskManager(d.cfg, d.store, d.log.child("risk"));
    this.strategies = createStrategies(d.cfg).filter((s) => s.cfg.enabled);
    this.recentTrades = d.store.readTrades().slice(-30);
  }

  // ------------------------------------------------------------------ ciclo de vida

  async start() {
    if (this.running) return;
    this.running = true;
    this.startedAt = this.now();
    const open = this.store.openPositions;
    this.log.info(
      `Iniciando em modo ${this.cfg.mode.toUpperCase()} | estratégias: ${this.strategies.map((s) => s.id).join(", ") || "nenhuma"} | posições abertas: ${open.length}`,
    );
    if (!this.strategies.length) this.log.warn("Nenhuma estratégia habilitada — o robô só vai gerenciar posições existentes.");
    this.notifier.send("info", `🤖 Robô iniciado (${this.cfg.mode}) — ${open.length} posições abertas`);

    this.loop("positions", this.cfg.positions.monitorIntervalMs, (now) => this.processPositions(now));
    this.loop("scan", this.cfg.scanner.intervalMs, (now) => this.processScan(now));
    this.loop("maintenance", 15_000, (now) => this.maintenance(now));
  }

  async stop(sellAll = this.cfg.sellAllOnShutdown) {
    if (!this.running) return;
    this.running = false;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.log.info("Parando... aguardando ordens em andamento");
    for (let i = 0; i < 120 && this.inflight.size; i++) await sleep(500);
    if (sellAll) await this.sellAll("desligamento");
    this.store.save(true);
    this.log.info(`Robô parado. Posições abertas: ${this.store.openPositions.length}`);
    this.notifier.send("info", "🛑 Robô parado");
    await this.notifier.flush();
  }

  private loop(name: string, intervalMs: number, fn: (now: number) => Promise<void>) {
    const run = async () => {
      if (!this.running) return;
      const t0 = Date.now();
      try {
        await fn(this.now());
      } catch (e) {
        this.log.error(`Erro no ciclo ${name}: ${errMsg(e)}`);
      }
      this.store.save();
      if (this.running) this.timers.set(name, setTimeout(run, Math.max(50, intervalMs - (Date.now() - t0))));
    };
    void run();
  }

  // ------------------------------------------------------------------ scan e entradas

  async processScan(now: number) {
    const snaps = await this.scanner.scan(now);
    this.lastScanAt = now;
    this.lastScanCount = snaps.length;
    this.recorder?.write({ t: now, kind: "scan", snaps });

    const openTokens = new Set(this.store.openPositions.map((p) => p.tokenAddress));
    const signals: Signal[] = [];
    const baseSafety = this.globalSafety();

    for (const raw of snaps) {
      const ctx = this.tokens.upsert(raw);
      if (openTokens.has(raw.address)) continue;
      const skip = this.skipUntil.get(raw.address);
      if (skip && skip > now) continue;

      let best: Signal | null = null;
      for (const strat of this.strategies) {
        const safety = checkSafety(ctx.snap, mergeSafety(baseSafety, strat.cfg.safety));
        if (!safety.ok) continue;
        const sig = toSignal(strat, ctx, strat.evaluate(ctx));
        if (sig && (!best || sig.score > best.score)) best = sig;
      }
      if (best) signals.push(best);
    }
    this.tokens.prune(now, openTokens);
    this.signalsLastScan = signals.length;
    if (signals.length) this.log.debug(`${signals.length} sinais em ${snaps.length} tokens`);

    if (this.risk.blockReason(now)) return;
    signals.sort((a, b) => b.score - a.score);
    let balance = signals.length ? await this.balance() : undefined;
    for (const sig of signals) {
      if (!this.running && !this.isManual) break;
      const decision = this.risk.canOpen(sig, now, balance);
      if (!decision.ok) {
        this.log.debug(`Sinal ${sig.token.symbol}/${sig.strategyId} recusado pelo risco: ${decision.reason}`);
        continue;
      }
      const opened = await this.openPosition(sig, decision.sizeSol, now);
      if (opened && balance !== undefined) balance -= decision.sizeSol;
    }
  }

  /** true quando rodando via step() (replay/scan único) em vez de timers. */
  private isManual = false;

  /** Executa um ciclo completo manualmente (replay / testes). */
  async step(now: number) {
    this.isManual = true;
    this.store.rollDay();
    await this.processScan(now);
    await this.processPositions(now);
  }

  private globalSafety() {
    const st = this.store.state;
    return mergeSafety(this.cfg.safety, { blacklistTokens: st.blacklistTokens, blacklistCreators: st.blacklistCreators });
  }

  private async openPosition(sig: Signal, sizeSol: number, now: number): Promise<boolean> {
    const t = sig.token;
    const strat = this.cfg.strategies[sig.strategyId];
    if (this.inflight.has(t.address)) return false;
    this.inflight.add(t.address);
    try {
      // Revalidação de segurança com dados frescos (rug pulls acontecem em segundos).
      let token: TokenSnapshot = t;
      if (this.cfg.verifySecurityBeforeBuy) {
        const sec = await this.market.security(t.address);
        if (!sec && this.cfg.safety.strictMissing) {
          this.skip(t.address, now, 60_000);
          return false;
        }
        if (sec) {
          token = mergeSnapshots(t, sec);
          this.tokens.patch(t.address, sec);
          const res = checkSafety(token, mergeSafety(this.globalSafety(), strat.safety));
          if (!res.ok) {
            this.log.info(`✋ ${t.symbol} reprovado na checagem final: ${res.failures.join("; ")}`);
            this.skip(t.address, now, 30 * 60_000);
            return false;
          }
        }
      }

      this.store.state.pendingBuys.push({ token: t.address, symbol: t.symbol, strategyId: sig.strategyId, startedAt: now });
      this.store.save(true);

      this.log.info(
        `🟢 COMPRA ${t.symbol} (${shortAddr(t.address)}) via ${sig.strategyId} | score ${sig.score} | ${fmtSol(sizeSol)} | mcap ${fmtUsd(t.marketCapUsd)} | ${sig.reasons.slice(0, 6).join(", ")}`,
      );
      const res = await this.executor.buy({ token, sizeSol, strategy: strat });
      const pending = this.store.state.pendingBuys.find((p) => p.token === t.address);

      if (!res.ok) {
        if (res.uncertain && pending) {
          pending.orderId = res.orderId;
          this.log.warn(`Compra de ${t.symbol} com estado incerto (${res.error}) — será reconciliada pelo saldo`);
        } else {
          this.removePending(t.address);
          this.log.warn(`Compra de ${t.symbol} falhou: ${res.error}`);
        }
        this.skip(t.address, now, 2 * 60_000);
        this.store.markDirty();
        return false;
      }
      this.removePending(t.address);

      const pos: Position = {
        id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        mode: this.cfg.mode,
        tokenAddress: t.address,
        symbol: t.symbol,
        strategyId: sig.strategyId,
        creator: token.creator,
        openedAt: now,
        status: "open",
        entryPriceUsd: res.priceUsd,
        entrySol: res.spentSol,
        tokenDecimals: res.decimals,
        tokensInitialRaw: res.tokensRaw.toString(),
        tokensRemainingRaw: res.tokensRaw.toString(),
        highestPriceUsd: res.priceUsd,
        lowestPriceUsd: res.priceUsd,
        lastPriceUsd: res.priceUsd,
        lastPriceAt: now,
        tpHits: [],
        breakEvenArmed: false,
        realizedSol: 0,
        exitReasons: [],
        sellFailures: 0,
        buyOrderId: res.orderId,
        buyTx: res.tx,
        sellTxs: [],
        entryScore: sig.score,
        entryReasons: sig.reasons,
      };
      this.store.state.positions.push(pos);
      this.risk.onBuy(now);
      this.trade({
        ts: now,
        mode: pos.mode,
        side: "buy",
        positionId: pos.id,
        strategyId: pos.strategyId,
        token: pos.tokenAddress,
        symbol: pos.symbol,
        sol: res.spentSol,
        tokensRaw: pos.tokensInitialRaw,
        priceUsd: res.priceUsd,
        reason: sig.reasons.join(", "),
        tx: res.tx,
        orderId: res.orderId,
      });
      this.notifier.send(
        "buy",
        `🟢 <b>COMPRA</b> ${esc(t.symbol)} [${sig.strategyId}]\n${fmtSol(res.spentSol)} @ $${res.priceUsd.toPrecision(4)}\nmcap ${fmtUsd(t.marketCapUsd)} · score ${sig.score}\nhttps://gmgn.ai/sol/token/${t.address}`,
      );
      this.cachedBalance = undefined;
      this.store.save(true);
      return true;
    } catch (e) {
      this.log.error(`Erro ao comprar ${t.symbol}: ${errMsg(e)}`);
      this.removePending(t.address);
      return false;
    } finally {
      this.inflight.delete(t.address);
    }
  }

  private removePending(token: string) {
    this.store.state.pendingBuys = this.store.state.pendingBuys.filter((p) => p.token !== token);
  }

  private skip(token: string, now: number, ms: number) {
    this.skipUntil.set(token, now + ms);
  }

  // ------------------------------------------------------------------ posições e saídas

  async processPositions(now: number) {
    const open = this.store.openPositions;
    if (!open.length) return;

    const stale: string[] = [];
    for (const p of open) {
      const s = this.tokens.get(p.tokenAddress);
      if (!s?.priceUsd || now - s.observedAt > this.cfg.positions.priceMaxAgeMs) stale.push(p.tokenAddress);
    }
    if (stale.length) {
      const fresh = await this.market.refresh(stale, now);
      if (fresh.size) this.recorder?.write({ t: now, kind: "tick", snaps: [...fresh.values()] });
      for (const [addr, s] of fresh) {
        if (this.tokens.get(addr)) this.tokens.patch(addr, s);
        else this.tokens.upsert(s);
      }
    }

    await Promise.all(
      open.map(async (p) => {
        const s = this.tokens.get(p.tokenAddress);
        const exitCfg = this.cfg.strategies[p.strategyId].exit;
        const fresh = !!s?.priceUsd && now - s.observedAt <= this.cfg.positions.priceMaxAgeMs * 3;
        if (fresh) {
          trackPrice(p, s!.priceUsd!, now, exitCfg);
          this.store.markDirty();
        }
        // Sem preço novo (token morto / API fora) ainda avaliamos com o último preço,
        // para que as saídas por tempo continuem funcionando.
        const price = fresh ? s!.priceUsd! : p.lastPriceUsd;
        const d = decideExit(p, price, now, exitCfg);
        if (d) await this.sellPosition(p, d, price, s?.liquidityUsd, now);
      }),
    );
  }

  private async sellPosition(p: Position, d: ExitDecision, priceUsd: number, liquidityUsd: number | undefined, now: number) {
    if (this.inflight.has(p.tokenAddress)) return;
    if (p.nextSellAttemptAt && p.nextSellAttemptAt > now) return;
    this.inflight.add(p.tokenAddress);
    const strat = this.cfg.strategies[p.strategyId];
    try {
      const gain = ((priceUsd - p.entryPriceUsd) / p.entryPriceUsd) * 100;
      this.log.info(`🔴 VENDA ${p.symbol} ${d.full ? "TOTAL" : "PARCIAL"} | ${d.reason} | ${gain.toFixed(1)}%`);
      const res = await this.executor.sell({ position: p, amountRaw: d.sellRaw, full: d.full, priceUsd, liquidityUsd, strategy: strat });
      if (!res.ok) {
        p.sellFailures++;
        p.nextSellAttemptAt = now + this.cfg.execution.sellRetryCooldownMs;
        this.log.warn(`Venda de ${p.symbol} falhou (${p.sellFailures}x): ${res.error}`);
        if (res.uncertain) this.lastReconcile = 0; // força reconciliação de saldo
        if (p.sellFailures === 3 || p.sellFailures % 10 === 0) {
          this.notifier.send("error", `⚠️ Venda de ${esc(p.symbol)} falhando (${p.sellFailures}x): ${esc(res.error)}`);
        }
        this.store.markDirty();
        return;
      }

      p.sellFailures = 0;
      p.nextSellAttemptAt = undefined;
      const remaining = BigInt(p.tokensRemainingRaw);
      const left = d.full ? 0n : remaining - (res.soldRaw > remaining ? remaining : res.soldRaw);
      p.tokensRemainingRaw = left.toString();
      p.realizedSol += res.receivedSol;
      p.tpHits.push(...d.tpIndexes);
      p.exitReasons.push(d.reason);
      if (res.tx) p.sellTxs.push(res.tx);

      const closing = left <= 0n;
      let pnlInfo: { pnl: number; pnlPct: number } | undefined;
      if (closing) {
        p.status = "closed";
        p.closedAt = now;
        pnlInfo = this.risk.onClose(p, now);
      }
      this.trade({
        ts: now,
        mode: p.mode,
        side: "sell",
        positionId: p.id,
        strategyId: p.strategyId,
        token: p.tokenAddress,
        symbol: p.symbol,
        sol: res.receivedSol,
        tokensRaw: res.soldRaw.toString(),
        priceUsd: res.priceUsd,
        reason: d.reason,
        tx: res.tx,
        orderId: res.orderId,
        pnlSol: pnlInfo?.pnl,
        pnlPct: pnlInfo?.pnlPct,
      });
      if (pnlInfo) {
        const icon = pnlInfo.pnl >= 0 ? "✅" : "❌";
        this.log.info(`${icon} Posição ${p.symbol} encerrada: ${fmtSol(pnlInfo.pnl)} (${pnlInfo.pnlPct.toFixed(1)}%)`);
        this.notifier.send(
          "sell",
          `${icon} <b>VENDA</b> ${esc(p.symbol)} [${p.strategyId}]\n${esc(d.reason)}\nPnL ${fmtSol(pnlInfo.pnl)} (${pnlInfo.pnlPct.toFixed(1)}%)\nDia: ${fmtSol(this.store.state.daily.realizedPnlSol)}`,
        );
      } else {
        this.notifier.send("sell", `🟡 <b>PARCIAL</b> ${esc(p.symbol)}: ${esc(d.reason)} · +${fmtSol(res.receivedSol)}`);
      }
      this.cachedBalance = undefined;
      this.store.save(true);
    } catch (e) {
      this.log.error(`Erro ao vender ${p.symbol}: ${errMsg(e)}`);
    } finally {
      this.inflight.delete(p.tokenAddress);
    }
  }

  /** Vende todas as posições abertas (pânico / desligamento). */
  async sellAll(reason = "venda manual") {
    const open = this.store.openPositions;
    this.log.warn(`Vendendo ${open.length} posições: ${reason}`);
    for (const p of open) {
      p.nextSellAttemptAt = undefined;
      const s = this.tokens.get(p.tokenAddress);
      const price = s?.priceUsd ?? p.lastPriceUsd;
      for (let attempt = 0; attempt < 3 && p.status === "open"; attempt++) {
        p.nextSellAttemptAt = undefined;
        await this.sellPosition(p, { sellRaw: BigInt(p.tokensRemainingRaw), full: true, reason, tpIndexes: [] }, price, s?.liquidityUsd, this.now());
      }
    }
  }

  // ------------------------------------------------------------------ manutenção

  private async maintenance(now: number) {
    const prev = { ...this.store.state.daily };
    if (this.store.rollDay()) {
      this.notifier.send(
        "daily",
        `📊 Resumo ${prev.date}: ${fmtSol(prev.realizedPnlSol)} · ${prev.trades} trades (${prev.wins}✅/${prev.losses}❌)`,
      );
    }
    for (const [t, until] of this.skipUntil) if (until < now) this.skipUntil.delete(t);

    if (this.executor.mode === "live" && now - this.lastReconcile >= this.cfg.positions.reconcileIntervalMs) {
      this.lastReconcile = now;
      await this.reconcile(now);
    }
    if (this.cfg.positions.safetyRecheckIntervalMs > 0) await this.recheckSafety(now);
  }

  /** Confere o saldo real da carteira: detecta vendas externas e recupera compras incertas. */
  private async reconcile(now: number) {
    for (const p of this.store.openPositions) {
      if (this.inflight.has(p.tokenAddress)) continue;
      const bal = await this.executor.getTokenBalanceRaw(p.tokenAddress, p.tokenDecimals);
      if (bal === undefined) continue;
      const remaining = BigInt(p.tokensRemainingRaw);
      if (bal === 0n) {
        const sol = this.cachedSolPrice ?? (await this.market.solPriceUsd());
        const est = (fromRaw(remaining, p.tokenDecimals) * p.lastPriceUsd) / sol;
        p.realizedSol += est;
        p.tokensRemainingRaw = "0";
        p.status = "closed";
        p.closedAt = now;
        p.exitReasons.push("saída externa (valor estimado)");
        const r = this.risk.onClose(p, now);
        this.log.warn(`${p.symbol}: saldo zerado fora do robô — posição encerrada (PnL estimado ${fmtSol(r.pnl)})`);
        this.notifier.send("risk", `ℹ️ ${esc(p.symbol)} saiu da carteira fora do robô; posição encerrada.`);
      } else if (remaining > 0n && (bal * 100n < remaining * 98n || bal * 100n > remaining * 102n)) {
        this.log.info(`${p.symbol}: ajustando quantidade ${remaining} -> ${bal} (saldo real)`);
        p.tokensRemainingRaw = bal.toString();
      }
      this.store.markDirty();
    }

    // Compras com estado incerto (timeout/rede): se o token chegou na carteira, vira posição.
    for (const pb of [...this.store.state.pendingBuys]) {
      if (this.inflight.has(pb.token) || now - pb.startedAt < this.cfg.execution.orderTimeoutMs) continue;
      const bal = await this.executor.getTokenBalanceRaw(pb.token, 6);
      if (bal === undefined) continue;
      this.removePending(pb.token);
      if (bal > 0n) {
        const fresh = (await this.market.refresh([pb.token], now)).get(pb.token);
        const price = fresh?.priceUsd ?? 0;
        if (!price) continue;
        const strat = this.cfg.strategies[pb.strategyId as keyof Config["strategies"]];
        this.store.state.positions.push({
          id: `${now.toString(36)}-rec`,
          mode: this.cfg.mode,
          tokenAddress: pb.token,
          symbol: pb.symbol,
          strategyId: pb.strategyId as Position["strategyId"],
          openedAt: pb.startedAt,
          status: "open",
          entryPriceUsd: price,
          entrySol: strat.buySol,
          tokenDecimals: 6,
          tokensInitialRaw: bal.toString(),
          tokensRemainingRaw: bal.toString(),
          highestPriceUsd: price,
          lowestPriceUsd: price,
          lastPriceUsd: price,
          lastPriceAt: now,
          tpHits: [],
          breakEvenArmed: false,
          realizedSol: 0,
          exitReasons: [],
          sellFailures: 0,
          buyOrderId: pb.orderId,
          sellTxs: [],
          entryScore: 0,
          entryReasons: ["recuperada após compra incerta"],
        });
        this.log.warn(`Compra incerta de ${pb.symbol} confirmada pelo saldo — posição recuperada`);
      }
      this.store.markDirty();
    }
  }

  /** Revalida segurança das posições abertas (ex.: dev despejou, rug_ratio disparou). */
  private async recheckSafety(now: number) {
    for (const p of this.store.openPositions) {
      const last = this.lastSafetyCheck.get(p.id) ?? p.openedAt;
      if (now - last < this.cfg.positions.safetyRecheckIntervalMs) continue;
      this.lastSafetyCheck.set(p.id, now);
      const exitCfg = this.cfg.strategies[p.strategyId].exit;
      if (!exitCfg.exitOnSafetyFail) continue;
      const sec = await this.market.security(p.tokenAddress);
      if (!sec) continue;
      const snap = this.tokens.get(p.tokenAddress);
      const merged = snap ? mergeSnapshots(snap, sec) : undefined;
      if (!merged) continue;
      // Só critérios de "rug" — liquidez/holders oscilam naturalmente.
      const strict = { ...mergeSafety(this.globalSafety(), this.cfg.strategies[p.strategyId].safety), minLiquidityUsd: 0, minHolders: 0, strictMissing: false };
      const res = checkSafety(merged, strict);
      if (!res.ok) {
        this.log.warn(`⚠️ ${p.symbol}: segurança piorou (${res.failures.join("; ")}) — saindo`);
        await this.sellPosition(
          p,
          { sellRaw: BigInt(p.tokensRemainingRaw), full: true, reason: `segurança: ${res.failures[0]}`, tpIndexes: [] },
          merged.priceUsd ?? p.lastPriceUsd,
          merged.liquidityUsd,
          now,
        );
      }
    }
  }

  // ------------------------------------------------------------------ utilidades

  private async balance(): Promise<number | undefined> {
    const now = Date.now();
    if (this.cachedBalance === undefined || now - this.cachedBalanceAt > 30_000) {
      this.cachedBalance = await this.executor.getSolBalance();
      this.cachedBalanceAt = now;
    }
    return this.cachedBalance;
  }

  private trade(t: TradeRecord) {
    this.store.appendTrade(t);
    this.recentTrades.push(t);
    if (this.recentTrades.length > 30) this.recentTrades.shift();
  }

  pause(v: boolean) {
    this.store.state.manualPause = v;
    this.store.save(true);
    this.log.warn(v ? "Compras pausadas manualmente" : "Compras retomadas");
  }

  async status(): Promise<EngineStatus> {
    const now = this.now();
    const sol = await this.market.solPriceUsd().catch(() => undefined);
    this.cachedSolPrice = sol;
    const positions = this.store.openPositions.map((p) => {
      const tokens = fromRaw(p.tokensRemainingRaw, p.tokenDecimals);
      const valueSol = sol ? (tokens * p.lastPriceUsd) / sol : 0;
      const pnlPct = ((p.lastPriceUsd - p.entryPriceUsd) / p.entryPriceUsd) * 100;
      return { ...p, pnlPct, valueSol, unrealizedSol: valueSol + p.realizedSol - p.entrySol };
    });
    return {
      mode: this.cfg.mode,
      startedAt: this.startedAt,
      now,
      blockReason: this.risk.blockReason(now),
      balanceSol: await this.balance(),
      solPriceUsd: sol,
      tokensTracked: this.tokens.size,
      lastScanAt: this.lastScanAt,
      lastScanCount: this.lastScanCount,
      signalsLastScan: this.signalsLastScan,
      rateLimiterQueue: this.rateLimiterQueue?.(),
      positions,
      daily: this.store.state.daily,
      totals: this.store.state.totals,
      recentTrades: this.recentTrades.slice().reverse(),
    };
  }
}

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
}
