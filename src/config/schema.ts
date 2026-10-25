import { z } from "zod";

/**
 * Esquema completo de configuração.
 * Convenções de unidade:
 *  - campos terminados em `Pct` são porcentagens (25 = 25%)
 *  - campos terminados em `Rate`/`Ratio` são frações 0–1 (como a GMGN devolve)
 *  - `Sol` = SOL, `Usd` = dólares, `Ms` = milissegundos, `Sec` = segundos, `Min` = minutos
 */

const TakeProfit = z.object({
  /** Ganho sobre o preço de entrada que dispara a venda (100 = 2x). */
  atPct: z.number().positive(),
  /** Porcentagem da posição ORIGINAL a vender nesse nível. */
  sellPct: z.number().positive().max(100),
});

export const ExitSchema = z.object({
  /** Stop loss fixo: vende tudo se cair X% abaixo da entrada. */
  stopLossPct: z.number().positive().max(100).default(25),
  /** Escada de take profit (vendas parciais). */
  takeProfits: z.array(TakeProfit).default([
    { atPct: 50, sellPct: 40 },
    { atPct: 120, sellPct: 30 },
  ]),
  trailing: z
    .object({
      enabled: z.boolean().default(true),
      /** Ativa o trailing depois que o lucro atingir X%. */
      activateAtPct: z.number().nonnegative().default(40),
      /** Vende tudo se o preço recuar X% a partir da máxima. */
      drawdownPct: z.number().positive().max(100).default(20),
      /**
       * Trailing escalonado: quanto maior o lucro, mais folga. Retornos de memecoin seguem
       * lei de potência — dar espaço aos raros 10x+ é o que paga as várias perdas pequenas.
       * Ex.: [{atPct: 150, drawdownPct: 30}, {atPct: 400, drawdownPct: 40}]
       */
      tiers: z.array(z.object({ atPct: z.number().nonnegative(), drawdownPct: z.number().positive().max(100) })).default([]),
    })
    .default({}),
  /** Ao atingir X% de lucro, o stop sobe para a entrada + `breakEvenBufferPct`. null = desativado. */
  breakEvenAtPct: z.number().positive().nullable().default(30),
  breakEvenBufferPct: z.number().default(2),
  /** Tempo máximo de permanência na posição (minutos). 0 = sem limite. */
  maxHoldMin: z.number().nonnegative().default(60),
  /** Tempo máximo depois que algum take profit já foi executado (moonbag). 0 = usa maxHoldMin. */
  maxHoldAfterTpMin: z.number().nonnegative().default(0),
  /** Se após X minutos o lucro for menor que `staleMinGainPct`, sai (posição "morta"). 0 = desativado. */
  staleAfterMin: z.number().nonnegative().default(10),
  staleMinGainPct: z.number().default(5),
  /** Vende imediatamente se a segurança do token piorar (ex.: rug_ratio subir). */
  exitOnSafetyFail: z.boolean().default(true),
  /** Abaixo dessa fração restante (% da posição original) vende o resto de uma vez. */
  dustPct: z.number().nonnegative().default(3),
});
export type ExitConfig = z.infer<typeof ExitSchema>;

