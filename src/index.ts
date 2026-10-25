#!/usr/bin/env node
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "./config/load.js";
import type { Config } from "./config/schema.js";
import { StateStore } from "./core/store.js";
import { errMsg, fmtSol, fmtUsd, fromRaw, SOL_MINT } from "./core/utils.js";
import { startDashboard } from "./dashboard/server.js";
import { Engine } from "./engine.js";
import { checkSafety, mergeSafety } from "./filters/safety.js";
import { readFileSync } from "node:fs";
import { runReplay } from "./replay.js";
import { bootstrapSampler, bucketSampler, returnsFromTrades, SCENARIOS, simulate, type Sampler } from "./simulate.js";
import { buildRuntime, makeClient, makeLogger } from "./runtime.js";
import { ageSec } from "./scanner/normalize.js";
import { TokenStore } from "./scanner/tokenStore.js";
import { createStrategies } from "./strategies/index.js";

const HELP = `
GMGN Hot Bot — robô de trading para memecoins recém-lançadas na Solana (via GMGN OpenAPI)

Uso: gmgn-bot <comando> [opções]

Comandos:
  init                 cria config/config.yaml e .env a partir dos exemplos
  keygen               gera o par de chaves Ed25519 de assinatura da API da GMGN
  check                valida configuração, credenciais e conexão com a GMGN
  scan                 faz UMA varredura e mostra quais tokens passariam em cada estratégia (não opera)
  run                  inicia o robô (paper por padrão)
  status               mostra posições abertas e resultados
  sell-all             vende todas as posições abertas (com o robô parado)
  replay <arquivo|dir> backtest sobre dados gravados em data/recordings
  simulate             Monte Carlo: chance real de ir de $start a $target (ver --help abaixo)

Opções:
  --config <arquivo>   caminho do config (padrão: config/config.yaml)
  --mode paper|live    sobrescreve o modo do config
  --limit <n>          (scan) quantos tokens mostrar
  --verbose            (scan) mostra motivos de reprovação

Opções do simulate:
  --trades <arquivo>   reamostra seus trades reais (ex.: data/paper/trades.jsonl) — recomendado
  --scenario <nome>    pessimista | equilibrado | otimista (hipotéticos, só ilustram a matemática)
  --start 100 --target 1000 --floor 40 --bet 6 --fee-usd 0.3 --runs 5000 --max-trades 600
`;

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else args[key] = true;
    } else pos.push(a);
  }
  return { cmd: pos[0], pos: pos.slice(1), args };
}

function load(args: Record<string, string | boolean>) {
  const overrides: Partial<Config> = {};
  if (args.mode === "paper" || args.mode === "live") overrides.mode = args.mode;
  else if (args.mode) throw new Error("--mode deve ser paper ou live");
  const loaded = loadConfig(typeof args.config === "string" ? args.config : undefined, overrides);
  if (loaded.unknownKeys.length) {
    console.error(`⚠ Chaves desconhecidas no config (ignoradas — erro de digitação?): ${loaded.unknownKeys.join(", ")}`);
  }
  return loaded;
}

async function cmdInit() {
  mkdirSync("config", { recursive: true });
  if (!existsSync("config/config.yaml")) {
    copyFileSync("config/config.example.yaml", "config/config.yaml");
    console.log("✔ config/config.yaml criado");
  } else console.log("• config/config.yaml já existe");
  if (!existsSync(".env")) {
    copyFileSync(".env.example", ".env");
    console.log("✔ .env criado — preencha GMGN_API_KEY");
  } else console.log("• .env já existe");
}

