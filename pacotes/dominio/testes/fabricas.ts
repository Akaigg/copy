import type { OperacaoDeOrigem, PosicaoDeCopia, Sessao } from '../src'

export const CARTEIRA_A = 'CarteiraA1111111111111111111111111111111111'
export const CARTEIRA_B = 'CarteiraB1111111111111111111111111111111111'
export const TOKEN_X = 'TokenX11111111111111111111111111111111111111'

export const AGORA = new Date('2026-10-18T12:00:00Z')

export function criarOperacao(dados: Partial<OperacaoDeOrigem> = {}): OperacaoDeOrigem {
  return {
    id: `assinatura:${dados.carteira ?? CARTEIRA_A}:${dados.token ?? TOKEN_X}`,
    assinatura: 'assinatura',
    carteira: CARTEIRA_A,
    token: TOKEN_X,
    tipo: 'compra',
    quantidadeToken: 1_000_000,
    decimais: 6,
    valorSol: 1,
    precoSol: 0.000001,
    saldoTokenAntes: 0,
    saldoTokenDepois: 1_000_000,
    saldoSolAntes: 10,
    plataforma: 'Pump.fun',
    slot: 1,
    horarioDoBloco: new Date(AGORA.getTime() - 1000),
    horarioDeDeteccao: AGORA,
    ...dados,
  }
}

export function criarSessao(dados: Partial<Sessao> = {}): Sessao {
  return {
    id: 'sessao-1',
    nome: 'Sessão de teste',
    modo: 'simulado',
    status: 'ativa',
    capitalInicialSol: 5,
    caixaSol: 5,
    carteiras: [{ endereco: CARTEIRA_A, fracaoDoCapital: 1, ordem: 0 }],
    estrategiaIdentificador: 'tradicional',
    estrategiaConfiguracao: {},
    estrategiaEstado: null,
    carteirasAtivas: [{ endereco: CARTEIRA_A, fracaoDoCapital: 1 }],
    dimensionamento: {
      modo: 'proporcional_ao_patrimonio',
      multiplicador: 1,
      valorFixoSol: 0.1,
      aoFaltarCapital: 'reduzir',
    },
    limites: {
      valorMinimoPorOrdemSol: 0.001,
      valorMaximoPorOrdemSol: 100,
      exposicaoMaximaPorTokenSol: 100,
      posicoesAbertasMaximas: 50,
      volumeDiarioMaximoDeComprasSol: 1000,
      idadeMaximaParaCopiarCompraSegundos: 60,
      slippageMaximoBps: 1500,
    },
    regras: { transferenciaDeSaida: 'ignorar' },
    criadaEm: AGORA,
    iniciadaEm: AGORA,
    encerradaEm: null,
    ...dados,
  }
}

export function criarPosicao(dados: Partial<PosicaoDeCopia> = {}): PosicaoDeCopia {
  return {
    id: 'posicao-1',
    sessaoId: 'sessao-1',
    carteira: CARTEIRA_A,
    token: TOKEN_X,
    decimais: 6,
    cicloDeOrigemId: 'ciclo-1',
    status: 'aberta',
    quantidade: 500_000,
    custoBaseSol: 0.5,
    investidoSol: 0.5,
    retornadoSol: 0,
    resultadoRealizadoSol: 0,
    taxasSol: 0,
    valorEntradaTraderSol: 1,
    valorEntradaRoboSol: 0.5,
    abertaEm: AGORA,
    encerradaEm: null,
    ...dados,
  }
}