export const SafetySchema = z.object({
  /** Exige mint authority renunciada (Solana). */
  requireMintRenounced: z.boolean().default(true),
  /** Exige freeze authority renunciada (Solana). */
  requireFreezeRenounced: z.boolean().default(true),
  rejectHoneypot: z.boolean().default(true),
  rejectWashTrading: z.boolean().default(true),
  maxRugRatio: z.number().min(0).max(1).default(0.3),
  maxTop10HolderRate: z.number().min(0).max(1).default(0.35),
  maxBundlerRate: z.number().min(0).max(1).default(0.3),
  maxInsiderRate: z.number().min(0).max(1).default(0.25),
  maxDevHoldRate: z.number().min(0).max(1).default(0.1),
  maxTop70SniperHoldRate: z.number().min(0).max(1).default(0.3),
  maxEntrapmentRatio: z.number().min(0).max(1).default(0.3),
  /** Impostos (0.05 = 5%). */
  maxBuyTax: z.number().min(0).max(1).default(0.05),
  maxSellTax: z.number().min(0).max(1).default(0.05),
  minLiquidityUsd: z.number().nonnegative().default(5000),
  minHolders: z.number().nonnegative().default(10),
  requireSocial: z.boolean().default(false),
  /** Carteiras novas (fresh wallets) entre holders — farm de carteiras. Limite da GMGN: 30%. */
  maxFreshWalletRate: z.number().min(0).max(1).default(0.3),
  /** Fração de carteiras-robô. Limite da GMGN: 60%. */
  maxBotDegenRate: z.number().min(0).max(1).default(0.6),
  /**
   * "Faca caindo": não compra se o preço caiu X% ou mais nos últimos 5 min
   * (regra de execução da própria GMGN). 0 = desliga.
   */
  maxDrop5mPct: z.number().nonnegative().default(10),
  /** Dev "fábrica": rejeita criador com mais de N lançamentos que nunca graduaram. 0 = desliga. */
  maxDevFailedLaunches: z.number().nonnegative().default(50),
  /** Taxa mínima de graduação do dev (0–1), aplicada só se ele tiver 5+ lançamentos. 0 = desliga. */
  minDevGraduationRatio: z.number().min(0).max(1).default(0),
  /** Rejeita (e sai de) tokens com sinal de bundlers vendendo (GMGN signal 10). */
  rejectBundlerSelling: z.boolean().default(true),
  /** Só compra se o dev já tiver saído (creator_close). Muito restritivo para tokens recém-criados. */
  requireCreatorClosed: z.boolean().default(false),
  /**
   * Quando um dado de segurança não vem da API:
   * false = deixa passar (leniente), true = rejeita (estrito).
   */
  strictMissing: z.boolean().default(false),
  blacklistTokens: z.array(z.string()).default([]),
  blacklistCreators: z.array(z.string()).default([]),
});
export type SafetyConfig = z.infer<typeof SafetySchema>;

const BaseStrategy = z.object({
  enabled: z.boolean().default(true),
  /** SOL gasto por compra. */
  buySol: z.number().positive().default(0.05),
  /** Máximo de posições abertas simultâneas desta estratégia. */
  maxOpenPositions: z.number().int().positive().default(3),
  slippagePct: z.number().positive().max(100).default(25),
  /** Taxa de prioridade (SOL). */
  priorityFeeSol: z.number().nonnegative().default(0.0005),
  /** Gorjeta anti-MEV/Jito (SOL). */
  tipFeeSol: z.number().nonnegative().default(0.0005),
  antiMev: z.boolean().default(true),
  /** Pontuação mínima (0–100) para comprar. */
  minScore: z.number().min(0).max(100).default(50),
  /** Multiplicador do tamanho no modo de banca percentual (risk.sizing.mode = equityPct). */
  sizeMultiplier: z.number().positive().default(1),
  /**
   * Slippage dinâmico (fórmula da GMGN): 2% + impostos + impacto×1,5 + |Δ5m|×0,5 (+3% se < 1h),
   * limitado entre `minSlippagePct` e `slippagePct`.
   */
  dynamicSlippage: z.boolean().default(true),
  minSlippagePct: z.number().positive().default(5),
  /**
   * Confirmação pelo gráfico de 1m (padrões da GMGN): score mínimo 0–100. 0 = desligado.
   * Custa 1 requisição extra por candidato aprovado.
   */
  klineMinScore: z.number().min(0).max(100).default(0),
  klineRejectPatterns: z
    .array(z.enum(["breakdown", "slowBleed", "distribution", "wideChop", "bearishConsolidation", "verticalRunUp"]))
    .default(["breakdown", "slowBleed", "distribution"]),
  exit: ExitSchema.default({}),
  /** Sobrescreve filtros de segurança globais só para esta estratégia. */
  safety: SafetySchema.partial().default({}),
});

export const SniperSchema = BaseStrategy.extend({
  minAgeSec: z.number().nonnegative().default(20),
  maxAgeSec: z.number().positive().default(300),
  minHolders: z.number().nonnegative().default(25),
  minSwaps1m: z.number().nonnegative().default(15),
  minBuySellRatio: z.number().nonnegative().default(1.2),
  minMarketCapUsd: z.number().nonnegative().default(6000),
  maxMarketCapUsd: z.number().positive().default(35000),
  minVolume1hUsd: z.number().nonnegative().default(3000),
  /** Crescimento mínimo de holders por minuto (exige histórico). 0 = ignora. */
  minHolderGrowthPerMin: z.number().nonnegative().default(0),
  minSmartDegenCount: z.number().nonnegative().default(0),
});