async function cmdKeygen() {
  const file = "keys/gmgn-signing.pem";
  if (existsSync(file)) throw new Error(`${file} já existe — apague-o se quiser gerar outro`);
  mkdirSync("keys", { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(`✔ Chave privada de assinatura salva em ${file} (NÃO compartilhe)`);
  console.log(`  No .env defina: GMGN_PRIVATE_KEY_FILE=${file}\n`);
  console.log("Cole a CHAVE PÚBLICA abaixo em https://gmgn.ai/ai/generateapi ao criar a API key:\n");
  console.log(publicKey.export({ type: "spki", format: "pem" }).toString());
}

async function cmdCheck(args: Record<string, string | boolean>) {
  const { config: cfg, secrets, path } = load(args);
  const log = makeLogger({ ...cfg, log: { ...cfg.log, toFile: false } });
  console.log(`Config: ${path ?? "(padrões internos)"} | modo ${cfg.mode} | plano GMGN ${cfg.gmgn.plan}`);
  const ok = (m: string) => console.log(`  ✔ ${m}`);
  const bad = (m: string) => console.log(`  ✘ ${m}`);
  secrets.apiKey ? ok("GMGN_API_KEY definida") : bad("GMGN_API_KEY ausente");
  secrets.privateKeyPem ? ok("chave de assinatura definida") : console.log("  • chave de assinatura ausente (necessária só para live)");
  secrets.walletAddress ? ok(`carteira ${secrets.walletAddress}`) : console.log("  • GMGN_WALLET_ADDRESS ausente (necessária só para live)");
  if (!secrets.apiKey) return;

  const client = makeClient(cfg, secrets, log);
  const tryIt = async (label: string, fn: () => Promise<string>) => {
    try {
      ok(`${label}: ${await fn()}`);
    } catch (e) {
      bad(`${label}: ${errMsg(e)}`);
    }
  };
  await tryIt("SOL/USD", async () => {
    const info = await client.getTokenInfo(cfg.chain, SOL_MINT);
    return `$${(info as { price?: { price?: string } }).price?.price ?? "?"}`;
  });
  await tryIt("ranking 1m", async () => {
    const d = await client.getRank(cfg.chain, "1m", { limit: 5 });
    return `${(Array.isArray(d) ? d : (d.rank ?? [])).length} tokens`;
  });
  await tryIt("trenches", async () => {
    const d = await client.getTrenches(cfg.chain, { version: "v2", new_creation: { limit: 5, filters: ["offchain", "onchain"], launchpad_platform_v2: true } });
    return `${((d?.new_creation as unknown[]) ?? []).length} novos`;
  });
  if (secrets.privateKeyPem && secrets.walletAddress) {
    await tryIt("saldo da carteira (rota assinada)", async () => {
      const d = await client.getWalletTokenBalance(cfg.chain, secrets.walletAddress!, SOL_MINT);
      return JSON.stringify(d).slice(0, 120);
    });
  }
  if (cfg.mode === "live" && cfg.gmgn.plan === "free") {
    console.log("  ⚠ Rotas de swap pesam 10 e o plano free tem capacidade 5 — provavelmente será preciso o plano Plus/Pro para operar no live.");
  }
}

async function cmdScan(args: Record<string, string | boolean>) {
  const { config: cfg, secrets } = load(args);
  const log = makeLogger({ ...cfg, log: { ...cfg.log, toFile: false } });
  const rt = buildRuntime({ ...cfg, mode: "paper" }, secrets, log);
  const now = Date.now();
  const snaps = await rt.scanner.scan(now);
  const store = new TokenStore(10, 3600_000);
  const strategies = createStrategies(cfg).filter((s) => s.cfg.enabled);
  const limit = Number(args.limit ?? 40);
  const verbose = !!args.verbose;
  console.log(`\n${snaps.length} tokens encontrados. Estratégias ativas: ${strategies.map((s) => s.id).join(", ")}\n`);

  const rows = snaps.map((raw) => {
    const ctx = store.upsert(raw);
    const s = ctx.snap;
    const results = strategies.map((st) => {
      const safety = checkSafety(s, mergeSafety(cfg.safety, st.cfg.safety));
      const ev = st.evaluate(ctx);
      return { st, safety, ev, buy: safety.ok && ev.pass && ev.score >= st.cfg.minScore };
    });
    return { s, results, best: Math.max(0, ...results.map((r) => (r.ev.pass && r.safety.ok ? r.ev.score : 0))) };
  });
  rows.sort((a, b) => b.best - a.best);
  for (const { s, results } of rows.slice(0, limit)) {
    const age = ageSec(s, now);
    const ageStr = age === undefined ? "?" : age < 3600 ? `${Math.round(age / 60)}m` : `${(age / 3600).toFixed(1)}h`;
    const hits = results.filter((r) => r.buy).map((r) => `${r.st.id}(${r.ev.score})`);
    console.log(
      `${hits.length ? "🟢" : "⚪"} ${s.symbol.padEnd(12).slice(0, 12)} ${s.address.slice(0, 6)}… idade ${ageStr.padStart(5)} mcap ${fmtUsd(s.marketCapUsd).padStart(7)} liq ${fmtUsd(s.liquidityUsd).padStart(7)} holders ${String(s.holderCount ?? "?").padStart(5)} [${s.sources.join(",")}] ${hits.join(" ")}`,
    );
    if (verbose && !hits.length) {
      for (const r of results) {
        const why: string[] = [];
        if (!r.safety.ok) why.push(`segurança: ${r.safety.failures.slice(0, 3).join("; ")}`);
        if (r.ev.rejects.length) why.push(r.ev.rejects.slice(0, 3).join("; "));
        else if (r.ev.score < r.st.cfg.minScore) why.push(`score ${r.ev.score} < mínimo ${r.st.cfg.minScore}`);
        if (why.length) console.log(`     ${r.st.id}: ${why.join(" | ")}`);
      }
    }
  }
}

async function cmdRun(args: Record<string, string | boolean>) {
  const { config: cfg, secrets, path } = load(args);
  const rt = buildRuntime(cfg, secrets);
  rt.log.info(`Config: ${path ?? "(padrões internos — rode `init`)"}`);
  if (cfg.mode === "live") {
    rt.log.warn("⚠️  MODO LIVE: ordens REAIS serão enviadas pela carteira vinculada à sua API key da GMGN.");
  }
  rt.store.acquireLock();
  const engine = new Engine({ ...rt });
  engine.rateLimiterQueue = () => rt.client.limiter.queued;
  const server = cfg.dashboard.enabled ? startDashboard(engine, cfg.dashboard, rt.log) : undefined;

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) {
      rt.log.warn("Forçando saída");
      process.exit(1);
    }
    stopping = true;
    rt.log.info(`${signal} recebido — desligando com segurança (Ctrl+C de novo força)`);
    server?.close();
    await engine.stop();
    rt.store.releaseLock();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (e) => rt.log.error(`Promise rejeitada: ${errMsg(e)}`));
  process.on("uncaughtException", (e) => {
    rt.log.error(`Exceção não tratada: ${errMsg(e)}`);
    rt.store.save(true);
  });
  await engine.start();
}

