import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, unknownKeys } from "../src/config/load.js";
import { ExitSchema, SafetySchema } from "../src/config/schema.js";
import { dynamicSlippage, klineVeto } from "../src/execution/preBuy.js";
import { readPattern, parseCandles, type Candle } from "../src/filters/kline.js";
import { checkSafety } from "../src/filters/safety.js";
import { decideExit, trailingDrawdown } from "../src/positions/exitRules.js";
import { flattenItems } from "../src/scanner/scanner.js";
import { fromSignals, mergeSnapshots, signalCount } from "../src/scanner/normalize.js";
import { TokenStore } from "../src/scanner/tokenStore.js";
import { bootstrapSampler, bucketSampler, SCENARIOS, simulate } from "../src/simulate.js";
import { createStrategies } from "../src/strategies/index.js";
import { cfg, position, snap } from "./helpers.js";

const strategies = createStrategies(cfg());
const get = (id: string) => strategies.find((s) => s.id === id)!;
const NOW = 1_000_000_000;

// ------------------------------------------------------------ sinais
test("sinais: agrega disparos por token, mcap do 1º sinal e último horário", () => {
  const items = flattenItems([
    [
      { token_address: "S1", signal_type: 12, trigger_at: 999_900, first_trigger_mc: 20000, market_cap: 25000, signal_times_by_type: { "12": 3 } },
      { token_address: "S1", signal_type: 20, trigger_at: 999_950, trigger_mc: 24000, market_cap: 26000, cur_data: { holder_count: 300, liquidity: 20000 } },
    ],
    { list: [{ token_address: "S2", signal_type: 10, trigger_at: 999_000 }] },
  ]);
  assert.equal(items.length, 3);
  const snaps = fromSignals(items, NOW);
  const s1 = snaps.find((s) => s.address === "S1")!;
  assert.equal(signalCount(s1, [12, 20]), 4);
  assert.equal(s1.firstSignalMcUsd, 20000);
  assert.equal(s1.lastSignalAt, 999_950_000);
  assert.equal(s1.holderCount, 300);
  const merged = mergeSnapshots(s1, { signalCounts: { "12": 5 }, firstSignalMcUsd: 30000 });
  assert.equal(merged.signalCounts!["12"], 5);
  assert.equal(merged.firstSignalMcUsd, 20000);
});

test("smartSignal: confluência aprova, preço que já correu demais reprova", () => {
  const base = snap({
    sources: ["signal", "info"],
    stage: "migrated",
    signalCounts: { "12": 2, "20": 1 },
    firstSignalMcUsd: 100_000,
    marketCapUsd: 120_000,
    lastSignalAt: NOW - 60_000,
    liquidityUsd: 40_000,
    holderCount: 400,
    observedAt: NOW,
  });
  const ok = get("smartSignal").evaluate(new TokenStore(5, 1e12).upsert(base));
  assert.equal(ok.pass, true, ok.rejects.join("; "));
  const late = get("smartSignal").evaluate(new TokenStore(5, 1e12).upsert({ ...base, marketCapUsd: 250_000 }));
  assert.equal(late.pass, false);
  assert.ok(late.rejects.some((r) => r.startsWith("mcap/1º sinal")));
});

test("survivor: sobreviveu à migração e recuou do topo", () => {
  const base = snap({
    sources: ["rank:1h"],
    stage: "migrated",
    openAt: NOW - 90 * 60_000,
    createdAt: NOW - 120 * 60_000,
    marketCapUsd: 300_000,
    athMarketCapUsd: 450_000,
    holderCount: 1200,
    liquidityUsd: 60_000,
    volumeByInterval: { "1h": 150_000 },
    volume1hUsd: 150_000,
    buys: 900,
    sells: 600,
    priceChange1mPct: 2,
    smartDegenCount: 5,
    observedAt: NOW,
  });
  const ev = get("survivor").evaluate(new TokenStore(5, 1e12).upsert(base));
  assert.equal(ev.pass, true, ev.rejects.join("; "));
  // no topo (sem recuo) e recém-migrado → reprova
  const top = get("survivor").evaluate(
    new TokenStore(5, 1e12).upsert({ ...base, athMarketCapUsd: 310_000, openAt: NOW - 5 * 60_000 }),
  );
  assert.equal(top.pass, false);
  assert.equal(top.rejects.length, 2);
});

