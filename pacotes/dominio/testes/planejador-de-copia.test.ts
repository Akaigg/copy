import { describe, expect, it } from 'vitest'
import { type EntradaDoPlanejamento, planejarCopia } from '../src'
import { AGORA, CARTEIRA_A, CARTEIRA_B, criarOperacao, criarPosicao, criarSessao } from './fabricas'

function entrada(dados: Partial<EntradaDoPlanejamento> = {}): EntradaDoPlanejamento {
  return {
    sessao: criarSessao(),
    posicoesAbertas: [],
    operacao: criarOperacao(),
    cicloDeOrigemId: 'ciclo-1',
    efeitoNoCiclo: 'abriu',
    custoAbertoDoTraderSol: 0,
    comprasNasUltimas24hSol: 0,
    agora: AGORA,
    ...dados,
  }
}

describe('entradas', () => {
  it('copia a entrada proporcional ao patrimônio do trader', () => {
    const plano = planejarCopia(entrada())
    expect(plano).toMatchObject({
      acao: 'comprar',
      tipo: 'entrada',
      valorSol: 0.5,
      posicao: null,
      ajustes: [],
    })
  })

  it('considera o custo das posições abertas no patrimônio do trader', () => {
    const plano = planejarCopia(entrada({ custoAbertoDoTraderSol: 10 }))
    expect(plano).toMatchObject({ acao: 'comprar', valorSol: 0.25 })
  })

  it('aplica a fração de capital da carteira ativa', () => {
    const sessao = criarSessao({ carteirasAtivas: [{ endereco: CARTEIRA_A, fracaoDoCapital: 0.5 }] })
    expect(planejarCopia(entrada({ sessao }))).toMatchObject({ acao: 'comprar', valorSol: 0.25 })
  })

  it('usa multiplicador fixo e valor fixo', () => {
    const multiplicador = criarSessao({
      dimensionamento: {
        modo: 'multiplicador_fixo',
        multiplicador: 0.1,
        valorFixoSol: 0,
        aoFaltarCapital: 'reduzir',
      },
    })
    expect(planejarCopia(entrada({ sessao: multiplicador }))).toMatchObject({ valorSol: 0.1 })
    const fixo = criarSessao({
      dimensionamento: {
        modo: 'valor_fixo',
        multiplicador: 1,
        valorFixoSol: 0.2,
        aoFaltarCapital: 'reduzir',
      },
    })
    expect(planejarCopia(entrada({ sessao: fixo }))).toMatchObject({ valorSol: expect.closeTo(0.2) })
  })

  it('não copia entradas de carteiras inativas na estratégia', () => {
    const sessao = criarSessao({ carteirasAtivas: [] })
    expect(planejarCopia(entrada({ sessao }))).toMatchObject({ acao: 'nao_copiar', tipo: 'entrada' })
  })

  it('ignora carteiras que não pertencem à sessão', () => {
    const operacao = criarOperacao({ carteira: CARTEIRA_B })
    expect(planejarCopia(entrada({ operacao }))).toEqual({ acao: 'ignorar' })
  })

  it('não copia compras detectadas com atraso acima do limite', () => {
    const operacao = criarOperacao({ horarioDoBloco: new Date(AGORA.getTime() - 120_000) })
    expect(planejarCopia(entrada({ operacao }))).toMatchObject({ acao: 'nao_copiar' })
  })

  it('não copia compras com a sessão pausada', () => {
    const sessao = criarSessao({ status: 'pausada' })
    expect(planejarCopia(entrada({ sessao }))).toMatchObject({
      acao: 'nao_copiar',
      motivo: expect.stringMatching(/pausada/),
    })
  })

  it('respeita o limite de posições abertas', () => {
    const sessao = criarSessao({ limites: { ...criarSessao().limites, posicoesAbertasMaximas: 1 } })
    const posicoesAbertas = [criarPosicao({ cicloDeOrigemId: 'outro', token: 'Outro' })]
    expect(planejarCopia(entrada({ sessao, posicoesAbertas }))).toMatchObject({ acao: 'nao_copiar' })
  })
})

describe('limites e capital', () => {
  it('reduz a ordem ao limite máximo e registra o ajuste', () => {
    const sessao = criarSessao({ limites: { ...criarSessao().limites, valorMaximoPorOrdemSol: 0.3 } })
    expect(planejarCopia(entrada({ sessao }))).toMatchObject({
      acao: 'comprar',
      valorSol: 0.3,
      ajustes: ['Reduzida pelo limite por ordem'],
    })
  })

  it('não copia quando configurado para não reduzir', () => {
    const sessao = criarSessao({
      limites: { ...criarSessao().limites, valorMaximoPorOrdemSol: 0.3 },
      dimensionamento: { ...criarSessao().dimensionamento, aoFaltarCapital: 'nao_copiar' },
    })
    expect(planejarCopia(entrada({ sessao }))).toMatchObject({ acao: 'nao_copiar' })
  })

  it('limita a compra ao saldo disponível da sessão', () => {
    const sessao = criarSessao({ caixaSol: 0.1 })
    const posicoesAbertas = [criarPosicao({ token: 'Outro', cicloDeOrigemId: 'outro', custoBaseSol: 4.9 })]
    expect(planejarCopia(entrada({ sessao, posicoesAbertas }))).toMatchObject({
      acao: 'comprar',
      valorSol: expect.closeTo(0.1),
    })
  })

  it('não copia ordens abaixo do valor mínimo', () => {
    const operacao = criarOperacao({ valorSol: 0.0001 })
    expect(planejarCopia(entrada({ operacao }))).toMatchObject({
      acao: 'nao_copiar',
      motivo: expect.stringMatching(/mínimo/),
    })
  })

  it('limita pelo volume diário de compras', () => {
    const sessao = criarSessao({ limites: { ...criarSessao().limites, volumeDiarioMaximoDeComprasSol: 1 } })
    expect(planejarCopia(entrada({ sessao, comprasNasUltimas24hSol: 0.8 }))).toMatchObject({
      valorSol: expect.closeTo(0.2),
    })
  })
})

