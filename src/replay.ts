import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config/schema.js";
import { nullLogger, type Logger } from "./core/logger.js";
import type { RecordLine } from "./core/recorder.js";
import { StateStore } from "./core/store.js";
import type { TokenSnapshot } from "./core/types.js";
import { Engine } from "./engine.js";
import type { MarketData } from "./execution/marketData.js";
import { PaperExecutor } from "./execution/paperExecutor.js";
import { nullNotifier } from "./notify/notifier.js";
import type { Scanner } from "./scanner/scanner.js";

/**
 * Backtest/replay: reexecuta as estratégias sobre dados gravados pelo `Recorder`
 * (data/recordings/*.jsonl), com execução simulada (paper). Ideal para ajustar
 * parâmetros sem gastar SOL nem rate-limit.
 *
 * Limitação: o preço de um token só é conhecido enquanto ele aparecia no scanner
 * ou era uma posição na gravação; fora disso, o último preço conhecido é usado.
 */
export interface ReplaySummary {
  scans: number;
  trades: number;
  wins: number;
  losses: number;
  pnlSol: number;
  finalBalanceSol: number;
  byStrategy: Record<string, { trades: number; wins: number; pnlSol: number }>;
  stateDir: string;
}

export function loadRecording(path: string): RecordLine[] {
  const files = statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .map((f) => join(path, f))
    : [path];
  const lines: RecordLine[] = [];
  for (const f of files) {
    for (const l of readFileSync(f, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        lines.push(JSON.parse(l) as RecordLine);
      } catch {
        /* linha corrompida */
      }
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

class ReplayFeed implements Scanner, MarketData {
  current: TokenSnapshot[] = [];
  latest = new Map<string, TokenSnapshot>();

  constructor(private readonly solPrice: number) {}

  absorb(snaps: TokenSnapshot[]) {
    for (const s of snaps) this.latest.set(s.address, s);
  }
  async scan(): Promise<TokenSnapshot[]> {
    return this.current;
  }
  async refresh(addresses: string[], now: number) {
    const out = new Map<string, TokenSnapshot>();
    for (const a of addresses) {
      const s = this.latest.get(a);
      if (s?.priceUsd) out.set(a, { ...s, observedAt: now, priceAt: now });
    }
    return out;
  }
  async security() {
    return undefined;
  }
  async solPriceUsd() {
    return this.solPrice;
  }
}

export async function runReplay(cfg: Config, recordingPath: string, log: Logger = nullLogger): Promise<ReplaySummary> {
  if (!existsSync(recordingPath)) throw new Error(`Gravação não encontrada: ${recordingPath}`);
  const lines = loadRecording(recordingPath);
  if (!lines.length) throw new Error("Gravação vazia");

  const replayCfg: Config = { ...cfg, mode: "paper", verifySecurityBeforeBuy: false };
  mkdirSync(cfg.storage.dir, { recursive: true });
  const baseDir = mkdtempSync(join(cfg.storage.dir, "replay-"));
  const clock = { t: lines[0]!.t };
  const store = new StateStore(baseDir, "paper", cfg.paper.startingBalanceSol, () => clock.t);
  const feed = new ReplayFeed(cfg.paper.solPriceUsdFallback);
  let seed = 42;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const executor = new PaperExecutor(replayCfg, store, feed, random);
  const engine = new Engine({ cfg: replayCfg, log, store, executor, market: feed, scanner: feed, notifier: nullNotifier, clock: () => clock.t });

  let scans = 0;
  for (const line of lines) {
    clock.t = line.t;
    feed.absorb(line.snaps);
    if (line.kind === "scan") {
      feed.current = line.snaps;
      await engine.step(line.t);
      scans++;
    }
  }
  // Fecha o que sobrou pelo último preço conhecido.
  await engine.sellAll("fim do replay");
  store.save(true);

  const byStrategy: ReplaySummary["byStrategy"] = {};
  let wins = 0;
  let losses = 0;
  let pnl = 0;
  for (const t of store.readTrades()) {
    if (t.side !== "sell" || t.pnlSol === undefined) continue;
    const b = (byStrategy[t.strategyId] ??= { trades: 0, wins: 0, pnlSol: 0 });
    b.trades++;
    b.pnlSol += t.pnlSol;
    pnl += t.pnlSol;
    if (t.pnlSol >= 0) {
      b.wins++;
      wins++;
    } else losses++;
  }
  return {
    scans,
    trades: wins + losses,
    wins,
    losses,
    pnlSol: pnl,
    finalBalanceSol: store.state.paperBalanceSol,
    byStrategy,
    stateDir: store.dir,
  };
}
