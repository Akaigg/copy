import { test } from "node:test";
import assert from "node:assert/strict";
import { SafetySchema } from "../src/config/schema.js";
import { checkSafety, mergeSafety } from "../src/filters/safety.js";
import { snap } from "./helpers.js";

const base = SafetySchema.parse({});

test("token saudável passa", () => {
  assert.deepEqual(checkSafety(snap(), base), { ok: true, failures: [] });
});

test("mint authority ativa, rug alto e top10 concentrado reprovam", () => {
  const r = checkSafety(snap({ mintRenounced: false, rugRatio: 0.8, top10HolderRate: 0.7 }), base);
  assert.equal(r.ok, false);
  assert.equal(r.failures.length, 3);
});

test("dados ausentes: leniente passa, estrito reprova", () => {
  const s = snap({ rugRatio: undefined, mintRenounced: undefined });
  assert.equal(checkSafety(s, base).ok, true);
  assert.equal(checkSafety(s, { ...base, strictMissing: true }).ok, false);
});

test("blacklist de dev e override por estratégia", () => {
  const s = snap({ creator: "DevX", devHoldRate: 0.2 });
  const merged = mergeSafety(base, { blacklistCreators: ["DevX"], maxDevHoldRate: 0.5 });
  const r = checkSafety(s, merged);
  assert.deepEqual(r.failures, ["criador na blacklist"]);
});
