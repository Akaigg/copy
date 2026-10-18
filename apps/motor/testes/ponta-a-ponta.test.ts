import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResumoDaSessaoResposta } from '@hot/compartilhado'
import { ExecutorDeReferencia } from '@hot/dominio'
import type { TransacaoNormalizada } from '@hot/solana'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Aplicacao, criarAplicacao } from '../src/aplicacao'
import { lerConfiguracao } from '../src/configuracao'
import { criarRegistro } from '../src/registro'
import { ServicoDePrecosIndisponivel } from '../src/servicos/servico-de-precos'

const CARTEIRA_A = 'AAAAzcVxPS1ZBwJKX4mDSkmJ9c8YzUwBDjkFpJ1wDbtg'
const CARTEIRA_B = 'BBBBzcVxPS1ZBwJKX4mDSkmJ9c8YzUwBDjkFpJ1wDbtg'
const TOKEN = 'TokenzcVxPS1ZBwJKX4mDSkmJ9c8YzUwBDjkFpJ1pump'
const CONTA_DO_TOKEN = 'ContazcVxPS1ZBwJKX4mDSkmJ9c8YzUwBDjkFpJ1wDbt'
const LAMPORTS = 1_000_000_000

let aplicacao: Aplicacao
let contador = 0

beforeEach(async () => {
  const configuracao = lerConfiguracao({ BANCO_URL: 'pglite://memoria', FONTE_DE_TRANSACOES: 'desativada' })
  aplicacao = await criarAplicacao(configuracao, criarRegistro('error', false), {
    executor: new ExecutorDeReferencia({ penalidadeDePrecoBps: 100, taxaPorOperacaoSol: 0.0001 }),
    precos: new ServicoDePrecosIndisponivel(),
    fonte: null,
    rpc: null,
    esperar: async () => {},
    pastaDoPainel: null,
  })
  await aplicacao.iniciar(false)
})

afterEach(() => aplicacao.parar())

function swap(
  carteira: string,
  dados: { solAntes: number; solDepois: number; tokenAntes: number; tokenDepois: number; token?: string },
): TransacaoNormalizada {
  const token = dados.token ?? TOKEN
  const saldo = (quantidade: number) => ({
    indiceDaConta: 1,
    mint: token,
    dono: carteira,
    quantidadeBruta: BigInt(Math.round(quantidade * 1e6)),
    decimais: 6,
  })
  return {
    assinatura: `assinatura-${++contador}`,
    slot: 1000 + contador,
    horarioDoBloco: new Date(),
    falhou: false,
    taxaLamports: 0,
    contas: [carteira, CONTA_DO_TOKEN],
    saldosAntesLamports: [Math.round(dados.solAntes * LAMPORTS), 2_039_280],
    saldosDepoisLamports: [Math.round(dados.solDepois * LAMPORTS), 2_039_280],
    saldosDeTokenAntes: [saldo(dados.tokenAntes)],
    saldosDeTokenDepois: [saldo(dados.tokenDepois)],
  }
}

async function enviar(transacao: TransacaoNormalizada, carteira = CARTEIRA_A) {
  await aplicacao.processador.receber({
    assinatura: transacao.assinatura,
    carteiras: [carteira],
    transacao,
    recebidaEm: new Date(),
  })
  await aplicacao.motor.aguardarOcioso()
}

async function requisitar<T>(metodo: 'GET' | 'POST' | 'PUT', url: string, corpo?: unknown) {
  const resposta = await aplicacao.servidor.inject({ method: metodo, url, payload: corpo as object })
  return { status: resposta.statusCode, corpo: resposta.json() as T }
}

async function criarSessao(configuracao: Record<string, unknown>) {
  const { status, corpo } = await requisitar<{ id: string }>('POST', '/api/sessoes', {
    nome: 'Teste',
    capitalInicialSol: 5,
    configuracao,
  })
  expect(status).toBe(201)
  return corpo.id
}