describe('compras adicionais', () => {
  it('copia na mesma proporção da entrada', () => {
    const posicao = criarPosicao()
    const operacao = criarOperacao({ valorSol: 0.5, saldoTokenAntes: 1_000_000, saldoTokenDepois: 1_500_000 })
    const plano = planejarCopia(entrada({ operacao, efeitoNoCiclo: 'atualizou', posicoesAbertas: [posicao] }))
    expect(plano).toMatchObject({ acao: 'comprar', tipo: 'compra_adicional', valorSol: 0.25, posicao })
  })

  it('continua copiando compras adicionais de carteira desativada pela estratégia', () => {
    const sessao = criarSessao({ carteirasAtivas: [] })
    const plano = planejarCopia(
      entrada({
        sessao,
        efeitoNoCiclo: 'atualizou',
        posicoesAbertas: [criarPosicao()],
        operacao: criarOperacao({ valorSol: 1 }),
      }),
    )
    expect(plano).toMatchObject({ acao: 'comprar', tipo: 'compra_adicional', valorSol: 0.5 })
  })

  it('não copia compra adicional de ciclo cuja entrada não foi copiada', () => {
    expect(planejarCopia(entrada({ efeitoNoCiclo: 'atualizou' }))).toMatchObject({
      acao: 'nao_copiar',
      tipo: 'compra_adicional',
    })
  })
})

describe('vendas', () => {
  const venda = (dados = {}) =>
    criarOperacao({
      tipo: 'venda',
      quantidadeToken: 300_000,
      saldoTokenAntes: 1_000_000,
      saldoTokenDepois: 700_000,
      ...dados,
    })

  it('espelha a venda parcial pela fração vendida pelo trader', () => {
    const posicao = criarPosicao()
    const plano = planejarCopia(
      entrada({ operacao: venda(), efeitoNoCiclo: 'atualizou', posicoesAbertas: [posicao] }),
    )
    expect(plano).toMatchObject({ acao: 'vender', tipo: 'venda_parcial', posicao })
    expect(plano.acao === 'vender' && plano.fracao).toBeCloseTo(0.3)
  })

  it('espelha a venda total', () => {
    const operacao = venda({ quantidadeToken: 1_000_000, saldoTokenDepois: 0 })
    const plano = planejarCopia(
      entrada({ operacao, efeitoNoCiclo: 'encerrou', posicoesAbertas: [criarPosicao()] }),
    )
    expect(plano).toMatchObject({ acao: 'vender', tipo: 'venda_total', fracao: 1 })
  })

  it('vende mesmo com a sessão pausada e a carteira inativa', () => {
    const sessao = criarSessao({ status: 'pausada', carteirasAtivas: [] })
    const plano = planejarCopia(entrada({ sessao, operacao: venda(), posicoesAbertas: [criarPosicao()] }))
    expect(plano).toMatchObject({ acao: 'vender' })
  })

  it('vende posições de carteira removida da sessão', () => {
    const sessao = criarSessao({ carteiras: [] })
    const plano = planejarCopia(entrada({ sessao, operacao: venda(), posicoesAbertas: [criarPosicao()] }))
    expect(plano).toMatchObject({ acao: 'vender' })
  })

  it('registra venda sem posição como não copiada', () => {
    expect(planejarCopia(entrada({ operacao: venda() }))).toMatchObject({ acao: 'nao_copiar', lado: 'venda' })
  })

  it('separa posições de carteiras diferentes no mesmo token', () => {
    const sessao = criarSessao({
      carteiras: [
        { endereco: CARTEIRA_A, fracaoDoCapital: 0.5, ordem: 0 },
        { endereco: CARTEIRA_B, fracaoDoCapital: 0.5, ordem: 1 },
      ],
    })
    const posicaoDeB = criarPosicao({ id: 'posicao-b', carteira: CARTEIRA_B, cicloDeOrigemId: 'ciclo-b' })
    const posicaoDeA = criarPosicao({ id: 'posicao-a' })
    const plano = planejarCopia(
      entrada({ sessao, operacao: venda(), posicoesAbertas: [posicaoDeB, posicaoDeA] }),
    )
    expect(plano).toMatchObject({ acao: 'vender', posicao: { id: 'posicao-a' } })
  })

  it('ignora transferências de saída por padrão e espelha quando configurado', () => {
    const operacao = venda({ tipo: 'transferencia_saida', valorSol: 0 })
    const posicoesAbertas = [criarPosicao()]
    expect(planejarCopia(entrada({ operacao, posicoesAbertas }))).toEqual({ acao: 'ignorar' })
    const sessao = criarSessao({ regras: { transferenciaDeSaida: 'espelhar_como_venda' } })
    expect(planejarCopia(entrada({ sessao, operacao, posicoesAbertas }))).toMatchObject({ acao: 'vender' })
  })
})
