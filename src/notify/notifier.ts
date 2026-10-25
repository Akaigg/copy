import type { Logger } from "../core/logger.js";
import { errMsg, sleep } from "../core/utils.js";

export type NotifyEvent = "buy" | "sell" | "error" | "risk" | "daily" | "info";

export interface Notifier {
  send(event: NotifyEvent, text: string): void;
  flush(): Promise<void>;
}

export const nullNotifier: Notifier = { send() {}, async flush() {} };

/**
 * Telegram com fila própria: nunca bloqueia o robô, respeita o limite do Telegram
 * (~1 msg/s por chat) e descarta mensagens se a fila crescer demais.
 */
export class TelegramNotifier implements Notifier {
  private queue: string[] = [];
  private running = false;

  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly events: Set<string>,
    private readonly log: Logger,
    private readonly prefix = "",
  ) {}

  send(event: NotifyEvent, text: string) {
    if (!this.events.has(event)) return;
    if (this.queue.length > 50) this.queue.shift();
    this.queue.push(`${this.prefix}${text}`);
    void this.pump();
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const text = this.queue.shift()!;
        try {
          const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: this.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
            signal: AbortSignal.timeout(10_000),
          });
          if (res.status === 429) {
            const body = (await res.json().catch(() => ({}))) as { parameters?: { retry_after?: number } };
            this.queue.unshift(text);
            await sleep((body.parameters?.retry_after ?? 5) * 1000);
            continue;
          }
          if (!res.ok) this.log.warn(`Telegram HTTP ${res.status}`);
        } catch (e) {
          this.log.warn(`Telegram falhou: ${errMsg(e)}`);
        }
        await sleep(1100);
      }
    } finally {
      this.running = false;
    }
  }

  async flush() {
    for (let i = 0; i < 20 && (this.queue.length || this.running); i++) await sleep(500);
  }
}
