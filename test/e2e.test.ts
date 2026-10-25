import { test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nullLogger } from "../src/core/logger.js";
import { Engine } from "../src/engine.js";
import { LiveExecutor } from "../src/execution/liveExecutor.js";
import { buildRuntime } from "../src/runtime.js";
import { fakeGmgn, listen, TOKEN } from "./fakeGmgn.js";
import { cfg } from "./helpers.js";

test("paper: scanner → sinal → compra → alta → take profit + trailing", async () => {
  const state = { price: 0.000012 };
  const { server } = fakeGmgn(state);
  const host = await listen(server);
  try {
    const c = cfg({
      mode: "paper",
      gmgn: { host, plan: "pro", rateSafetyFactor: 1 },
      storage: { dir: mkdtempSync(join(tmpdir(), "e2e-")) },
      paper: { failureRate: 0, startingBalanceSol: 1 },
      scanner: { trending: { enabled: true, intervals: ["1m"] } },
      recorder: { enabled: false },
      strategies: {
        graduation: { enabled: false },
        migration: { enabled: false },
        momentum: { enabled: false },
        smartMoney: { enabled: false },
        dipBuy: { enabled: false },
        sniper: { buySol: 0.05, minScore: 40, exit: { takeProfits: [{ atPct: 50, sellPct: 50 }], trailing: { activateAtPct: 40, drawdownPct: 20 } } },
      },
    });
    const rt = buildRuntime(c, { apiKey: "test-key" }, nullLogger);
    const engine = new Engine({ ...rt });

    await engine.step(Date.now());
    const [pos] = rt.store.openPositions;
    assert.ok(pos, "deveria ter comprado");
    assert.equal(pos.strategyId, "sniper");
    assert.ok(rt.store.state.paperBalanceSol < 1);

    // Preço dobra: TP de +50% vende metade.
    state.price = 0.000024;
    await engine.processPositions(Date.now() + 10_000);
    assert.equal(pos.tpHits.length, 1);
    assert.ok(BigInt(pos.tokensRemainingRaw) < BigInt(pos.tokensInitialRaw));

    // Recuo de 30% da máxima: trailing fecha o resto.
    state.price = 0.000016;
    await engine.processPositions(Date.now() + 20_000);
    assert.equal(pos.status, "closed");
    assert.ok(rt.store.state.totals.trades === 1);
    assert.ok(rt.store.state.totals.realizedPnlSol > 0, `pnl ${rt.store.state.totals.realizedPnlSol}`);
    assert.ok(rt.store.state.tokenCooldowns[TOKEN]! > Date.now());
    assert.equal(rt.store.readTrades().length, 3);
  } finally {
    server.close();
  }
});

test("live: swap assinado + polling da ordem + relatório", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const state = { price: 0.000012, publicKey };
  const { server, calls } = fakeGmgn(state);
  const host = await listen(server);
  try {
    const c = cfg({
      mode: "live",
      live: { acknowledgeRisk: true },
      gmgn: { host, plan: "pro", rateSafetyFactor: 1 },
      storage: { dir: mkdtempSync(join(tmpdir(), "e2e-live-")) },
      execution: { orderPollIntervalMs: 10 },
    });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const rt = buildRuntime(c, { apiKey: "test-key", privateKeyPem: pem, walletAddress: "Wallet111" }, nullLogger);
    assert.ok(rt.executor instanceof LiveExecutor);
    const res = await rt.executor.buy({
      token: { address: TOKEN, symbol: "MOON", sources: [], observedAt: 0, stage: "curve", priceUsd: state.price },
      sizeSol: 0.05,
      strategy: c.strategies.sniper,
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.tokensRaw, 600_000_000_000n);
      assert.equal(res.decimals, 6);
      assert.equal(res.priceUsd, 0.0000125);
      assert.equal(res.tx, "tx1");
    }
    assert.deepEqual(calls.filter((p) => p.startsWith("/v1/trade")), ["/v1/trade/swap", "/v1/trade/query_order"]);
    assert.equal(await rt.executor.getSolBalance(), 3.5);
  } finally {
    server.close();
  }
});

test("live sem confirmação de risco é bloqueado", () => {
  assert.throws(
    () => buildRuntime(cfg({ mode: "live" }), { apiKey: "k", privateKeyPem: "x", walletAddress: "w" }, nullLogger),
    /acknowledgeRisk/,
  );
});
