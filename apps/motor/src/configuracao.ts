import { z } from 'zod'

const opcional = z
  .string()
  .optional()
  .transform((valor) => (valor?.trim() ? valor.trim() : null))

const esquemaDoAmbiente = z.object({
  BANCO_URL: z.string().default('pglite://./dados/banco'),
  HOST: z.string().default('127.0.0.1'),
  PORTA: z.coerce.number().int().default(3001),
  PAINEL_TOKEN: opcional,
  NIVEL_DE_LOG: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  SOLANA_RPC_URL: z.string().url().default('https://api.mainnet-beta.solana.com'),
  SOLANA_WS_URL: opcional,
  FONTE_DE_TRANSACOES: z.enum(['logs', 'helius', 'desativada']).default('logs'),
  JUPITER_API_URL: z.string().url().default('https://lite-api.jup.ag'),
  JUPITER_API_CHAVE: opcional,
  EXECUTOR_SIMULADO: z.enum(['jupiter', 'referencia']).default('jupiter'),
  LATENCIA_SIMULADA_MS: z.coerce.number().min(0).default(400),
  TAXA_ESTIMADA_POR_OPERACAO_SOL: z.coerce.number().min(0).default(0.0001),
  PENALIDADE_SEM_COTACAO_BPS: z.coerce.number().min(0).default(300),
  TENTATIVAS_DE_VENDA: z.coerce.number().int().min(1).default(5),
  INTERVALO_DE_REAVALIACAO_SEGUNDOS: z.coerce.number().int().min(10).default(60),
})

export type Configuracao = ReturnType<typeof lerConfiguracao>

export function lerConfiguracao(ambiente: NodeJS.ProcessEnv = process.env) {
  const dados = esquemaDoAmbiente.parse(ambiente)
  return {
    ...dados,
    SOLANA_WS_URL: dados.SOLANA_WS_URL ?? dados.SOLANA_RPC_URL.replace(/^http/, 'ws'),
  }
}
