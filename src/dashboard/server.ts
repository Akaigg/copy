import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Config } from "../config/schema.js";
import type { Logger } from "../core/logger.js";
import { errMsg } from "../core/utils.js";
import type { Engine } from "../engine.js";

/**
 * Painel web local (http://127.0.0.1:8787):
 *  GET  /             página com posições, PnL e trades (atualiza sozinha)
 *  GET  /api/status   JSON completo
 *  POST /api/pause | /api/resume | /api/sell-all   (exigem header X-Auth-Token)
 */
export function startDashboard(engine: Engine, cfg: Config["dashboard"], log: Logger): Server {
  const server = createServer(async (req, res) => {
    try {
      await handle(engine, cfg, req, res);
    } catch (e) {
      send(res, 500, { error: errMsg(e) });
    }
  });
  server.on("error", (e) => log.error(`Dashboard: ${errMsg(e)}`));
  server.listen(cfg.port, cfg.host, () => log.info(`Painel em http://${cfg.host}:${cfg.port}`));
  return server;
}

async function handle(engine: Engine, cfg: Config["dashboard"], req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/api/status") return send(res, 200, await engine.status());
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(PAGE);
  }
  if (req.method === "POST" && url.pathname.startsWith("/api/")) {
    if (!cfg.authToken) return send(res, 403, { error: "defina dashboard.authToken para habilitar ações" });
    const given = Buffer.from(String(req.headers["x-auth-token"] ?? ""));
    const expected = Buffer.from(cfg.authToken);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return send(res, 401, { error: "token inválido" });
    switch (url.pathname) {
      case "/api/pause":
        engine.pause(true);
        return send(res, 200, { ok: true });
      case "/api/resume":
        engine.pause(false);
        return send(res, 200, { ok: true });
      case "/api/sell-all":
        void engine.sellAll("painel: vender tudo");
        return send(res, 202, { ok: true });
    }
  }
  send(res, 404, { error: "not found" });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const PAGE = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GMGN Hot Bot</title>
<style>
:root{--bg:#0e1116;--fg:#e6e6e6;--mut:#8b949e;--card:#161b22;--line:#30363d;--up:#3fb950;--down:#f85149;--acc:#58a6ff}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg);padding:16px}
h1{font-size:18px;margin:0 0 12px}h2{font-size:15px;margin:20px 0 8px;color:var(--mut)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px}
.card b{display:block;font-size:18px;margin-top:2px}.mut{color:var(--mut);font-size:12px}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:640px}
th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{color:var(--mut);font-weight:500}
.up{color:var(--up)}.down{color:var(--down)}a{color:var(--acc)}.warn{color:#d29922}
button{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:6px 10px;cursor:pointer;margin-right:6px}
</style></head><body>
<h1>🤖 GMGN Hot Bot <span id="mode" class="mut"></span></h1>
<div id="block" class="warn"></div>
<div class="grid" id="cards"></div>
<h2>Posições abertas</h2><div class="wrap"><table id="pos"></table></div>
<h2>Últimos trades</h2><div class="wrap"><table id="trades"></table></div>
<h2>Ações</h2>
<input id="tok" placeholder="auth token" type="password"> <button onclick="act('pause')">Pausar compras</button><button onclick="act('resume')">Retomar</button><button onclick="if(confirm('Vender TUDO?'))act('sell-all')">Vender tudo</button>
<script>
const f=(v,d=4)=>v==null?'-':Number(v).toFixed(d);
const cls=v=>v>=0?'up':'down';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function act(a){const r=await fetch('/api/'+a,{method:'POST',headers:{'X-Auth-Token':document.getElementById('tok').value}});alert((await r.json()).error||'ok')}
async function load(){
 try{const s=await (await fetch('/api/status')).json();
 document.getElementById('mode').textContent='modo '+s.mode.toUpperCase();
 document.getElementById('block').textContent=s.blockReason?'⛔ Compras bloqueadas: '+s.blockReason:'';
 const wr=s.totals.trades?Math.round(s.totals.wins/s.totals.trades*100):0;
 document.getElementById('cards').innerHTML=[
  ['Saldo',f(s.balanceSol)+' SOL'],['PnL hoje','<span class="'+cls(s.daily.realizedPnlSol)+'">'+f(s.daily.realizedPnlSol)+' SOL</span>'],
  ['PnL total','<span class="'+cls(s.totals.realizedPnlSol)+'">'+f(s.totals.realizedPnlSol)+' SOL</span>'],
  ['Trades / acerto',s.totals.trades+' / '+wr+'%'],['Tokens monitorados',s.tokensTracked],['SOL',s.solPriceUsd?'$'+f(s.solPriceUsd,2):'-']
 ].map(([k,v])=>'<div class="card"><span class="mut">'+k+'</span><b>'+v+'</b></div>').join('');
 document.getElementById('pos').innerHTML='<tr><th>Token</th><th>Estratégia</th><th>Entrada</th><th>Atual</th><th>PnL</th><th>Valor</th><th>Aberta há</th><th>TPs</th></tr>'+
  s.positions.map(p=>'<tr><td><a target="_blank" href="https://gmgn.ai/sol/token/'+esc(p.tokenAddress)+'">'+esc(p.symbol)+'</a></td><td>'+esc(p.strategyId)+'</td><td>$'+Number(p.entryPriceUsd).toPrecision(4)+'</td><td>$'+Number(p.lastPriceUsd).toPrecision(4)+'</td><td class="'+cls(p.pnlPct)+'">'+f(p.pnlPct,1)+'%</td><td>'+f(p.valueSol)+' SOL</td><td>'+Math.round((s.now-p.openedAt)/60000)+' min</td><td>'+p.tpHits.length+'</td></tr>').join('');
 document.getElementById('trades').innerHTML='<tr><th>Hora</th><th>Lado</th><th>Token</th><th>Estratégia</th><th>SOL</th><th>PnL</th><th>Motivo</th></tr>'+
  s.recentTrades.map(t=>'<tr><td>'+new Date(t.ts).toLocaleTimeString()+'</td><td class="'+(t.side==='buy'?'up':'down')+'">'+t.side+'</td><td>'+esc(t.symbol)+'</td><td>'+esc(t.strategyId)+'</td><td>'+f(t.sol)+'</td><td class="'+cls(t.pnlSol??0)+'">'+(t.pnlSol==null?'':f(t.pnlSol)+' ('+f(t.pnlPct,1)+'%)')+'</td><td>'+esc((t.reason||'').slice(0,60))+'</td></tr>').join('');
 }catch(e){document.getElementById('block').textContent='Sem conexão com o robô'}
}
load();setInterval(load,3000);
</script></body></html>`;
