import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localDate } from "./logger.js";
import type { Position, TradeRecord } from "./types.js";

export interface DailyStats {
  date: string;
  realizedPnlSol: number;
  trades: number;
  wins: number;
  losses: number;
  buys: number;
}

export interface PendingBuy {
  token: string;
  symbol: string;
  strategyId: string;
  startedAt: number;
  orderId?: string;
}

export interface BotState {
  version: 1;
  mode: "paper" | "live";
  paperBalanceSol: number;
  positions: Position[];
  /** token -> timestamp até quando não pode recomprar */
  tokenCooldowns: Record<string, number>;
  blacklistTokens: string[];
  blacklistCreators: string[];
  daily: DailyStats;
  consecutiveLosses: number;
  pausedUntil: number;
  manualPause: boolean;
  recentBuys: number[];
  pendingBuys: PendingBuy[];
  totals: { realizedPnlSol: number; wins: number; losses: number; trades: number };
  /** Patrimônio = saldo + valor das posições abertas (atualizado pelo motor). */
  equity: EquityState;
}

export interface EquityState {
  lastSol: number;
  lastUsd: number;
  peakSol: number;
  dayStartSol: number;
  dayDate: string;
  updatedAt: number;
  goalReachedAt?: number;
  /** Meta/piso vigentes quando foram atingidos (mudar o config reabre as compras). */
  goalTargetUsd?: number;
  floorHitAt?: number;
  floorUsd?: number;
}

function emptyDaily(now = Date.now()): DailyStats {
  return { date: localDate(new Date(now)), realizedPnlSol: 0, trades: 0, wins: 0, losses: 0, buys: 0 };
}

/**
 * Persistência em disco: estado (JSON com escrita atômica) + diário de trades (JSONL).
 * Cada modo (paper/live) tem seu próprio diretório, para nunca misturar resultados.
 */
export class StateStore {
  readonly dir: string;
  readonly state: BotState;
  private readonly statePath: string;
  private readonly tradesPath: string;
  private readonly lockPath: string;
  private dirty = false;

  constructor(
    baseDir: string,
    mode: "paper" | "live",
    paperStartingBalance: number,
    /** Relógio injetável (o replay usa tempo simulado). */
    private readonly clock: () => number = Date.now,
  ) {
    this.dir = join(baseDir, mode);
    mkdirSync(this.dir, { recursive: true });
    this.statePath = join(this.dir, "state.json");
    this.tradesPath = join(this.dir, "trades.jsonl");
    this.lockPath = join(this.dir, "bot.lock");
    this.state = this.load(mode, paperStartingBalance);
  }

  private load(mode: "paper" | "live", startBal: number): BotState {
    const fresh: BotState = {
      version: 1,
      mode,
      paperBalanceSol: startBal,
      positions: [],
      tokenCooldowns: {},
      blacklistTokens: [],
      blacklistCreators: [],
      daily: emptyDaily(this.clock()),
      consecutiveLosses: 0,
      pausedUntil: 0,
      manualPause: false,
      recentBuys: [],
      pendingBuys: [],
      totals: { realizedPnlSol: 0, wins: 0, losses: 0, trades: 0 },
      equity: { lastSol: 0, lastUsd: 0, peakSol: 0, dayStartSol: 0, dayDate: "", updatedAt: 0 },
    };
    for (const p of [this.statePath, this.statePath + ".bak"]) {
      if (!existsSync(p)) continue;
      try {
        const loaded = JSON.parse(readFileSync(p, "utf8")) as Partial<BotState>;
        return {
          ...fresh,
          ...loaded,
          mode,
          totals: { ...fresh.totals, ...(loaded.totals ?? {}) },
          equity: { ...fresh.equity, ...(loaded.equity ?? {}) },
        };
      } catch {
        // arquivo corrompido: tenta o backup
      }
    }
    return fresh;
  }

  get openPositions(): Position[] {
    return this.state.positions.filter((p) => p.status === "open");
  }

  /** Zera estatísticas diárias na virada do dia. */
  rollDay() {
    const today = localDate(new Date(this.clock()));
    if (this.state.daily.date !== today) {
      this.state.daily = emptyDaily(this.clock());
      this.markDirty();
      return true;
    }
    return false;
  }

  markDirty() {
    this.dirty = true;
  }

  /** Escrita atômica: grava em .tmp, mantém .bak e renomeia. */
  save(force = false) {
    if (!this.dirty && !force) return;
    // Posições fechadas ficam no diário de trades; o estado só guarda as recentes.
    const closed = this.state.positions.filter((p) => p.status === "closed");
    if (closed.length > 200) {
      const keep = new Set(closed.slice(-200).map((p) => p.id));
      this.state.positions = this.state.positions.filter((p) => p.status === "open" || keep.has(p.id));
    }
    const now = this.clock();
    for (const [t, until] of Object.entries(this.state.tokenCooldowns)) if (until < now) delete this.state.tokenCooldowns[t];
    this.state.recentBuys = this.state.recentBuys.filter((t) => now - t < 3_600_000);

    const tmp = this.statePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    if (existsSync(this.statePath)) {
      try {
        writeFileSync(this.statePath + ".bak", readFileSync(this.statePath));
      } catch {
        /* ignore */
      }
    }
    renameSync(tmp, this.statePath);
    this.dirty = false;
  }

  appendTrade(t: TradeRecord) {
    appendFileSync(this.tradesPath, JSON.stringify(t) + "\n");
  }

  readTrades(): TradeRecord[] {
    if (!existsSync(this.tradesPath)) return [];
    return readFileSync(this.tradesPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as TradeRecord];
        } catch {
          return [];
        }
      });
  }

  /** Impede duas instâncias operando o mesmo estado (ordens duplicadas!). */
  acquireLock(): void {
    if (existsSync(this.lockPath)) {
      const pid = Number(readFileSync(this.lockPath, "utf8"));
      if (pid && isAlive(pid) && pid !== process.pid) {
        throw new Error(`Outra instância do robô já está rodando (pid ${pid}). Se não estiver, apague ${this.lockPath}`);
      }
    }
    writeFileSync(this.lockPath, String(process.pid));
  }

  releaseLock() {
    try {
      if (existsSync(this.lockPath) && Number(readFileSync(this.lockPath, "utf8")) === process.pid) unlinkSync(this.lockPath);
    } catch {
      /* ignore */
    }
  }

  isLocked(): number | null {
    if (!existsSync(this.lockPath)) return null;
    const pid = Number(readFileSync(this.lockPath, "utf8"));
    return pid && isAlive(pid) && pid !== process.pid ? pid : null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
