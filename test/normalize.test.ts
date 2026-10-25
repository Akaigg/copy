import { test } from "node:test";
import assert from "node:assert/strict";
import { fromRank, fromSecurity, fromTokenInfo, fromTrenches, mergeSnapshots } from "../src/scanner/normalize.js";

test("trenches: campos e estágio", () => {
  const s = fromTrenches(
    {
      address: "A1",
      symbol: "PEPE",
      usd_market_cap: "12000",
      total_supply: "1000000000",
      created_timestamp: 1700000000,
      holder_count: 55,
      swaps_1m: 30,
      buys_24h: 200,
      sells_24h: 100,
      renounced_mint: true,
      renounced_freeze_account: true,
      bundler_trader_amount_rate: 0.12,
      rat_trader_amount_rate: 0.03,
      is_honeypot: "",
      creator_token_status: "creator_hold",
      twitter: "https://x.com/pepe",
      progress: 0.4,
    },
    "new_creation",
    1700000060_000,
  )!;
  assert.equal(s.stage, "curve");
  assert.equal(s.marketCapUsd, 12000);
  assert.equal(s.priceUsd, 12000 / 1e9);
  assert.equal(s.createdAt, 1700000000_000);
  assert.equal(s.bundlerRate, 0.12);
  assert.equal(s.isHoneypot, undefined);
  assert.equal(s.creatorClosed, false);
  assert.equal(s.hasSocial, true);
  assert.equal(s.progress, 0.4);
});

test("ranking: variação por intervalo, 1/0 como boolean, imposto vazio = 0", () => {
  const s = fromRank(
    {
      address: "B2",
      symbol: "DOG",
      price: "0.0012",
      market_cap: 1200000,
      volume: 50000,
      buys: 400,
      sells: 200,
      price_change_percent: 12,
      price_change_percent5m: 30,
      renounced_mint: 1,
      renounced_freeze_account: 0,
      buy_tax: "",
      open_timestamp: 1700000000,
      bundler_rate: 0.2,
    },
    "1m",
    1,
  )!;
  assert.equal(s.priceChange1mPct, 12);
  assert.equal(s.priceChange5mPct, 30);
  assert.equal(s.volumeByInterval?.["1m"], 50000);
  assert.equal(s.mintRenounced, true);
  assert.equal(s.freezeRenounced, false);
  assert.equal(s.buyTax, 0);
  assert.equal(s.stage, "migrated");
  assert.equal(s.bundlerRate, 0.2);
});

test("token info: preço aninhado e variação calculada", () => {
  const s = fromTokenInfo({ address: "C3", symbol: "X", price: { price: "2", price_1m: "1" }, circulating_supply: "100", liquidity: "5000" }, 1)!;
  assert.equal(s.priceUsd, 2);
  assert.equal(s.marketCapUsd, 200);
  assert.equal(s.priceChange1mPct, 100);
});

test("security + merge mantém dados antigos e soma fontes", () => {
  const a = fromRank({ address: "D", symbol: "D", price: 1 }, "5m", 1)!;
  const sec = fromSecurity({ rug_ratio: 0.9, is_honeypot: "no", renounced_mint: true });
  const m = mergeSnapshots(a, { ...sec, sources: ["rank:1m"] });
  assert.equal(m.rugRatio, 0.9);
  assert.equal(m.isHoneypot, false);
  assert.equal(m.priceUsd, 1);
  assert.deepEqual(m.sources, ["rank:5m", "rank:1m"]);
});
