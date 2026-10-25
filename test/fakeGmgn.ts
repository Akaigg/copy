import * as crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import { SOL_MINT } from "../src/core/utils.js";
import { buildMessage } from "../src/gmgn/signer.js";

export const TOKEN = "PumpTok1111111111111111111111111111111pump";
export const SIG_TOKEN = "SigTok11111111111111111111111111111111pump";

/** Servidor que imita a OpenAPI da GMGN. */
export function fakeGmgn(state: { price: number; publicKey?: crypto.KeyObject; devLaunches?: number }) {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    calls.push(url.pathname);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const ok = (data: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: 0, data }));
      };
      if (req.headers["x-apikey"] !== "test-key") {
        res.writeHead(401);
        return res.end(JSON.stringify({ code: 401, error: "AUTH" }));
      }
      if (req.headers["x-signature"] && state.publicKey) {
        const q: Record<string, string> = {};
        url.searchParams.forEach((v, k) => (q[k] = v));
        const msg = buildMessage(url.pathname, q, body, Number(q.timestamp));
        const valid = crypto.verify(null, Buffer.from(msg), state.publicKey, Buffer.from(String(req.headers["x-signature"]), "base64"));
        if (!valid) {
          res.writeHead(403);
          return res.end(JSON.stringify({ code: 403, error: "BAD_SIGNATURE" }));
        }
      }
      const now = Math.floor(Date.now() / 1000);
      switch (url.pathname) {
        case "/v1/trenches":
          return ok({
            new_creation: [
              {
                address: TOKEN,
                symbol: "MOON",
                usd_market_cap: 12000,
                total_supply: 1e9,
                price: state.price,
                liquidity: 9000,
                created_timestamp: now - 90,
                holder_count: 80,
                swaps_1m: 60,
                buys_24h: 400,
                sells_24h: 150,
                volume_1h: 15000,
                smart_degen_count: 2,
                rug_ratio: 0.05,
                top_10_holder_rate: 0.18,
                bundler_trader_amount_rate: 0.02,
                rat_trader_amount_rate: 0.02,
                dev_team_hold_rate: 0.02,
                renounced_mint: true,
                renounced_freeze_account: true,
                is_wash_trading: false,
                twitter: "https://x.com/moon",
              },
            ],
            near_completion: [],
            completed: [],
          });
        case "/v1/market/rank":
          return ok({ rank: [] });
        case "/v1/token/security":
          return ok({ rug_ratio: 0.05, renounced_mint: true, renounced_freeze_account: true, is_honeypot: "no", top_10_holder_rate: 0.18 });
        case "/v1/market/token_signal":
          return ok([
            [
              { token_address: SIG_TOKEN, signal_type: 12, trigger_at: now - 60, first_trigger_mc: 100000, market_cap: 110000, signal_times_by_type: { "12": 2 } },
              { token_address: SIG_TOKEN, signal_type: 20, trigger_at: now - 30, trigger_mc: 105000, market_cap: 110000 },
            ],
          ]);
        case "/v1/user/created_tokens":
          return ok({ inner_count: state.devLaunches ?? 3, open_count: 1, creator_ath_info: { ath_mc: "2000000" } });
        case "/v1/market/token_kline": {
          const list = Array.from({ length: 30 }, (_, i) => {
            const c = 0.0001 * (1 + i * 0.01);
            return { time: now - (30 - i) * 60, open: String(c * 0.995), close: String(c), high: String(c * 1.01), low: String(c * 0.99), amount: "1000" };
          });
          return ok({ list });
        }
        case "/v1/token/info":
          if (url.searchParams.get("address") === SOL_MINT) return ok({ address: SOL_MINT, symbol: "SOL", price: { price: "150" } });
          if (url.searchParams.get("address") === SIG_TOKEN) {
            return ok({
              address: SIG_TOKEN,
              symbol: "SIGNL",
              price: { price: "0.00011", price_5m: "0.000105", buys_1h: 800, sells_1h: 500 },
              liquidity: 40000,
              circulating_supply: 1e9,
              holder_count: 600,
              creation_timestamp: now - 7200,
              open_timestamp: now - 3600,
              launchpad_status: 2,
              dev: { creator_address: "DevGood" },
              stat: { top_10_holder_rate: 0.2 },
            });
          }
          return ok({ address: TOKEN, symbol: "MOON", price: { price: String(state.price) }, liquidity: 9000, circulating_supply: 1e9 });
        case "/v1/trade/swap":
          return ok({ order_id: "ord-1", status: "pending", hash: "tx1" });
        case "/v1/trade/query_order":
          return ok({
            order_id: "ord-1",
            status: "confirmed",
            hash: "tx1",
            report: { input_amount: "50000000", output_amount: "600000000000", output_token_decimals: 6, price_usd: "0.0000125" },
          });
        case "/v1/user/wallet_token_balance":
          return ok({ balance: "3.5" });
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  return { server, calls };
}

export async function listen(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address() as { port: number };
  return `http://127.0.0.1:${addr.port}`;
}

