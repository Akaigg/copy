import { describe, expect, it } from 'vitest'
import {
  decodificarOperacoes,
  MINT_SOL_EMBRULHADO,
  MINT_USDC,
  normalizarTransacao,
  type SaldoDeTokenRpc,
  type TransacaoRpc,
} from '../src'

const CARTEIRA = 'Trader1111111111111111111111111111111111111'
const CONTA_DO_TOKEN = 'ContaToken111111111111111111111111111111111'
const CONTA_WSOL = 'ContaWsol1111111111111111111111111111111111'
const CONTA_USDC = 'ContaUsdc1111111111111111111111111111111111'
const TOKEN = 'Memecoin1111111111111111111111111111111pump'
const PUMP_FUN = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
const BOT = 'BotPagador11111111111111111111111111111111'
const DETECCAO = new Date('2026-10-18T12:00:01Z')
const RENDA = 2_039_280
const TAXA = 105_000

function saldo(
  accountIndex: number,
  mint: string,
  amount: bigint,
  decimals = 6,
  owner = CARTEIRA,
): SaldoDeTokenRpc {
  return { accountIndex, mint, owner, uiTokenAmount: { amount: amount.toString(), decimals } }
}

function transacao(dados: {
  contas: string[]
  antes: number[]
  depois: number[]
  tokensAntes?: SaldoDeTokenRpc[]
  tokensDepois?: SaldoDeTokenRpc[]
  erro?: unknown
  taxa?: number
}): TransacaoRpc {
  return {
    slot: 300_000_000,
    blockTime: 1_792_324_800,
    meta: {
      err: dados.erro ?? null,
      fee: dados.taxa ?? TAXA,
      preBalances: dados.antes,
      postBalances: dados.depois,
      preTokenBalances: dados.tokensAntes ?? [],
      postTokenBalances: dados.tokensDepois ?? [],
      loadedAddresses: { writable: [], readonly: [] },
    },
    transaction: { signatures: ['assinatura1'], message: { accountKeys: dados.contas } },
  }
}

function decodificar(rpc: TransacaoRpc, precoSolEmUsd: number | null = 200, carteira = CARTEIRA) {
  const normalizada = normalizarTransacao(rpc)
  if (!normalizada) throw new Error('Transação inválida')
  return decodificarOperacoes(normalizada, carteira, { precoSolEmUsd, horarioDeDeteccao: DETECCAO })
}

