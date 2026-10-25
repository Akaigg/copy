import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nullLogger } from "../src/core/logger.js";
import { StateStore } from "../src/core/store.js";
import type { Signal } from "../src/core/types.js";
import { RiskManager } from "../src/risk/riskManager.js";
import { cfg, position, snap } from "./helpers.js";

function setup(over: Record<string, unknown> = {}) {
  const c = cfg({ risk: { maxOpenPositions: 2, maxTotalExposureSol: 0.15, dailyLossLimitSol: 0.1, maxConsecutiveLosses: 2, pauseAfterLossesMin: 10, maxFeePctOfTrade: 0, ...over } });
  const store = new StateStore(mkdtempSync(join(tmpdir(), "risk-")), "paper", 2);
  return { c, store, risk: new RiskManager(c, store, nullLogger) };
}
const sig = (address = "T1"): Signal => ({ strategyId: "sniper", token: snap({ address }), score: 80, reasons: [] });

test("aprova e limita tamanho pela exposição restante", () => {
  const { store, risk } = setup();
  store.state.positions.push(position({ tokenAddress: "X", entrySol: 0.12 }));
  const d = risk.canOpen(sig(), 0, 2);
  assert.equal(d.ok, true);
  assert.ok(Math.abs(d.sizeSol - 0.03) < 1e-9);
});

test("bloqueia token repetido, máximo de posições e saldo baixo", () => {
  const { store, risk } = setup();
  store.state.positions.push(position({ tokenAddress: "T1", entrySol: 0.01 }));
  assert.equal(risk.canOpen(sig("T1"), 0, 2).ok, false);
  store.state.positions.push(position({ id: "p2", tokenAddress: "T2", entrySol: 0.01 }));
  assert.match(risk.canOpen(sig("T3"), 0, 2).reason!, /máximo/);
  const fresh = setup();
  assert.equal(fresh.risk.canOpen(sig(), 0, 0.06).ok, false);
});

test("perdas seguidas pausam e limite diário bloqueia", () => {
  const { store, risk } = setup();
  risk.onClose(position({ realizedSol: 0.07 }), 1000); // -0.03
  risk.onClose(position({ realizedSol: 0.07, creator: "DevBad" }), 2000); // -0.03
  assert.ok(store.state.pausedUntil > 2000);
  assert.match(risk.blockReason(3000)!, /pausa/);
  risk.onClose(position({ realizedSol: 0.03 }), 4000); // -0.07 => total -0.13
  assert.match(risk.blockReason(store.state.pausedUntil + 1)!, /perda diária/);
});

test("cooldown impede recompra e dev é bloqueado após perda grande", () => {
  const { store, risk } = setup();
  risk.onClose(position({ tokenAddress: "T1", realizedSol: 0.02, creator: "Dev1" }), 0);
  assert.ok(store.state.blacklistCreators.includes("Dev1"));
  assert.match(risk.canOpen(sig("T1"), 1000, 2).reason!, /cooldown/);
});

test("taxas fixas altas demais para o tamanho do trade são recusadas", () => {
  const { risk } = setup({ maxFeePctOfTrade: 4, maxTotalExposureSol: 10 });
  // 2 × (0.0005 + 0.0005) = 0.002 SOL sobre 0.05 SOL = 4% -> passa no limite
  assert.equal(risk.canOpen(sig(), 0, 2).ok, true);
  const { risk: r2 } = setup({ maxFeePctOfTrade: 3, maxTotalExposureSol: 10 });
  assert.match(r2.canOpen(sig(), 0, 2).reason!, /taxas fixas/);
});

test("juros compostos: tamanho acompanha o patrimônio e freia no drawdown", () => {
  const { store, risk } = setup({
    maxTotalExposureSol: 100,
    maxPositionPctOfBalance: 100,
    sizing: { mode: "equityPct", equityPct: 10, minSol: 0.01, throttleDrawdownPct: 25, throttleFactor: 0.5 },
  });
  risk.updateEquity(1, 150, 0);
  assert.ok(Math.abs(risk.canOpen(sig(), 0, 1).sizeSol - 0.1) < 1e-9);
  risk.updateEquity(3, 150, 1);
  assert.ok(Math.abs(risk.canOpen(sig(), 1, 3).sizeSol - 0.3) < 1e-9);
  // caiu de 3 para 2 (-33% do pico) -> metade de 10%
  risk.updateEquity(2, 150, 2);
  assert.ok(Math.abs(risk.canOpen(sig(), 2, 2).sizeSol - 0.1) < 1e-9);
  assert.equal(store.state.equity.peakSol, 3);
});

test("meta e piso de patrimônio encerram as compras", () => {
  const { risk } = setup({ goal: { targetUsd: 1000, floorUsd: 40 } });
  assert.equal(risk.updateEquity(0.6, 150, 0), null); // $90
  assert.equal(risk.updateEquity(7, 150, 1), "goal"); // $1050
  assert.match(risk.blockReason(2)!, /META/);
  const s2 = setup({ goal: { targetUsd: 1000, floorUsd: 40 } });
  assert.equal(s2.risk.updateEquity(0.2, 150, 0), "floor"); // $30
  assert.match(s2.risk.blockReason(1)!, /piso/);
});

test("capital já recuperado libera exposição (moonbag não ocupa limite)", () => {
  const { store, risk } = setup({ maxTotalExposureSol: 0.1 });
  store.state.positions.push(position({ tokenAddress: "X", entrySol: 0.1, realizedSol: 0.12 }));
  assert.equal(risk.canOpen(sig(), 0, 2).ok, true);
});