// ------------------------------------------------------------ segurança nova
test("filtros novos: faca caindo, carteiras novas, robôs, bundlers vendendo, dev fábrica", () => {
  const sf = SafetySchema.parse({ minDevGraduationRatio: 0.02 });
  const r = checkSafety(
    snap({
      priceChange5mPct: -14,
      freshWalletRate: 0.45,
      botDegenRate: 0.8,
      signalCounts: { "10": 1 },
      devCreatedCount: 120,
      devGraduatedCount: 1,
    }),
    sf,
  );
  assert.equal(r.failures.length, 6, r.failures.join(" | "));
  assert.equal(checkSafety(snap({ priceChange5mPct: -6, devCreatedCount: 10, devGraduatedCount: 2 }), sf).ok, true);
});

// ------------------------------------------------------------ saídas moonbag
test("trailing escalonado alarga com o lucro e moonbag ganha prazo após o TP", () => {
  const exit = ExitSchema.parse({
    takeProfits: [{ atPct: 100, sellPct: 50 }],
    trailing: { activateAtPct: 50, drawdownPct: 25, tiers: [{ atPct: 100, drawdownPct: 30 }, { atPct: 300, drawdownPct: 40 }] },
    breakEvenAtPct: null,
    maxHoldMin: 45,
    maxHoldAfterTpMin: 360,
    staleAfterMin: 0,
  });
  assert.equal(trailingDrawdown(exit, 60), 25);
  assert.equal(trailingDrawdown(exit, 150), 30);
  assert.equal(trailingDrawdown(exit, 900), 40);
  // pico 10x (+900%), preço 6.5x: recuo de 35% < 40% → segura
  const p = position({ highestPriceUsd: 10, tpHits: [0], tokensRemainingRaw: "500000000" });
  assert.equal(decideExit(p, 6.5, 60 * 60_000, exit), null);
  // recuo de 45% → vende
  assert.match(decideExit(p, 5.5, 60 * 60_000, exit)!.reason, /trailing stop 40%/);
  // sem TP: prazo de 45 min; com TP: 360 min
  assert.match(decideExit(position({ highestPriceUsd: 1.2 }), 1.1, 50 * 60_000, exit)!.reason, /tempo máximo 45/);
  assert.equal(decideExit(position({ highestPriceUsd: 2.1, tpHits: [0] }), 1.9, 50 * 60_000, exit), null);
});

// ------------------------------------------------------------ execução
test("slippage dinâmico segue a fórmula da GMGN com piso e teto", () => {
  const s = cfg().strategies.survivor;
  const t = snap({ liquidityUsd: 100_000, priceChange5mPct: 6, buyTax: 0, createdAt: NOW - 7_200_000 });
  // 2 + 0 + (10/(50000))*100*1.5 + 6*0.5 = 2 + 0.03 + 3 = 5.03 → 5
  assert.equal(dynamicSlippage(t, 10, { ...s, minSlippagePct: 1, slippagePct: 25 }, NOW), 5);
  assert.equal(dynamicSlippage(t, 10, { ...s, minSlippagePct: 8, slippagePct: 25 }, NOW), 8);
  const wild = snap({ liquidityUsd: 5_000, priceChange5mPct: 40, createdAt: NOW - 60_000 });
  assert.equal(dynamicSlippage(wild, 200, { ...s, slippagePct: 15 }, NOW), 15);
  assert.equal(dynamicSlippage(wild, 200, { ...s, dynamicSlippage: false, slippagePct: 22 }, NOW), 22);
});