async function cmdStatus(args: Record<string, string | boolean>) {
  const { config: cfg } = load(args);
  const store = new StateStore(cfg.storage.dir, cfg.mode, cfg.paper.startingBalanceSol);
  const st = store.state;
  const running = store.isLocked();
  console.log(`\nModo ${cfg.mode.toUpperCase()} — robô ${running ? `rodando (pid ${running})` : "parado"}`);
  if (cfg.mode === "paper") console.log(`Saldo paper: ${fmtSol(st.paperBalanceSol)}`);
  const d = st.daily;
  console.log(`Hoje (${d.date}): ${fmtSol(d.realizedPnlSol)} | ${d.trades} trades | ${d.wins}✅ ${d.losses}❌`);
  if (st.equity.lastUsd > 0) {
    const goal = cfg.risk.goal.targetUsd;
    const prog = goal > 0 ? ` | meta $${goal} (${Math.min(100, (st.equity.lastUsd / goal) * 100).toFixed(1)}%)` : "";
    console.log(`Patrimônio: $${st.equity.lastUsd.toFixed(2)} (${fmtSol(st.equity.lastSol)}) | pico ${fmtSol(st.equity.peakSol)}${prog}`);
    if (st.equity.goalReachedAt !== undefined) console.log("🏁 META ATINGIDA — compras encerradas");
    if (st.equity.floorHitAt !== undefined) console.log("🧱 Abaixo do piso — compras encerradas");
  }
  const t = st.totals;
  console.log(`Total: ${fmtSol(t.realizedPnlSol)} | ${t.trades} trades | acerto ${t.trades ? Math.round((t.wins / t.trades) * 100) : 0}%`);

  const open = store.openPositions;
  console.log(`\nPosições abertas (${open.length}):`);
  for (const p of open) {
    const pnl = ((p.lastPriceUsd - p.entryPriceUsd) / p.entryPriceUsd) * 100;
    const tokens = fromRaw(p.tokensRemainingRaw, p.tokenDecimals);
    console.log(
      `  ${p.symbol.padEnd(12)} [${p.strategyId}] entrada $${p.entryPriceUsd.toPrecision(4)} atual $${p.lastPriceUsd.toPrecision(4)} (${pnl.toFixed(1)}%) ${tokens.toFixed(0)} tokens, aberta há ${Math.round((Date.now() - p.openedAt) / 60000)} min`,
    );
  }

  const by: Record<string, { n: number; w: number; pnl: number }> = {};
  for (const tr of store.readTrades()) {
    if (tr.side !== "sell" || tr.pnlSol === undefined) continue;
    const b = (by[tr.strategyId] ??= { n: 0, w: 0, pnl: 0 });
    b.n++;
    b.pnl += tr.pnlSol;
    if (tr.pnlSol >= 0) b.w++;
  }
  if (Object.keys(by).length) {
    console.log("\nPor estratégia:");
    for (const [k, b] of Object.entries(by)) {
      console.log(`  ${k.padEnd(12)} ${String(b.n).padStart(4)} trades  acerto ${Math.round((b.w / b.n) * 100)}%  PnL ${fmtSol(b.pnl)}`);
    }
  }
  if (st.manualPause || st.pausedUntil > Date.now()) console.log("\n⛔ Compras pausadas");
}

