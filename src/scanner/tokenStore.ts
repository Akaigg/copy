import type { TokenContext, TokenSnapshot } from "../core/types.js";
import { mergeSnapshots } from "./normalize.js";

/**
 * Memória de curto prazo dos tokens vistos: último snapshot + histórico (ring buffer).
 * Permite estratégias baseadas em variação (ex.: aumento de smart money, crescimento de holders).
 */
export class TokenStore {
  private latest = new Map<string, TokenSnapshot>();
  private history = new Map<string, TokenSnapshot[]>();

  constructor(
    private readonly historySize: number,
    private readonly forgetAfterMs: number,
  ) {}

  /** Registra o snapshot e devolve o contexto (atual + histórico anterior). */
  upsert(snap: TokenSnapshot): TokenContext {
    const prev = this.latest.get(snap.address);
    // Campos ausentes neste ciclo herdam o último valor conhecido (ex.: segurança vinda de outra rota).
    const merged = prev ? mergeSnapshots({ ...prev, sources: [] }, snap) : snap;
    const hist = this.history.get(snap.address) ?? [];
    const ctx: TokenContext = { snap: merged, history: hist.slice(), now: snap.observedAt };
    hist.push(merged);
    if (hist.length > this.historySize) hist.splice(0, hist.length - this.historySize);
    this.history.set(snap.address, hist);
    this.latest.set(snap.address, merged);
    return ctx;
  }

  /** Aplica dados extras (ex.: preço atualizado, segurança) sem criar entrada no histórico. */
  patch(address: string, data: Partial<TokenSnapshot>) {
    const prev = this.latest.get(address);
    if (prev) this.latest.set(address, mergeSnapshots(prev, data));
  }

  get(address: string): TokenSnapshot | undefined {
    return this.latest.get(address);
  }

  getHistory(address: string): TokenSnapshot[] {
    return this.history.get(address) ?? [];
  }

  prune(now: number, keep: Set<string> = new Set()) {
    for (const [addr, s] of this.latest) {
      if (keep.has(addr)) continue;
      if (now - s.observedAt > this.forgetAfterMs) {
        this.latest.delete(addr);
        this.history.delete(addr);
      }
    }
  }

  get size() {
    return this.latest.size;
  }
}

/** Valor de um campo `lookbackMs` atrás (o snapshot mais antigo dentro da janela). */
export function valueAgo<K extends keyof TokenSnapshot>(
  history: TokenSnapshot[],
  key: K,
  now: number,
  lookbackMs: number,
): { value: TokenSnapshot[K]; at: number } | undefined {
  for (const h of history) {
    if (now - h.observedAt <= lookbackMs && h[key] !== undefined) return { value: h[key], at: h.observedAt };
  }
  return undefined;
}