describe('decodificador por variação de saldos', () => {
  it('identifica compra na Pump.fun com criação da conta de token', () => {
    const [operacao, ...resto] = decodificar(
      transacao({
        contas: [CARTEIRA, CONTA_DO_TOKEN, PUMP_FUN],
        antes: [10_000_000_000, 0, 1],
        depois: [10_000_000_000 - 1_000_000_000 - RENDA - TAXA, RENDA, 1],
        tokensDepois: [saldo(1, TOKEN, 35_000_000_000_000n)],
      }),
    )
    expect(resto).toHaveLength(0)
    expect(operacao).toMatchObject({
      id: `assinatura1:${CARTEIRA}:${TOKEN}`,
      tipo: 'compra',
      token: TOKEN,
      quantidadeToken: 35_000_000,
      saldoTokenAntes: 0,
      saldoTokenDepois: 35_000_000,
      saldoSolAntes: 10,
      plataforma: 'Pump.fun',
      horarioDoBloco: new Date(1_792_324_800_000),
      horarioDeDeteccao: DETECCAO,
    })
    expect(operacao?.valorSol).toBeCloseTo(1, 9)
    expect(operacao?.precoSol).toBeCloseTo(1 / 35_000_000, 15)
  })

  it('identifica venda total com fechamento da conta de token', () => {
    const [operacao] = decodificar(
      transacao({
        contas: [CARTEIRA, CONTA_DO_TOKEN, PUMP_FUN],
        antes: [2_000_000_000, RENDA, 1],
        depois: [2_000_000_000 + 1_500_000_000 + RENDA - TAXA, 0, 1],
        tokensAntes: [saldo(1, TOKEN, 35_000_000_000_000n)],
      }),
    )
    expect(operacao).toMatchObject({ tipo: 'venda', saldoTokenAntes: 35_000_000, saldoTokenDepois: 0 })
    expect(operacao?.valorSol).toBeCloseTo(1.5, 9)
  })

  it('identifica venda parcial', () => {
    const [operacao] = decodificar(
      transacao({
        contas: [CARTEIRA, CONTA_DO_TOKEN],
        antes: [1_000_000_000, RENDA],
        depois: [1_000_000_000 + 400_000_000 - TAXA, RENDA],
        tokensAntes: [saldo(1, TOKEN, 10_000_000_000n)],
        tokensDepois: [saldo(1, TOKEN, 7_500_000_000n)],
      }),
    )
    expect(operacao).toMatchObject({
      tipo: 'venda',
      quantidadeToken: 2500,
      saldoTokenAntes: 10_000,
      saldoTokenDepois: 7500,
    })
    expect(operacao?.valorSol).toBeCloseTo(0.4, 9)
  })

  it('considera SOL embrulhado como contrapartida', () => {
    const [operacao, ...resto] = decodificar(
      transacao({
        contas: [CARTEIRA, CONTA_WSOL, CONTA_DO_TOKEN, JUPITER],
        antes: [3_000_000_000, 2_000_000_000 + RENDA, RENDA, 1],
        depois: [3_000_000_000 - TAXA, 1_000_000_000 + RENDA, RENDA, 1],
        tokensAntes: [saldo(1, MINT_SOL_EMBRULHADO, 2_000_000_000n, 9), saldo(2, TOKEN, 0n)],
        tokensDepois: [saldo(1, MINT_SOL_EMBRULHADO, 1_000_000_000n, 9), saldo(2, TOKEN, 5_000_000n)],
      }),
    )
    expect(resto).toHaveLength(0)
    expect(operacao).toMatchObject({
      tipo: 'compra',
      quantidadeToken: 5,
      saldoSolAntes: 5,
      plataforma: 'Jupiter',
    })
    expect(operacao?.valorSol).toBeCloseTo(1, 9)
  })

  it('converte compras pagas em USDC para SOL', () => {
    const [operacao] = decodificar(
      transacao({
        contas: [CARTEIRA, CONTA_USDC, CONTA_DO_TOKEN],
        antes: [1_000_000_000, RENDA, RENDA],
        depois: [1_000_000_000 - TAXA, RENDA, RENDA],
        tokensAntes: [saldo(1, MINT_USDC, 500_000_000n), saldo(2, TOKEN, 0n)],
        tokensDepois: [saldo(1, MINT_USDC, 300_000_000n), saldo(2, TOKEN, 1_000_000n)],
      }),
      200,
    )
    expect(operacao?.tipo).toBe('compra')
    expect(operacao?.valorSol).toBeCloseTo(1, 9)
  })

  it('classifica como transferência quando não há preço para converter a moeda estável', () => {
    const [operacao] = decodificar(
      transacao({
        contas: [CARTEIRA, CONTA_USDC, CONTA_DO_TOKEN],
        antes: [1_000_000_000, RENDA, RENDA],
        depois: [1_000_000_000 - TAXA, RENDA, RENDA],
        tokensAntes: [saldo(1, MINT_USDC, 500_000_000n), saldo(2, TOKEN, 0n)],
        tokensDepois: [saldo(1, MINT_USDC, 300_000_000n), saldo(2, TOKEN, 1_000_000n)],
      }),
      null,
    )
    expect(operacao?.tipo).toBe('transferencia_entrada')
  })

  it('classifica envio de tokens como transferência de saída mesmo pagando a conta do destinatário', () => {
    const DESTINO = 'ContaDestino11111111111111111111111111111111'
    const [operacao] = decodificar(
      transacao({
        contas: [CARTEIRA, CONTA_DO_TOKEN, DESTINO],
        antes: [1_000_000_000, RENDA, 0],
        depois: [1_000_000_000 - RENDA - 5000, RENDA, RENDA],
        tokensAntes: [saldo(1, TOKEN, 1_000_000n)],
        tokensDepois: [saldo(1, TOKEN, 400_000n), saldo(2, TOKEN, 600_000n, 6, 'OutraCarteira')],
        taxa: 5000,
      }),
    )
    expect(operacao).toMatchObject({
      tipo: 'transferencia_saida',
      quantidadeToken: 0.6,
      valorSol: 0,
      precoSol: null,
    })
  })

  it('não desconta a taxa quando outra conta paga a transação', () => {
    const [operacao] = decodificar(
      transacao({
        contas: [BOT, CARTEIRA, CONTA_DO_TOKEN],
        antes: [5_000_000_000, 2_000_000_000, RENDA],
        depois: [5_000_000_000 - TAXA, 1_500_000_000, RENDA],
        tokensAntes: [saldo(2, TOKEN, 0n)],
        tokensDepois: [saldo(2, TOKEN, 1_000_000n)],
      }),
    )
    expect(operacao?.tipo).toBe('compra')
    expect(operacao?.valorSol).toBeCloseTo(0.5, 9)
  })

  it('ignora transações com falha e transações de outras carteiras', () => {
    const base = {
      contas: [CARTEIRA, CONTA_DO_TOKEN],
      antes: [1_000_000_000, 0],
      depois: [500_000_000, RENDA],
      tokensDepois: [saldo(1, TOKEN, 1_000_000n)],
    }
    expect(decodificar(transacao({ ...base, erro: { InstructionError: [0, 'Custom'] } }))).toEqual([])
    expect(decodificar(transacao(base), 200, 'OutraCarteira')).toEqual([])
  })

  it('normaliza chaves em formato jsonParsed e endereços de tabelas de consulta', () => {
    const rpc = transacao({ contas: [CARTEIRA], antes: [1], depois: [1] })
    const comTabela = normalizarTransacao({
      ...rpc,
      meta: rpc.meta && { ...rpc.meta, loadedAddresses: { writable: ['Escrita'], readonly: ['Leitura'] } },
    })
    expect(comTabela?.contas).toEqual([CARTEIRA, 'Escrita', 'Leitura'])

    const analisada = normalizarTransacao({
      ...rpc,
      transaction: {
        signatures: ['x'],
        message: { accountKeys: [{ pubkey: CARTEIRA }, { pubkey: 'Outra' }] },
      },
    })
    expect(analisada?.contas).toEqual([CARTEIRA, 'Outra'])
  })
})
