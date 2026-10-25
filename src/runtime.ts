import { join } from "node:path";
import type { Secrets } from "./config/load.js";
import type { Config } from "./config/schema.js";
import { createLogger, type Logger } from "./core/logger.js";
import { Recorder } from "./core/recorder.js";
import { StateStore } from "./core/store.js";
import { LiveExecutor } from "./execution/liveExecutor.js";
import { GmgnMarketData } from "./execution/marketData.js";
import { PaperExecutor } from "./execution/paperExecutor.js";
import type { Executor } from "./execution/types.js";
import { GmgnClient } from "./gmgn/client.js";
import { nullNotifier, TelegramNotifier, type Notifier } from "./notify/notifier.js";
import { GmgnScanner } from "./scanner/scanner.js";

export interface Runtime {
  cfg: Config;
  log: Logger;
  client: GmgnClient;
  store: StateStore;
  executor: Executor;
  market: GmgnMarketData;
  scanner: GmgnScanner;
  notifier: Notifier;
  recorder?: Recorder;
}

export function makeLogger(cfg: Config): Logger {
  return createLogger({ level: cfg.log.level, dir: cfg.log.toFile ? join(cfg.storage.dir, "logs") : undefined });
}

export function makeClient(cfg: Config, secrets: Secrets, log: Logger): GmgnClient {
  if (!secrets.apiKey) throw new Error("GMGN_API_KEY não definida (.env). Crie uma em https://gmgn.ai/ai");
  return new GmgnClient({
    host: cfg.gmgn.host,
    apiKey: secrets.apiKey,
    privateKeyPem: secrets.privateKeyPem,
    plan: cfg.gmgn.plan,
    rateOverride: cfg.gmgn.rateOverride,
    capacityOverride: cfg.gmgn.capacityOverride,
    rateSafetyFactor: cfg.gmgn.rateSafetyFactor,
    timeoutMs: cfg.gmgn.requestTimeoutMs,
    maxRetries: cfg.gmgn.maxRetries,
    logger: log,
  });
}

/** Valida pré-requisitos do modo live — falha cedo e com mensagem clara. */
export function assertLiveReady(cfg: Config, secrets: Secrets) {
  const missing: string[] = [];
  if (!secrets.apiKey) missing.push("GMGN_API_KEY");
  if (!secrets.privateKeyPem) missing.push("GMGN_PRIVATE_KEY (ou GMGN_PRIVATE_KEY_FILE)");
  if (!secrets.walletAddress) missing.push("GMGN_WALLET_ADDRESS");
  if (missing.length) throw new Error(`Modo live exige: ${missing.join(", ")}`);
  if (!cfg.live.acknowledgeRisk) {
    throw new Error(
      "Modo live bloqueado: defina `live.acknowledgeRisk: true` no config.yaml confirmando que entende que pode PERDER TODO o capital.",
    );
  }
}

export function buildRuntime(cfg: Config, secrets: Secrets, log = makeLogger(cfg)): Runtime {
  if (cfg.mode === "live") assertLiveReady(cfg, secrets);
  const client = makeClient(cfg, secrets, log);
  const store = new StateStore(cfg.storage.dir, cfg.mode, cfg.paper.startingBalanceSol);
  const market = new GmgnMarketData(client, cfg.chain, cfg.paper.solPriceUsdFallback, log);
  const executor: Executor =
    cfg.mode === "live"
      ? new LiveExecutor(cfg, client, secrets.walletAddress!, market, log)
      : new PaperExecutor(cfg, store, market);
  const tg = cfg.notifications.telegram;
  let notifier: Notifier = nullNotifier;
  if (tg.enabled) {
    if (secrets.telegramBotToken && secrets.telegramChatId) {
      notifier = new TelegramNotifier(
        secrets.telegramBotToken,
        secrets.telegramChatId,
        new Set(tg.events),
        log,
        cfg.mode === "paper" ? "[PAPER] " : "",
      );
    } else log.warn("Telegram habilitado mas TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID não definidos");
  }
  return {
    cfg,
    log,
    client,
    store,
    executor,
    market,
    scanner: new GmgnScanner(client, cfg, log.child("scanner")),
    notifier,
    recorder: cfg.recorder.enabled ? new Recorder(cfg.storage.dir, cfg.recorder) : undefined,
  };
}
