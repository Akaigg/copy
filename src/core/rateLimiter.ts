/**
 * Leaky/token bucket com prioridades, espelhando o limitador da OpenAPI da GMGN
 * (cada rota tem um "peso"; o plano define taxa e capacidade).
 *
 * Prioridade maior é atendida primeiro: vendas > compras > monitoramento > scanner.
 * Quando o servidor devolve 429, `pauseUntil` congela TODAS as requisições —
 * a GMGN estende o banimento se continuarmos chamando durante o bloqueio.
 */
export enum Priority {
  Scan = 0,
  Monitor = 1,
  Buy = 2,
  Sell = 3,
}

interface Waiter {
  weight: number;
  priority: Priority;
  seq: number;
  resolve: () => void;
}

export class RateLimiter {
  private tokens: number;
  private last = Date.now();
  private queue: Waiter[] = [];
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;
  private pausedUntil = 0;

  constructor(
    private readonly ratePerSec: number,
    private readonly capacity: number,
  ) {
    this.tokens = capacity;
  }

  /** Aguarda permissão para gastar `weight`. */
  acquire(weight: number, priority: Priority = Priority.Scan): Promise<void> {
    // Peso maior que a capacidade nunca caberia no balde: limita para não travar
    // (o servidor responderá PLAN_UPGRADE_REQUIRED se o plano não suportar).
    const w = Math.min(weight, this.capacity);
    return new Promise((resolve) => {
      this.queue.push({ weight: w, priority, seq: this.seq++, resolve });
      this.queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
      this.drain();
    });
  }

  /** Congela o limitador até `untilMs` (ex.: após 429). */
  pauseUntil(untilMs: number) {
    this.pausedUntil = Math.max(this.pausedUntil, untilMs);
    this.tokens = 0;
    this.schedule();
  }

  get queued(): number {
    return this.queue.length;
  }

  get pausedFor(): number {
    return Math.max(0, this.pausedUntil - Date.now());
  }

  private refill() {
    const now = Date.now();
    if (now < this.pausedUntil) {
      this.last = now;
      return;
    }
    const elapsed = (now - Math.max(this.last, this.pausedUntil)) / 1000;
    this.last = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.ratePerSec);
  }

  private drain() {
    this.refill();
    while (this.queue.length) {
      const head = this.queue[0]!;
      if (Date.now() < this.pausedUntil || this.tokens < head.weight) break;
      this.tokens -= head.weight;
      this.queue.shift();
      head.resolve();
    }
    this.schedule();
  }

  private schedule() {
    if (this.timer || !this.queue.length) return;
    const head = this.queue[0]!;
    const pauseWait = Math.max(0, this.pausedUntil - Date.now());
    const deficit = Math.max(0, head.weight - this.tokens);
    const wait = Math.max(pauseWait, (deficit / this.ratePerSec) * 1000, 5);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, wait);
  }
}
