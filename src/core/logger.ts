import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  /** Diretório para arquivos de log diários (um arquivo por dia). Vazio = só console. */
  dir?: string;
  color?: boolean;
}

/** Logger simples, sem dependências: console colorido + arquivo JSONL diário. */
export function createLogger(opts: LoggerOptions, scope = "bot"): Logger {
  const min = LEVELS[opts.level];
  const color = opts.color ?? process.stdout.isTTY;
  if (opts.dir) mkdirSync(opts.dir, { recursive: true });

  const write = (level: LogLevel, msg: string, meta?: Record<string, unknown>) => {
    if (LEVELS[level] < min) return;
    const ts = new Date();
    const metaStr = meta && Object.keys(meta).length ? " " + safeJson(meta) : "";
    const line = `${ts.toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${metaStr}`;
    const out = color ? `${COLORS[level]}${line}${RESET}` : line;
    if (level === "error" || level === "warn") console.error(out);
    else console.log(out);
    if (opts.dir) {
      const file = join(opts.dir, `bot-${localDate(ts)}.log`);
      try {
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, JSON.stringify({ ts: ts.toISOString(), level, scope, msg, ...meta }) + "\n");
      } catch {
        // Falha ao gravar log nunca deve derrubar o robô.
      }
    }
  };

  return {
    debug: (m, meta) => write("debug", m, meta),
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
    child: (s) => createLogger(opts, `${scope}:${s}`),
  };
}

export function localDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
  } catch {
    return String(v);
  }
}

/** Logger silencioso (testes / replay). */
export const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return nullLogger;
  },
};
