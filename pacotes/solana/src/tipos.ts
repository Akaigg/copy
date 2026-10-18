export interface SaldoDeTokenNormalizado {
  indiceDaConta: number
  mint: string
  dono: string | null
  quantidadeBruta: bigint
  decimais: number
}

export interface TransacaoNormalizada {
  assinatura: string
  slot: number
  horarioDoBloco: Date | null
  falhou: boolean
  taxaLamports: number
  contas: string[]
  saldosAntesLamports: number[]
  saldosDepoisLamports: number[]
  saldosDeTokenAntes: SaldoDeTokenNormalizado[]
  saldosDeTokenDepois: SaldoDeTokenNormalizado[]
}

export interface SaldoDeTokenRpc {
  accountIndex: number
  mint: string
  owner?: string
  uiTokenAmount: { amount: string; decimals: number }
}

export type ChaveDeContaRpc = string | { pubkey: string }

export interface TransacaoRpc {
  slot: number
  blockTime?: number | null
  meta: {
    err: unknown
    fee: number
    preBalances: number[]
    postBalances: number[]
    preTokenBalances?: SaldoDeTokenRpc[] | null
    postTokenBalances?: SaldoDeTokenRpc[] | null
    loadedAddresses?: { writable: string[]; readonly: string[] } | null
  } | null
  transaction: {
    signatures: string[]
    message: { accountKeys: ChaveDeContaRpc[] }
  }
}