export const GraduationSchema = BaseStrategy.extend({
  minProgress: z.number().min(0).max(1).default(0.85),
  maxProgress: z.number().min(0).max(1).default(0.985),
  minHolders: z.number().nonnegative().default(80),
  minVolume1hUsd: z.number().nonnegative().default(15000),
  minBuySellRatio: z.number().nonnegative().default(1.1),
  maxAgeMin: z.number().positive().default(180),
  minSmartDegenCount: z.number().nonnegative().default(0),
});

export const MigrationSchema = BaseStrategy.extend({
  maxMinutesSinceOpen: z.number().positive().default(15),
  minLiquidityUsd: z.number().nonnegative().default(15000),
  minHolders: z.number().nonnegative().default(150),
  minVolume1hUsd: z.number().nonnegative().default(20000),
  minMarketCapUsd: z.number().nonnegative().default(30000),
  maxMarketCapUsd: z.number().positive().default(600000),
  minBuySellRatio: z.number().nonnegative().default(1.1),
});

export const MomentumSchema = BaseStrategy.extend({
  /** Intervalo do ranking hot da GMGN usado como fonte. */
  interval: z.enum(["1m", "5m"]).default("1m"),
  minPriceChange1mPct: z.number().default(5),
  maxPriceChange1mPct: z.number().default(45),
  minPriceChange5mPct: z.number().default(0),
  maxPriceChange1hPct: z.number().default(500),
  minVolumeUsd: z.number().nonnegative().default(8000),
  minBuySellRatio: z.number().nonnegative().default(1.3),
  minLiquidityUsd: z.number().nonnegative().default(10000),
  maxAgeHours: z.number().positive().default(24),
  minHolders: z.number().nonnegative().default(100),
});

export const SmartMoneySchema = BaseStrategy.extend({
  minSmartDegenCount: z.number().nonnegative().default(3),
  minRenownedCount: z.number().nonnegative().default(0),
  /** Aumento mínimo de carteiras smart money dentro da janela. */
  minSmartIncrease: z.number().nonnegative().default(1),
  lookbackSec: z.number().positive().default(300),
  /** Na primeira vez que o token é visto (sem histórico), exige pelo menos isso. */
  minSmartOnFirstSeen: z.number().nonnegative().default(5),
  minLiquidityUsd: z.number().nonnegative().default(10000),
  maxMarketCapUsd: z.number().positive().default(1_500_000),
  maxAgeHours: z.number().positive().default(24),
});

export const DipBuySchema = BaseStrategy.extend({
  /** Desligada por padrão: pegar "faca caindo" é a mais arriscada das estratégias. */
  enabled: z.boolean().default(false),
  /** Esta estratégia compra justamente o recuo de 5 min: a regra global da "faca caindo" é afrouxada. */
  safety: SafetySchema.partial().default({ maxDrop5mPct: 40 }),
  minPriceChange1hPct: z.number().default(80),
  minPriceChange5mPct: z.number().default(-35),
  maxPriceChange5mPct: z.number().default(-12),
  minPriceChange1mPct: z.number().default(0),
  minLiquidityUsd: z.number().nonnegative().default(20000),
  minVolumeUsd: z.number().nonnegative().default(20000),
  minBuySellRatio: z.number().nonnegative().default(1.0),
  maxAgeHours: z.number().positive().default(24),
  minHolders: z.number().nonnegative().default(200),
});

export const SmartSignalSchema = BaseStrategy.extend({
  /** Tipos de sinal da GMGN: 12 = smart money comprou, 20 = KOL comprou. */
  signalTypes: z.array(z.number().int()).default([12, 20]),
  /** Total mínimo de disparos desses tipos para o token. */
  minSignalCount: z.number().int().positive().default(2),
  /** O último sinal precisa ser recente. */
  maxSignalAgeSec: z.number().positive().default(300),
  /**
   * Penalidade de imitação: não compra se o market cap já subiu mais que X vezes desde o
   * primeiro sinal (quem copia atrasado paga o topo para o líder).
   */
  maxChaseMultiple: z.number().positive().default(1.6),
  minMarketCapUsd: z.number().nonnegative().default(15000),
  maxMarketCapUsd: z.number().positive().default(3_000_000),
  minLiquidityUsd: z.number().nonnegative().default(15000),
  minHolders: z.number().nonnegative().default(150),
  minBuySellRatio: z.number().nonnegative().default(1.0),
});