async function cmdSellAll(args: Record<string, string | boolean>) {
  const { config: cfg, secrets } = load(args);
  const rt = buildRuntime(cfg, secrets);
  rt.store.acquireLock();
  try {
    const engine = new Engine({ ...rt });
    const open = rt.store.openPositions;
    if (!open.length) return console.log("Nenhuma posição aberta.");
    const fresh = await rt.market.refresh(open.map((p) => p.tokenAddress), Date.now());
    for (const s of fresh.values()) engine.tokens.upsert(s);
    await engine.sellAll("sell-all (CLI)");
    rt.store.save(true);
    console.log(`Restam ${rt.store.openPositions.length} posições abertas.`);
  } finally {
    rt.store.releaseLock();
  }
}

async function cmdReplay(pos: string[], args: Record<string, string | boolean>) {
  const { config: cfg } = load(args);
  const path = pos[0] ?? `${cfg.storage.dir}/recordings`;
  const log = args.verbose ? makeLogger({ ...cfg, log: { ...cfg.log, toFile: false } }) : undefined;
  const r = await runReplay(cfg, path, log);
  console.log(`\nReplay de ${path}: ${r.scans} ciclos`);
  console.log(`Trades: ${r.trades} | acerto ${r.trades ? Math.round((r.wins / r.trades) * 100) : 0}% | PnL ${fmtSol(r.pnlSol)}`);
  console.log(`Saldo final: ${fmtSol(r.finalBalanceSol)} (inicial ${fmtSol(cfg.paper.startingBalanceSol)})`);
  for (const [k, b] of Object.entries(r.byStrategy)) {
    console.log(`  ${k.padEnd(12)} ${String(b.trades).padStart(4)} trades  acerto ${Math.round((b.wins / b.trades) * 100)}%  PnL ${fmtSol(b.pnlSol)}`);
  }
  console.log(`Detalhes: ${r.stateDir}/trades.jsonl`);
}

