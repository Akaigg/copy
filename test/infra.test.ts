import { test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { Priority, RateLimiter } from "../src/core/rateLimiter.js";
import { toRaw, fromRaw } from "../src/core/utils.js";
import { buildMessage, detectAlgorithm, sign } from "../src/gmgn/signer.js";

test("mensagem assinada ordena query e arrays", () => {
  const m = buildMessage("/v1/trade/swap", { timestamp: 10, client_id: "abc", b: ["z", "a"] }, '{"x":1}', 10);
  assert.equal(m, '/v1/trade/swap:b=a&b=z&client_id=abc&timestamp=10:{"x":1}:10');
});

test("assinatura Ed25519 verifica com a chave pública", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.equal(detectAlgorithm(pem), "Ed25519");
  const sig = sign("hello", pem, "Ed25519");
  assert.ok(crypto.verify(null, Buffer.from("hello"), publicKey, Buffer.from(sig, "base64")));
});

test("rate limiter atende prioridade maior primeiro", async () => {
  const rl = new RateLimiter(20, 1);
  await rl.acquire(1); // esvazia o balde
  const order: string[] = [];
  const p1 = rl.acquire(1, Priority.Scan).then(() => order.push("scan"));
  const p2 = rl.acquire(1, Priority.Sell).then(() => order.push("sell"));
  await Promise.all([p1, p2]);
  assert.deepEqual(order, ["sell", "scan"]);
});

test("conversão raw sem perda", () => {
  assert.equal(toRaw(1.5, 6), 1_500_000n);
  assert.equal(toRaw(0, 6), 0n);
  assert.equal(fromRaw("2500000", 6), 2.5);
});