function candles(closes: number[], vol = 1000): Candle[] {
  return closes.map((c, i) => ({ time: i * 60, open: closes[i - 1] ?? c, high: c * 1.01, low: c * 0.99, close: c, volume: vol }));
}

test("padrão gráfico: alta, despejo e veto", () => {
  const up = readPattern(candles(Array.from({ length: 30 }, (_, i) => 1 + i * 0.02)))!;
  assert.equal(up.trend, "up");
  assert.ok(["uptrendChannel", "verticalRunUp"].includes(up.pattern), up.pattern);
  assert.ok(up.score >= 70, String(up.score));
  const down = readPattern(candles(Array.from({ length: 30 }, (_, i) => 3 - i * 0.08)))!;
  assert.ok(["breakdown", "slowBleed"].includes(down.pattern), down.pattern);
  const s = { ...cfg().strategies.momentum, klineMinScore: 55 };
  assert.match(klineVeto(down, s)!, /padrão|score/);
  assert.equal(klineVeto(up, s), null);
  assert.equal(readPattern(candles([1, 2, 3])), null);
  assert.equal(parseCandles({ list: [{ time: 2, close: "1", high: "1.1", low: "0.9" }, { time: 1, close: "2", high: "2", low: "2" }] })[0]!.time, 1);
});

// ------------------------------------------------------------ simulador
test("Monte Carlo: sem vantagem quebra; com vantagem atinge a meta; aposta grande demais aumenta a quebra", () => {
  const base = { startUsd: 100, targetUsd: 1000, floorUsd: 40, betPct: 8, minBetUsd: 3, feeUsd: 0.3, maxTrades: 600, runs: 1500, seed: 7 };
  const bad = simulate(bucketSampler(SCENARIOS.pessimista!.buckets), base);
  assert.ok(bad.pRuin > 0.95 && bad.evPct < 0);
  const good = simulate(bucketSampler(SCENARIOS.otimista!.buckets), base);
  assert.ok(good.pTarget > 0.8, String(good.pTarget));
  const greedy = simulate(bucketSampler(SCENARIOS.otimista!.buckets), { ...base, betPct: 35 });
  assert.ok(greedy.pRuin > good.pRuin * 3);
  const boot = simulate(bootstrapSampler([-20, -20, 100]), { ...base, feeUsd: 0 });
  assert.ok(boot.pTarget > 0.9);
});

// ------------------------------------------------------------ preset
test("preset 100→1000 carrega, herda o perfil moonbag e passa no filtro de taxas", () => {
  const c = loadConfig("config/preset-100-a-1000.yaml").config;
  assert.equal(c.risk.sizing.mode, "equityPct");
  assert.equal(c.risk.goal.targetUsd, 1000);
  assert.equal(c.strategies.sniper.enabled, false);
  const equity = c.paper.startingBalanceSol;
  for (const [id, s] of Object.entries(c.strategies)) {
    if (!s.enabled) continue;
    assert.deepEqual(s.exit.takeProfits[0], { atPct: 100, sellPct: 50 }, id);
    assert.ok(s.exit.trailing.tiers.length >= 3, id);
    const size = ((equity * c.risk.sizing.equityPct) / 100) * s.sizeMultiplier;
    const feePct = ((2 * (s.priorityFeeSol + s.tipFeeSol)) / size) * 100;
    assert.ok(feePct <= c.risk.maxFeePctOfTrade, `${id}: taxas ${feePct.toFixed(1)}%`);
  }
});

test("configs de exemplo não têm chaves desconhecidas; erro de digitação é detectado", () => {
  assert.deepEqual(loadConfig("config/config.example.yaml").unknownKeys, []);
  assert.deepEqual(loadConfig("config/preset-100-a-1000.yaml").unknownKeys, []);
  const parsed = cfg({});
  assert.deepEqual(unknownKeys({ risk: { maxOpenPosition: 3 }, strategies: { sniper: { buySOL: 1 } } }, parsed), [
    "risk.maxOpenPosition",
    "strategies.sniper.buySOL",
  ]);
});