async function cmdSimulate(args: Record<string, string | boolean>) {
  const n = (k: string, d: number) => (typeof args[k] === "string" ? Number(args[k]) : d);
  let sample: Sampler;
  let label: string;
  let feeDefault = 0.3;
  if (typeof args.trades === "string") {
    const rets = returnsFromTrades(readFileSync(args.trades, "utf8").split("\n"));
    if (rets.length < 30) console.log(`⚠ Só ${rets.length} trades fechados — amostra pequena, resultado pouco confiável (ideal: 100+).`);
    sample = bootstrapSampler(rets);
    label = `seus ${rets.length} trades (${args.trades})`;
    feeDefault = 0; // o PnL registrado já desconta as taxas
  } else {
    const name = typeof args.scenario === "string" ? args.scenario : "equilibrado";
    const sc = SCENARIOS[name];
    if (!sc) throw new Error(`cenário desconhecido: ${name} (use ${Object.keys(SCENARIOS).join(", ")})`);
    sample = bucketSampler(sc.buckets);
    label = `cenário HIPOTÉTICO "${name}" — ${sc.desc}`;
  }
  const base = {
    startUsd: n("start", 100),
    targetUsd: n("target", 1000),
    floorUsd: n("floor", 40),
    betPct: n("bet", 6),
    minBetUsd: n("min-bet", 3),
    feeUsd: n("fee-usd", feeDefault),
    maxTrades: n("max-trades", 600),
    runs: n("runs", 5000),
  };
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`.padStart(6);
  console.log(`\nSimulação Monte Carlo — ${label}`);
  console.log(
    `$${base.startUsd} → meta $${base.targetUsd} | piso $${base.floorUsd} | taxa fixa $${base.feeUsd}/trade | até ${base.maxTrades} trades | ${base.runs} rodadas\n`,
  );
  console.log(" aposta  | atinge meta | quebra (piso) | nem um nem outro | trades até a meta (mediana) | EV/trade | final mediano");
  console.log("---------+-------------+---------------+------------------+-----------------------------+----------+--------------");
  const bets = [...new Set([2, 4, base.betPct, 8, 12, 20, 35])].sort((a, b) => a - b);
  for (const b of bets) {
    const r = simulate(sample, { ...base, betPct: b });
    const mark = b === base.betPct ? "→" : " ";
    console.log(
      `${mark}${String(b).padStart(5)}%  |   ${pct(r.pTarget)}    |    ${pct(r.pRuin)}     |      ${pct(r.pUnfinished)}      |            ${String(r.medianTradesToTarget ?? "-").padStart(5)}            | ${r.evPct >= 0 ? "+" : ""}${r.evPct.toFixed(1).padStart(5)}%  | $${r.medianFinal.toFixed(0)}`,
    );
  }
  const main = simulate(sample, base);
  console.log(`\nCom ${base.betPct}% por trade: crescimento log esperado ${(main.logGrowth * 100).toFixed(3)}% por trade.`);
  if (main.evPct <= 0) {
    console.log("❌ Expectativa NEGATIVA: nenhum tamanho de aposta transforma isso em lucro — só muda a velocidade da perda.");
  } else if (main.logGrowth <= 0) {
    console.log("⚠ Expectativa positiva, mas a aposta está grande demais para a volatilidade (arrasto de volatilidade): reduza --bet.");
  } else {
    const need = Math.log(base.targetUsd / base.startUsd) / main.logGrowth;
    console.log(`Trades necessários em média para ${(base.targetUsd / base.startUsd).toFixed(0)}x: ~${need.toFixed(0)}.`);
  }
  console.log("Resultados passados/hipotéticos não garantem resultados futuros.");
}

async function main() {
  const { cmd, pos, args } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case "init":
      return cmdInit();
    case "keygen":
      return cmdKeygen();
    case "check":
      return cmdCheck(args);
    case "scan":
      return cmdScan(args);
    case "run":
      return cmdRun(args);
    case "status":
      return cmdStatus(args);
    case "sell-all":
      return cmdSellAll(args);
    case "replay":
      return cmdReplay(pos, args);
    case "simulate":
      return cmdSimulate(args);
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(`Erro: ${errMsg(e)}`);
  process.exit(1);
});
