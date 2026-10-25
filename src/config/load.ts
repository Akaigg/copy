import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { ConfigSchema, type Config } from "./schema.js";

export interface Secrets {
  apiKey?: string;
  privateKeyPem?: string;
  walletAddress?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

export interface LoadedConfig {
  config: Config;
  secrets: Secrets;
  path?: string;
}

export const DEFAULT_CONFIG_PATHS = ["config/config.yaml", "config/config.yml", "config.yaml"];

/** Carrega .env (se existir), arquivo YAML de configuração e valida tudo com zod. */
export function loadConfig(path?: string, overrides: Partial<Config> = {}): LoadedConfig {
  loadDotEnv();

  let raw: unknown = {};
  let usedPath: string | undefined;
  const candidates = path ? [path] : DEFAULT_CONFIG_PATHS;
  for (const p of candidates) {
    const abs = resolve(p);
    if (existsSync(abs)) {
      raw = parseYaml(readFileSync(abs, "utf8")) ?? {};
      usedPath = abs;
      break;
    }
  }
  if (path && !usedPath) throw new Error(`Arquivo de configuração não encontrado: ${path}`);

  const merged = deepMerge(raw as Record<string, unknown>, overrides as Record<string, unknown>);
  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  return { config: parsed.data, secrets: loadSecrets(), path: usedPath };
}

export function loadSecrets(): Secrets {
  const env = process.env;
  let pem = env.GMGN_PRIVATE_KEY?.trim() ? env.GMGN_PRIVATE_KEY.replace(/\\n/g, "\n") : undefined;
  if (!pem && env.GMGN_PRIVATE_KEY_FILE?.trim()) {
    pem = readFileSync(resolve(env.GMGN_PRIVATE_KEY_FILE.trim()), "utf8");
  }
  return {
    apiKey: env.GMGN_API_KEY?.trim() || undefined,
    privateKeyPem: pem,
    walletAddress: env.GMGN_WALLET_ADDRESS?.trim() || undefined,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
    telegramChatId: env.TELEGRAM_CHAT_ID?.trim() || undefined,
  };
}

function loadDotEnv() {
  const p = resolve(".env");
  if (!existsSync(p)) return;
  const loader = (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile;
  if (loader) {
    loader(p);
    return;
  }
  // Fallback para Node sem process.loadEnvFile
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || m[1] === undefined) continue;
    let v = m[2] ?? "";
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    if (isPlainObject(cur) && isPlainObject(v)) out[k] = deepMerge(cur, v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
