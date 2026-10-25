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
  const c = cfg({ risk: { maxOpenPositions: 2, maxTotalExposureSol: 0.15, dailyLossLimitSol: 0.1, maxConsecutiveLosses: 2, pauseAfterLossesMin: 10 }, ...over });
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
