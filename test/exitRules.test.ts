import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitSchema } from "../src/config/schema.js";
import { decideExit, trackPrice } from "../src/positions/exitRules.js";
import { position } from "./helpers.js";

const exit = ExitSchema.parse({
  stopLossPct: 25,
  takeProfits: [
    { atPct: 50, sellPct: 40 },
    { atPct: 120, sellPct: 30 },
  ],
  trailing: { enabled: true, activateAtPct: 40, drawdownPct: 20 },
  breakEvenAtPct: 30,
  breakEvenBufferPct: 2,
  maxHoldMin: 60,
  staleAfterMin: 10,
  staleMinGainPct: 5,
});

test("sem gatilho perto da entrada", () => {
  assert.equal(decideExit(position(), 1.05, 60_000, exit), null);
});

test("stop loss vende tudo", () => {
  const d = decideExit(position(), 0.74, 60_000, exit);
  assert.ok(d?.full);
  assert.equal(d?.sellRaw, 1_000_000_000n);
  assert.match(d!.reason, /stop loss/);
});

test("primeiro take profit vende 40% da posição original", () => {
  const p = position({ highestPriceUsd: 1.5 });
  const d = decideExit(p, 1.5, 60_000, exit)!;
  assert.equal(d.full, false);
  assert.equal(d.sellRaw, 400_000_000n);
  assert.deepEqual(d.tpIndexes, [0]);
});

test("salto que cruza dois níveis vende os dois de uma vez", () => {
  const d = decideExit(position({ highestPriceUsd: 2.3 }), 2.3, 60_000, exit)!;
  assert.deepEqual(d.tpIndexes, [0, 1]);
  assert.equal(d.sellRaw, 700_000_000n);
});

test("TP já executado não repete", () => {
  const p = position({ tpHits: [0], tokensRemainingRaw: "600000000", highestPriceUsd: 1.6 });
  assert.equal(decideExit(p, 1.6, 60_000, exit), null);
});

test("trailing stop após ativação", () => {
  const p = position({ highestPriceUsd: 2.0, tpHits: [0], tokensRemainingRaw: "600000000" });
  const d = decideExit(p, 1.55, 60_000, exit)!; // 2.0 * 0.8 = 1.6
  assert.ok(d.full);
  assert.match(d.reason, /trailing/);
});

test("break-even: depois de +30% o stop sobe para entrada+2%", () => {
  const p = position();
  trackPrice(p, 1.35, 1000, exit);
  assert.equal(p.breakEvenArmed, true);
  const d = decideExit(p, 1.01, 2000, exit)!;
  assert.ok(d.full);
  assert.match(d.reason, /break-even/);
});

test("posição parada sai após staleAfterMin", () => {
  const d = decideExit(position({ highestPriceUsd: 1.03 }), 1.02, 11 * 60_000, exit)!;
  assert.match(d.reason, /parada/);
});

test("tempo máximo", () => {
  const d = decideExit(position({ highestPriceUsd: 1.2 }), 1.1, 61 * 60_000, exit)!;
  assert.match(d.reason, /tempo máximo/);
});

test("resto pequeno (poeira) é vendido junto", () => {
  const e = ExitSchema.parse({ takeProfits: [{ atPct: 50, sellPct: 98 }], dustPct: 3 });
  const d = decideExit(position({ highestPriceUsd: 1.6 }), 1.6, 1000, e)!;
  assert.ok(d.full);
  assert.equal(d.sellRaw, 1_000_000_000n);
});
