import {
  custoAbertoDaCarteira,
  custoAbertoNoToken,
  fracaoAtivaDaCarteira,
  patrimonioDeReferencia,
} from './capital'
import { calcularValorDeCompraAdicional, calcularValorDeEntrada } from './dimensionamento'
import { fracaoReduzida } from './fracao'
import type { EfeitoNoCiclo } from './livro-de-origem'
import type { LadoDaOrdem, OperacaoDeOrigem, PosicaoDeCopia, Sessao, TipoDaOrdem } from './tipos'

export interface EntradaDoPlanejamento {
  sessao: Sessao
  posicoesAbertas: PosicaoDeCopia[]
  operacao: OperacaoDeOrigem
  cicloDeOrigemId: string | null
  efeitoNoCiclo: EfeitoNoCiclo
  custoAbertoDoTraderSol: number
  comprasNasUltimas24hSol: number
  agora: Date
}

export type PlanoDeCopia =
  | {
      acao: 'comprar'
      tipo: 'entrada' | 'compra_adicional'
      valorSol: number
      posicao: PosicaoDeCopia | null
      ajustes: string[]
    }
  | {
      acao: 'vender'
      tipo: 'venda_parcial' | 'venda_total'
      fracao: number
      posicao: PosicaoDeCopia
    }
  | {
      acao: 'nao_copiar'
      lado: LadoDaOrdem
      tipo: TipoDaOrdem
      motivo: string
    }
  | {
      acao: 'ignorar'
    }

const IGNORAR: PlanoDeCopia = { acao: 'ignorar' }

export function planejarCopia(entrada: EntradaDoPlanejamento): PlanoDeCopia {
  const { sessao, operacao } = entrada
  if (sessao.status === 'encerrada') return IGNORAR

  const carteiraNaSessao = sessao.carteiras.some((carteira) => carteira.endereco === operacao.carteira)
  const posicao = localizarPosicao(entrada)
  if (!carteiraNaSessao && !posicao) return IGNORAR

  switch (operacao.tipo) {
    case 'compra':
      return planejarCompra(entrada, posicao)
    case 'venda':
      return planejarVenda(entrada, posicao)
    case 'transferencia_saida':
      return sessao.regras.transferenciaDeSaida === 'espelhar_como_venda'
        ? planejarVenda(entrada, posicao)
        : IGNORAR
    case 'transferencia_entrada':
      return IGNORAR
  }
}

function localizarPosicao({ posicoesAbertas, operacao, cicloDeOrigemId }: EntradaDoPlanejamento) {
  if (!cicloDeOrigemId) return null
  return (
    posicoesAbertas.find(
      (posicao) =>
        posicao.carteira === operacao.carteira &&
        posicao.token === operacao.token &&
        posicao.cicloDeOrigemId === cicloDeOrigemId,
    ) ?? null
  )
}

function planejarVenda(entrada: EntradaDoPlanejamento, posicao: PosicaoDeCopia | null): PlanoDeCopia {
  if (!entrada.cicloDeOrigemId) return IGNORAR
  const fracao = fracaoReduzida(entrada.operacao)
  const tipo = fracao >= 1 ? 'venda_total' : 'venda_parcial'
  if (!posicao) {
    return { acao: 'nao_copiar', lado: 'venda', tipo, motivo: 'O robô não possui posição neste ciclo' }
  }
  return { acao: 'vender', tipo, fracao, posicao }
}

function planejarCompra(entrada: EntradaDoPlanejamento, posicao: PosicaoDeCopia | null): PlanoDeCopia {
  const { sessao, operacao, efeitoNoCiclo, agora } = entrada
  const ehEntrada = efeitoNoCiclo === 'abriu'
  const tipo = ehEntrada ? 'entrada' : 'compra_adicional'
  const naoCopiar = (motivo: string): PlanoDeCopia => ({ acao: 'nao_copiar', lado: 'compra', tipo, motivo })

  if (!ehEntrada && !posicao) return naoCopiar('A entrada deste ciclo não foi copiada')
  if (sessao.status === 'pausada') return naoCopiar('Sessão pausada para novas compras')

  const idadeEmSegundos = (agora.getTime() - operacao.horarioDoBloco.getTime()) / 1000
  if (idadeEmSegundos > sessao.limites.idadeMaximaParaCopiarCompraSegundos) {
    return naoCopiar(`Operação detectada com ${Math.round(idadeEmSegundos)}s de atraso`)
  }

  if (ehEntrada) {
    const fracaoAtiva = fracaoAtivaDaCarteira(sessao, operacao.carteira)
    if (fracaoAtiva === null) return naoCopiar('Carteira inativa para novas entradas na estratégia')
    if (entrada.posicoesAbertas.length >= sessao.limites.posicoesAbertasMaximas) {
      return naoCopiar('Limite de posições abertas atingido')
    }
    const capitalAlocadoSol = patrimonioDeReferencia(sessao, entrada.posicoesAbertas) * fracaoAtiva
    const valorCalculado = calcularValorDeEntrada({
      configuracao: sessao.dimensionamento,
      operacao,
      custoAbertoDoTraderSol: entrada.custoAbertoDoTraderSol,
      capitalAlocadoSol,
    })
    const disponivelNaCarteira =
      capitalAlocadoSol - custoAbertoDaCarteira(entrada.posicoesAbertas, operacao.carteira)
    return aplicarLimites(entrada, tipo, valorCalculado, null, disponivelNaCarteira)
  }

  const posicaoExistente = posicao as PosicaoDeCopia
  const valorCalculado = calcularValorDeCompraAdicional(operacao, posicaoExistente)
  return aplicarLimites(entrada, tipo, valorCalculado, posicaoExistente, Number.POSITIVE_INFINITY)
}

function aplicarLimites(
  entrada: EntradaDoPlanejamento,
  tipo: 'entrada' | 'compra_adicional',
  valorCalculado: number,
  posicao: PosicaoDeCopia | null,
  disponivelNaCarteira: number,
): PlanoDeCopia {
  const { sessao, operacao, posicoesAbertas } = entrada
  const { limites } = sessao
  const tetos: Array<[number, string]> = [
    [limites.valorMaximoPorOrdemSol, 'limite por ordem'],
    [
      limites.exposicaoMaximaPorTokenSol - custoAbertoNoToken(posicoesAbertas, operacao.token),
      'exposição por token',
    ],
    [limites.volumeDiarioMaximoDeComprasSol - entrada.comprasNasUltimas24hSol, 'volume diário de compras'],
    [disponivelNaCarteira, 'capital alocado à carteira'],
    [sessao.caixaSol, 'saldo disponível'],
  ]

  let valor = valorCalculado
  const ajustes: string[] = []
  for (const [teto, descricao] of tetos) {
    if (valor <= teto) continue
    if (sessao.dimensionamento.aoFaltarCapital === 'nao_copiar') {
      return { acao: 'nao_copiar', lado: 'compra', tipo, motivo: `Valor acima do ${descricao}` }
    }
    valor = Math.max(0, teto)
    ajustes.push(`Reduzida pelo ${descricao}`)
  }

  if (valor < limites.valorMinimoPorOrdemSol) {
    return {
      acao: 'nao_copiar',
      lado: 'compra',
      tipo,
      motivo: `Valor de ${valor.toFixed(6)} SOL abaixo do mínimo por ordem${ajustes.length ? ` (${ajustes.join(', ')})` : ''}`,
    }
  }

  return { acao: 'comprar', tipo, valorSol: valor, posicao, ajustes }
}
