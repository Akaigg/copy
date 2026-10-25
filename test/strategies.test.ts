import { test } from "node:test";
import assert from "node:assert/strict";
import { TokenStore } from "../src/scanner/tokenStore.js";
import { createStrategies } from "../src/strategies/index.js";
import { cfg, snap } from "./helpers.js";

const strategies = createStrategies(cfg());
const get = (id: string) => strategies.find((s) => s.id === id)!;

test("sniper aprova lançamento com tração", () => {
  const store = new TokenStore(10, 1e9);
  const ev = get("sniper").evaluate(store.upsert(snap()));
  assert.equal(ev.pass, true, ev.rejects.join("; "));
  assert.ok(ev.score >= 50, `score ${ev.score}`);
});

test("sniper reprova token velho demais e com dump", () => {
  const store = new TokenStore(10, 1e9);
  store.upsert(snap({ observedAt: 1_000_000 - 30_000, marketCapUsd: 30_000 }));
  const ev = get("sniper").evaluate(store.upsert(snap({ createdAt: 1_000_000 - 900_000, marketCapUsd: 12_000 })));
  assert.equal(ev.pass, false);
  assert.ok(ev.rejects.some((r) => r.startsWith("idade")));
  assert.ok(ev.rejects.some((r) => r.includes("caiu")));
});

test("smart money exige aumento dentro da janela", () => {
  const store = new TokenStore(10, 1e9);
  const s = snap({ sources: ["rank:5m"], stage: "migrated", liquidityUsd: 50_000, marketCapUsd: 200_000 });
  store.upsert({ ...s, smartDegenCount: 3, observedAt: 1_000_000 - 60_000 });
  const flat = get("smartMoney").evaluate(store.upsert({ ...s, smartDegenCount: 3 }));
  assert.equal(flat.pass, false);
  const up = get("smartMoney").evaluate(store.upsert({ ...s, smartDegenCount: 6, observedAt: 1_000_001 }));
  assert.equal(up.pass, true, up.rejects.join("; "));
});

test("momentum exige estar no ranking do intervalo configurado", () => {
  const store = new TokenStore(10, 1e9);
  const base = snap({
    stage: "migrated",
    liquidityUsd: 40_000,
    holderCount: 300,
    priceChange1mPct: 15,
    priceChange5mPct: 20,
    priceChange1hPct: 80,
    volumeByInterval: { "1m": 30_000 },
    buys: 500,
    sells: 200,
  });
  assert.equal(get("momentum").evaluate(store.upsert({ ...base, sources: ["rank:5m"] })).pass, false);
  const ev = get("momentum").evaluate(store.upsert({ ...base, sources: ["rank:1m"], observedAt: 1_000_002 }));
  assert.equal(ev.pass, true, ev.rejects.join("; "));
});

test("graduation e dipBuy", () => {
  const store = new TokenStore(10, 1e9);
  const grad = get("graduation").evaluate(
    store.upsert(snap({ sources: ["trenches:near_completion"], stage: "near", progress: 0.92, holderCount: 200, volume1hUsd: 40_000 })),
  );
  assert.equal(grad.pass, true, grad.rejects.join("; "));
  const dip = get("dipBuy").evaluate(
    store.upsert(
      snap({
        address: "Dip",
        sources: ["rank:1h"],
        priceChange1hPct: 150,
        priceChange5mPct: -20,
        priceChange1mPct: 3,
        liquidityUsd: 60_000,
        volumeByInterval: { "1h": 200_000 },
        holderCount: 900,
      }),
    ),
  );
  assert.equal(dip.pass, true, dip.rejects.join("; "));
});