export const SurvivorSchema = BaseStrategy.extend({
  /** A maioria dos tokens graduados desaba logo após migrar: só olha quem sobreviveu a isso. */
  minMinutesSinceOpen: z.number().nonnegative().default(30),
  maxMinutesSinceOpen: z.number().positive().default(360),
  /** Precisa ter recuado do topo (não compra no pico)... */
  minAthRetracePct: z.number().nonnegative().default(15),
  /** ...mas não pode estar morto. */
  maxAthRetracePct: z.number().positive().max(100).default(60),
  minHolders: z.number().nonnegative().default(400),
  /** Crescimento de holders na janela de 10 min (exige histórico). 0 = ignora. */
  minHolderGrowthPct: z.number().nonnegative().default(0),
  minLiquidityUsd: z.number().nonnegative().default(30000),
  minVolume1hUsd: z.number().nonnegative().default(30000),
  minMarketCapUsd: z.number().nonnegative().default(80000),
  maxMarketCapUsd: z.number().positive().default(5_000_000),
  minBuySellRatio: z.number().nonnegative().default(1.05),
  /** Repique começando no último minuto. */
  minPriceChange1mPct: z.number().default(0),
  minSmartDegenCount: z.number().nonnegative().default(2),
});

export const ConfigSchema = z.object({
  mode: z.enum(["paper", "live"]).default("paper"),
  chain: z.literal("sol").default("sol"),

  gmgn: z
    .object({
      host: z.string().url().default("https://openapi.gmgn.ai"),
      /** Plano da OpenAPI: define o limite de requisições (free 5/5, plus 20/20, pro 50/50). */
      plan: z.enum(["free", "plus", "pro"]).default("free"),
      /** Sobrescreve taxa/capacidade do balde de rate-limit. */
      rateOverride: z.number().positive().optional(),
      capacityOverride: z.number().positive().optional(),
      /** Use só uma fração do limite para deixar folga (0.8 = 80%). */
      rateSafetyFactor: z.number().min(0.1).max(1).default(0.8),
      requestTimeoutMs: z.number().positive().default(10_000),
      maxRetries: z.number().int().nonnegative().default(2),
    })
    .default({}),

  live: z
    .object({
      /** Precisa ser true para operar com dinheiro real. */
      acknowledgeRisk: z.boolean().default(false),
    })
    .default({}),

  scanner: z
    .object({
      intervalMs: z.number().positive().default(4000),
      trenches: z
        .object({
          enabled: z.boolean().default(true),
          types: z
            .array(z.enum(["new_creation", "near_completion", "completed"]))
            .default(["new_creation", "near_completion", "completed"]),
          /** Plataformas (vazio = padrão da GMGN). Ex.: ["Pump.fun", "letsbonk"] */
          platforms: z.array(z.string()).default([]),
          limit: z.number().int().positive().max(80).default(50),
          /** Filtros server-side extras enviados à GMGN (ex.: max_rug_ratio). */
          serverFilters: z.record(z.union([z.number(), z.string()])).default({ max_rug_ratio: 0.5 }),
        })
        .default({}),
      trending: z
        .object({
          enabled: z.boolean().default(true),
          intervals: z.array(z.enum(["1m", "5m", "1h", "6h", "24h"])).default(["1m", "5m", "1h"]),
          limit: z.number().int().positive().max(100).default(50),
          orderBy: z.string().default("default"),
          /** Tags de filtro da GMGN (padrão SOL: renounced + frozen). */
          filters: z.array(z.string()).default(["renounced", "frozen"]),
          platforms: z.array(z.string()).default([]),
          /** Idade máxima em minutos — foco em moedas recém-lançadas. */
          maxCreatedMin: z.number().positive().default(1440),
          /** Consulta cada intervalo a cada N ciclos do scanner (economiza rate-limit). */
          everyNTicks: z.record(z.number().int().positive()).default({ "1m": 1, "5m": 2, "1h": 4, "6h": 8, "24h": 8 }),
        })
        .default({}),
      signals: z
        .object({
          /** Feed de sinais da GMGN (smart money / KOL / bundlers vendendo). */
          enabled: z.boolean().default(true),
          /** Tipos consultados. 10 (bundler vendendo) é usado como sinal NEGATIVO. */
          types: z.array(z.number().int()).default([12, 20, 10]),
          everyNTicks: z.number().int().positive().default(2),
          /** Busca preço/liquidez (token/info) para no máximo N tokens só-sinal por ciclo. */
          enrichPerTick: z.number().int().nonnegative().default(4),
        })
        .default({}),
      /** Quantos snapshots por token manter em memória para análise de tendência. */
      historySize: z.number().int().positive().default(60),
      /** Esquece tokens não vistos há X minutos. */
      forgetAfterMin: z.number().positive().default(120),
    })
    .default({}),

  safety: SafetySchema.default({}),
  /** Revalida a segurança do token (endpoint /token/security) imediatamente antes de comprar. */
  verifySecurityBeforeBuy: z.boolean().default(true),
  /**
   * Consulta o histórico do dev (/user/created_tokens) antes de comprar: barra devs
   * "fábrica" (top 1% dos criadores lança ~58% das moedas do pump.fun). 1 requisição por compra.
   */
  verifyDevBeforeBuy: z.boolean().default(false),

  risk: z
    .object({
      maxOpenPositions: z.number().int().positive().default(6),
      maxTotalExposureSol: z.number().positive().default(0.5),
      /** Exposição máxima como % do patrimônio (0 = só o limite em SOL). */
      maxTotalExposurePctOfEquity: z.number().nonnegative().max(100).default(0),
      /** Nunca usar mais que X% do saldo numa única compra. */
      maxPositionPctOfBalance: z.number().positive().max(100).default(10),
      /** Reserva de SOL para taxas que nunca é usada para comprar. */
      minSolReserve: z.number().nonnegative().default(0.05),
      /** Para de comprar no dia se a perda realizada atingir X SOL. */
      dailyLossLimitSol: z.number().positive().default(0.3),
      /** Limite de perda diária como % do patrimônio no início do dia (0 = só o limite em SOL). */
      dailyLossLimitPctOfEquity: z.number().nonnegative().max(100).default(0),
      /** Para de comprar no dia se atingir esse lucro (0 = sem meta). */
      dailyProfitTargetSol: z.number().nonnegative().default(0),
      maxConsecutiveLosses: z.number().int().positive().default(4),
      pauseAfterLossesMin: z.number().nonnegative().default(30),
      /** Não recomprar o mesmo token por X minutos após sair. */
      tokenCooldownMin: z.number().nonnegative().default(240),
      maxBuysPerHour: z.number().int().positive().default(12),
      /** Bloqueia o criador (dev) se o token dele der perda maior que X%. 0 = desativado. */
      blacklistCreatorOnLossPct: z.number().nonnegative().default(50),
      /**
       * Taxas fixas de ida e volta (priority + tip) não podem passar de X% do valor da compra.
       * Em contas pequenas as taxas são o maior inimigo. 0 = desliga.
       */
      maxFeePctOfTrade: z.number().nonnegative().default(4),
      sizing: z
        .object({
          /**
           * fixed     = usa `buySol` de cada estratégia
           * equityPct = % do patrimônio atual × `sizeMultiplier` da estratégia (juros compostos)
           */
          mode: z.enum(["fixed", "equityPct"]).default("fixed"),
          equityPct: z.number().positive().max(100).default(6),
          minSol: z.number().nonnegative().default(0.02),
          maxSol: z.number().positive().default(2),
          /** Se o patrimônio cair X% do pico, multiplica o tamanho por `throttleFactor`. 0 = desliga. */
          throttleDrawdownPct: z.number().nonnegative().max(100).default(25),
          throttleFactor: z.number().positive().max(1).default(0.5),
        })
        .default({}),
      goal: z
        .object({
          /** Meta de patrimônio em USD (0 = sem meta). Ao atingir, para de comprar e avisa. */
          targetUsd: z.number().nonnegative().default(0),
          /** Piso: se o patrimônio cair abaixo disso (USD), para de comprar. 0 = desliga. */
          floorUsd: z.number().nonnegative().default(0),
        })
        .default({}),
    })
    .default({}),

  positions: z
    .object({
      monitorIntervalMs: z.number().positive().default(2500),
      /** Preço do scanner é aceito se tiver menos de X ms; senão busca preço novo. */
      priceMaxAgeMs: z.number().positive().default(4000),
      /** Reconciliação de saldo on-chain (modo live). */
      reconcileIntervalMs: z.number().positive().default(60_000),
      /** Revalida a segurança das posições abertas a cada X ms (0 = desliga). */
      safetyRecheckIntervalMs: z.number().nonnegative().default(60_000),
    })
    .default({}),

  execution: z
    .object({
      orderPollIntervalMs: z.number().positive().default(1500),
      orderTimeoutMs: z.number().positive().default(60_000),
      /** Slippages usados em tentativas sucessivas de venda (escalonamento). */
      sellSlippageStepsPct: z.array(z.number().positive().max(100)).default([25, 40, 60]),
      /** Após falhar todas as tentativas, espera X ms antes de tentar vender de novo. */
      sellRetryCooldownMs: z.number().positive().default(10_000),
    })
    .default({}),

  paper: z
    .object({
      startingBalanceSol: z.number().positive().default(2),
      /** Taxa simulada da plataforma por trade (1 = 1%). */
      feePct: z.number().nonnegative().default(1),
      /** Slippage extra simulado além do impacto de preço calculado. */
      extraSlippagePct: z.number().nonnegative().default(1.5),
      /** Probabilidade (0–1) de uma ordem simulada falhar, para testar robustez. */
      failureRate: z.number().min(0).max(1).default(0.02),
      /** Preço de SOL usado se a API falhar. */
      solPriceUsdFallback: z.number().positive().default(150),
    })
    .default({}),

  notifications: z
    .object({
      telegram: z
        .object({
          enabled: z.boolean().default(false),
          /** Eventos enviados: buy, sell, error, risk, daily, info. */
          events: z.array(z.enum(["buy", "sell", "error", "risk", "daily", "info"])).default(["buy", "sell", "error", "risk", "daily", "info"]),
        })
        .default({}),
    })
    .default({}),

  dashboard: z
    .object({
      enabled: z.boolean().default(true),
      host: z.string().default("127.0.0.1"),
      port: z.number().int().positive().default(8787),
      /** Token exigido para ações (pausar, vender tudo). Vazio = ações desativadas. */
      authToken: z.string().default(""),
    })
    .default({}),

  recorder: z
    .object({
      /** Grava os snapshots em data/recordings para replay/backtest. */
      enabled: z.boolean().default(true),
      /** Intervalo mínimo entre gravações de scan (controla o tamanho dos arquivos). */
      minScanIntervalMs: z.number().nonnegative().default(10_000),
      /** Para de gravar no dia ao atingir esse tamanho. */
      maxMbPerDay: z.number().positive().default(500),
    })
    .default({}),

  storage: z.object({ dir: z.string().default("./data") }).default({}),
  log: z
    .object({
      level: z.enum(["debug", "info", "warn", "error"]).default("info"),
      toFile: z.boolean().default(true),
    })
    .default({}),

  /** Se true, ao desligar (Ctrl+C) vende todas as posições abertas. */
  sellAllOnShutdown: z.boolean().default(false),

  strategies: z
    .object({
      sniper: SniperSchema.default({}),
      graduation: GraduationSchema.default({}),
      migration: MigrationSchema.default({}),
      momentum: MomentumSchema.default({}),
      smartMoney: SmartMoneySchema.default({}),
      dipBuy: DipBuySchema.default({}),
      smartSignal: SmartSignalSchema.default({}),
      survivor: SurvivorSchema.default({}),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type StrategyId = keyof Config["strategies"];
export type BaseStrategyConfig = z.infer<typeof BaseStrategy>;
export type SniperConfig = z.infer<typeof SniperSchema>;
export type GraduationConfig = z.infer<typeof GraduationSchema>;
export type MigrationConfig = z.infer<typeof MigrationSchema>;
export type MomentumConfig = z.infer<typeof MomentumSchema>;
export type SmartMoneyConfig = z.infer<typeof SmartMoneySchema>;
export type DipBuyConfig = z.infer<typeof DipBuySchema>;
export type SmartSignalConfig = z.infer<typeof SmartSignalSchema>;
export type SurvivorConfig = z.infer<typeof SurvivorSchema>;

export const STRATEGY_IDS: StrategyId[] = [
  "sniper",
  "graduation",
  "migration",
  "momentum",
  "smartMoney",
  "dipBuy",
  "smartSignal",
  "survivor",
];
