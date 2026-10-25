import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { localDate } from "./logger.js";
import type { TokenSnapshot } from "./types.js";

/**
 * Grava o que o robô "vê" (snapshots do scanner e preços das posições) em JSONL,
 * um arquivo por dia. Esses arquivos alimentam o comando `replay` para testar e
 * ajustar estratégias com dados reais, sem arriscar dinheiro.
 *
 * Para os arquivos não explodirem: scans são gravados no máximo a cada
 * `minScanIntervalMs`, tokens sem mudança desde a última gravação são omitidos
 * e há um teto de MB por dia.
 */
export type RecordLine =
  | { t: number; kind: "scan"; snaps: TokenSnapshot[] }
  | { t: number; kind: "tick"; snaps: TokenSnapshot[] };

export interface RecorderOptions {
  minScanIntervalMs: number;
  maxMbPerDay: number;
}

export class Recorder {
  private readonly dir: string;
  private lastScanAt = 0;
  private lastSig = new Map<string, string>();
  private day = "";
  private bytes = 0;
  private full = false;

  constructor(
    baseDir: string,
    private readonly opts: RecorderOptions = { minScanIntervalMs: 0, maxMbPerDay: Infinity },
  ) {
    this.dir = join(baseDir, "recordings");
    mkdirSync(this.dir, { recursive: true });
  }

  write(line: RecordLine) {
    if (line.kind === "scan") {
      if (line.t - this.lastScanAt < this.opts.minScanIntervalMs) return;
      this.lastScanAt = line.t;
      const changed = line.snaps.filter((s) => {
        const sig = `${s.priceUsd}|${s.holderCount}|${s.marketCapUsd}|${s.smartDegenCount}|${s.sources.join(",")}`;
        if (this.lastSig.get(s.address) === sig) return false;
        this.lastSig.set(s.address, sig);
        return true;
      });
      if (this.lastSig.size > 20_000) this.lastSig.clear();
      line = { ...line, snaps: changed };
    }
    if (!line.snaps.length) return;

    const day = localDate(new Date(line.t));
    const file = join(this.dir, `${day}.jsonl`);
    if (day !== this.day) {
      this.day = day;
      this.bytes = existsSync(file) ? statSync(file).size : 0;
      this.full = false;
    }
    if (this.full) return;
    const data = JSON.stringify(line) + "\n";
    if (this.bytes + data.length > this.opts.maxMbPerDay * 1024 * 1024) {
      this.full = true;
      return;
    }
    try {
      appendFileSync(file, data);
      this.bytes += data.length;
    } catch {
      // gravação é best-effort
    }
  }
}
