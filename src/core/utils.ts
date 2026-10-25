export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const LAMPORTS_PER_SOL = 1_000_000_000;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Converte valores da API (string, número, "", null) em número finito ou undefined. */
export function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Converte 1/0, "1"/"0", "yes"/"no", true/false em boolean ou undefined. */
export function bool(v: unknown): boolean | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).toLowerCase().trim();
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return undefined;
}

export function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

/** Timestamp da API (segundos ou ms) -> ms. */
export function tsMs(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined || n <= 0) return undefined;
  return n < 1e12 ? n * 1000 : n;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function solToLamports(sol: number): bigint {
  return BigInt(Math.floor(sol * LAMPORTS_PER_SOL));
}

export function lamportsToSol(l: bigint | string | number): number {
  return Number(BigInt(l)) / LAMPORTS_PER_SOL;
}

/** Converte quantidade "humana" em unidades mínimas (bigint) sem perder precisão em strings. */
export function toRaw(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const [int = "0", frac = ""] = amount.toFixed(Math.min(decimals, 12)).split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(int) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

export function fromRaw(raw: bigint | string, decimals: number): number {
  return Number(BigInt(raw)) / 10 ** decimals;
}

export function pct(from: number, to: number): number {
  if (!from) return 0;
  return ((to - from) / from) * 100;
}

export function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

export function fmtSol(v: number): string {
  return `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(4)} SOL`;
}

export function fmtUsd(v: number | undefined): string {
  if (v === undefined) return "-";
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Pega um caminho aninhado ("price.price") de um objeto desconhecido. */
export function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Primeiro valor definido entre vários caminhos. */
export function first(obj: unknown, ...paths: string[]): unknown {
  for (const p of paths) {
    const v = pick(obj, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}