describe('fluxo completo de cópia simulada', () => {
  it('espelha entrada, compra adicional e vendas parciais com proporção e resultado', async () => {
    const sessaoId = await criarSessao({ carteiras: [{ endereco: CARTEIRA_A, fracaoDoCapital: 1 }] })

    await enviar(swap(CARTEIRA_A, { solAntes: 10, solDepois: 9, tokenAntes: 0, tokenDepois: 1_000_000 }))
    await enviar(
      swap(CARTEIRA_A, { solAntes: 9, solDepois: 8.5, tokenAntes: 1_000_000, tokenDepois: 1_500_000 }),
    )
    await enviar(
      swap(CARTEIRA_A, { solAntes: 8.5, solDepois: 9.5, tokenAntes: 1_500_000, tokenDepois: 750_000 }),
    )

    const abertas = await requisitar<Array<{ quantidade: number; investidoSol: number }>>(
      'GET',
      `/api/sessoes/${sessaoId}/posicoes?status=aberta`,
    )
    expect(abertas.corpo).toHaveLength(1)
    expect(abertas.corpo[0]?.investidoSol).toBeCloseTo(0.75 + 0.0002, 6)
    const quantidadeComprada = 0.5 / (0.000001 * 1.01) + 0.25 / (0.000001 * 1.01)
    expect(abertas.corpo[0]?.quantidade).toBeCloseTo(quantidadeComprada / 2, 0)

    await enviar(swap(CARTEIRA_A, { solAntes: 9.5, solDepois: 10.5, tokenAntes: 750_000, tokenDepois: 0 }))

    const resumo = await requisitar<ResumoDaSessaoResposta>('GET', `/api/sessoes/${sessaoId}`)
    expect(resumo.corpo.posicoesAbertas).toBe(0)
    expect(resumo.corpo.metricasDoRobo).toMatchObject({ quantidadeDeCiclos: 1, acertos: 1 })
    expect(resumo.corpo.ordensPorStatus).toEqual({ executada: 4 })
    expect(resumo.corpo.resultadoRealizadoSol).toBeCloseTo(
      (0.75 / 1.01) * (4 / 3) * 0.99 - 0.7502 - 0.0002,
      6,
    )
    expect(resumo.corpo.sessao.caixaSol).toBeCloseTo(5 + resumo.corpo.resultadoRealizadoSol, 9)

    const comparacao = await requisitar<
      Array<{ resultadoDoTraderPercentual: number; resultadoDoRoboPercentual: number }>
    >('GET', `/api/sessoes/${sessaoId}/comparacao`)
    expect(comparacao.corpo[0]?.resultadoDoTraderPercentual).toBeCloseTo(2 / 1.5 - 1, 6)
    expect(comparacao.corpo[0]?.resultadoDoRoboPercentual).toBeLessThan(
      comparacao.corpo[0]?.resultadoDoTraderPercentual ?? 0,
    )

    const curva = await requisitar<Array<{ resultadoAcumuladoSol: number }>>(
      'GET',
      `/api/sessoes/${sessaoId}/curva`,
    )
    expect(curva.corpo.at(-1)?.resultadoAcumuladoSol).toBeCloseTo(resumo.corpo.resultadoRealizadoSol, 9)

    const carteiras = await requisitar<Array<{ endereco: string; metricas: { quantidadeDeCiclos: number } }>>(
      'GET',
      '/api/carteiras',
    )
    expect(carteiras.corpo.find((c) => c.endereco === CARTEIRA_A)?.metricas.quantidadeDeCiclos).toBe(1)
  })

  it('não duplica operações nem ordens ao receber a mesma transação duas vezes', async () => {
    const sessaoId = await criarSessao({ carteiras: [{ endereco: CARTEIRA_A, fracaoDoCapital: 1 }] })
    const transacao = swap(CARTEIRA_A, { solAntes: 10, solDepois: 9, tokenAntes: 0, tokenDepois: 1_000_000 })
    await enviar(transacao)
    await enviar(transacao)
    const ordens = await requisitar<unknown[]>('GET', `/api/sessoes/${sessaoId}/ordens`)
    const operacoes = await requisitar<unknown[]>('GET', '/api/operacoes')
    expect(ordens.corpo).toHaveLength(1)
    expect(operacoes.corpo).toHaveLength(1)
  })

  it('registra como não copiadas as operações de ciclos anteriores à sessão', async () => {
    await requisitar('POST', '/api/carteiras', { endereco: CARTEIRA_A })
    await enviar(swap(CARTEIRA_A, { solAntes: 10, solDepois: 9, tokenAntes: 0, tokenDepois: 1_000_000 }))
    const sessaoId = await criarSessao({ carteiras: [{ endereco: CARTEIRA_A, fracaoDoCapital: 1 }] })
    await enviar(swap(CARTEIRA_A, { solAntes: 9, solDepois: 10, tokenAntes: 1_000_000, tokenDepois: 0 }))
    const ordens = await requisitar<Array<{ status: string; motivo: string }>>(
      'GET',
      `/api/sessoes/${sessaoId}/ordens`,
    )
    expect(ordens.corpo).toMatchObject([
      { status: 'nao_copiada', motivo: 'O robô não possui posição neste ciclo' },
    ])
  })

  it('pausa a carteira após perdas consecutivas e passa a copiar a próxima da fila', async () => {
    const sessaoId = await criarSessao({
      carteiras: [
        { endereco: CARTEIRA_A, fracaoDoCapital: 0.5 },
        { endereco: CARTEIRA_B, fracaoDoCapital: 0.5 },
      ],
      estrategiaIdentificador: 'rotacao_por_perdas_consecutivas',
      estrategiaConfiguracao: { limiteDePerdasConsecutivas: 2 },
    })

    for (let ciclo = 0; ciclo < 2; ciclo++) {
      await enviar(swap(CARTEIRA_A, { solAntes: 10, solDepois: 9, tokenAntes: 0, tokenDepois: 1_000_000 }))
      await enviar(swap(CARTEIRA_A, { solAntes: 9, solDepois: 9.5, tokenAntes: 1_000_000, tokenDepois: 0 }))
    }

    const desempenho = await requisitar<
      Array<{ endereco: string; ativa: unknown; metricasDoRobo: { perdas: number } }>
    >('GET', `/api/sessoes/${sessaoId}/carteiras`)
    expect(desempenho.corpo.find((c) => c.endereco === CARTEIRA_A)).toMatchObject({
      ativa: null,
      metricasDoRobo: { perdas: 2 },
    })
    expect(desempenho.corpo.find((c) => c.endereco === CARTEIRA_B)?.ativa).toMatchObject({
      fracaoDoCapital: 1,
    })

    await enviar(swap(CARTEIRA_A, { solAntes: 10, solDepois: 9, tokenAntes: 0, tokenDepois: 1_000_000 }))
    await enviar(
      swap(CARTEIRA_B, { solAntes: 10, solDepois: 9, tokenAntes: 0, tokenDepois: 1_000_000 }),
      CARTEIRA_B,
    )
    const ordens = await requisitar<Array<{ carteira: string; status: string; tipo: string }>>(
      'GET',
      `/api/sessoes/${sessaoId}/ordens`,
    )
    const resumir = (carteira: string) =>
      ordens.corpo
        .filter((ordem) => ordem.carteira === carteira)
        .map((ordem) => `${ordem.tipo}:${ordem.status}`)
        .sort()
    expect(resumir(CARTEIRA_A)).toEqual([
      'entrada:executada',
      'entrada:executada',
      'entrada:nao_copiada',
      'venda_total:executada',
      'venda_total:executada',
    ])
    expect(resumir(CARTEIRA_B)).toEqual(['entrada:executada'])

    const decisoes = await requisitar<Array<{ motivo: string }>>('GET', `/api/sessoes/${sessaoId}/decisoes`)
    expect(decisoes.corpo.some((decisao) => decisao.motivo.includes('pausada após 2 perdas'))).toBe(true)
  })

  it('mantém as vendas com a sessão pausada', async () => {
    const sessaoId = await criarSessao({ carteiras: [{ endereco: CARTEIRA_A, fracaoDoCapital: 1 }] })
    await enviar(swap(CARTEIRA_A, { solAntes: 10, solDepois: 9, tokenAntes: 0, tokenDepois: 1_000_000 }))
    expect((await requisitar('POST', `/api/sessoes/${sessaoId}/status`, { status: 'pausada' })).status).toBe(
      200,
    )

    await enviar(
      swap(CARTEIRA_A, { solAntes: 9, solDepois: 8, tokenAntes: 1_000_000, tokenDepois: 2_000_000 }),
    )
    await enviar(
      swap(CARTEIRA_A, { solAntes: 8, solDepois: 9, tokenAntes: 2_000_000, tokenDepois: 1_000_000 }),
    )

    const ordens = await requisitar<Array<{ tipo: string; status: string }>>(
      'GET',
      `/api/sessoes/${sessaoId}/ordens`,
    )
    expect(ordens.corpo.map((ordem) => `${ordem.tipo}:${ordem.status}`).sort()).toEqual([
      'compra_adicional:nao_copiada',
      'entrada:executada',
      'venda_parcial:executada',
    ])
  })

  it('retoma posições e caixa após reiniciar o motor', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'hot-crypto-'))
    const iniciar = async () => {
      const app = await criarAplicacao(
        lerConfiguracao({ BANCO_URL: `pglite://${pasta}`, FONTE_DE_TRANSACOES: 'desativada' }),
        criarRegistro('error', false),
        {
          executor: new ExecutorDeReferencia({ penalidadeDePrecoBps: 0, taxaPorOperacaoSol: 0 }),
          precos: new ServicoDePrecosIndisponivel(),
          fonte: null,
          rpc: null,
          pastaDoPainel: null,
        },
      )
      await app.iniciar(false)
      return app
    }
    const primeira = await iniciar()
    const sessao = await primeira.contexto.criarSessao({
      nome: 'Persistente',
      capitalInicialSol: 2,
      configuracao: { carteiras: [{ endereco: CARTEIRA_A, fracaoDoCapital: 1 }] },
    })
    const compra = swap(CARTEIRA_A, { solAntes: 10, solDepois: 9, tokenAntes: 0, tokenDepois: 1_000_000 })
    await primeira.processador.receber({
      assinatura: compra.assinatura,
      carteiras: [CARTEIRA_A],
      transacao: compra,
      recebidaEm: new Date(),
    })
    await primeira.motor.aguardarOcioso()
    await primeira.parar()

    const segunda = await iniciar()
    const venda = swap(CARTEIRA_A, { solAntes: 9, solDepois: 11, tokenAntes: 1_000_000, tokenDepois: 0 })
    await segunda.processador.receber({
      assinatura: venda.assinatura,
      carteiras: [CARTEIRA_A],
      transacao: venda,
      recebidaEm: new Date(),
    })
    await segunda.motor.aguardarOcioso()
    const resumo = await segunda.contexto.consultas.resumirSessao(sessao.id)
    await segunda.parar()
    rmSync(pasta, { recursive: true, force: true })

    expect(resumo.posicoesAbertas).toBe(0)
    expect(resumo.resultadoRealizadoSol).toBeCloseTo(0.2, 9)
    expect(resumo.sessao.caixaSol).toBeCloseTo(2.2, 9)
  })

  it('valida os dados de entrada da API', async () => {
    const carteiraInvalida = await requisitar<{ erro: string }>('POST', '/api/carteiras', {
      endereco: 'invalido',
    })
    expect(carteiraInvalida.status).toBe(400)
    expect(carteiraInvalida.corpo.erro).toMatch(/Endereço Solana inválido/)

    const fracoesInvalidas = await requisitar<{ erro: string }>('POST', '/api/sessoes', {
      nome: 'x',
      capitalInicialSol: 1,
      configuracao: {
        carteiras: [
          { endereco: CARTEIRA_A, fracaoDoCapital: 0.8 },
          { endereco: CARTEIRA_B, fracaoDoCapital: 0.8 },
        ],
      },
    })
    expect(fracoesInvalidas.status).toBe(400)

    const estrategiaInvalida = await requisitar('POST', '/api/sessoes', {
      nome: 'x',
      capitalInicialSol: 1,
      configuracao: {
        carteiras: [{ endereco: CARTEIRA_A, fracaoDoCapital: 1 }],
        estrategiaIdentificador: 'rotacao_por_perdas_consecutivas',
        estrategiaConfiguracao: { limiteDePerdasConsecutivas: 0 },
      },
    })
    expect(estrategiaInvalida.status).toBe(400)

    const estrategias = await requisitar<Array<{ identificador: string }>>('GET', '/api/estrategias')
    expect(estrategias.corpo).toHaveLength(3)
  })
})
