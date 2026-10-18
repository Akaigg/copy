import { LIMIAR_DE_POEIRA } from './fracao'
import type { Endereco, PosicaoDeCopia } from './tipos'

export interface ExecucaoDeCompra {
  quantidadeToken: number
  valorSol: number
  taxasSol: number
  executadaEm: Date
}

export interface ExecucaoDeVenda {
  quantidadeToken: number
  valorSol: number
  taxasSol: number
  executadaEm: Date
  vendaTotal: boolean
}

export interface DadosDeAbertura {
  identificador: string
  sessaoId: string
  carteira: Endereco
  token: Endereco
  decimais: number
  cicloDeOrigemId: string
  valorEntradaTraderSol: number
}

export function abrirPosicao(dados: DadosDeAbertura, execucao: ExecucaoDeCompra): PosicaoDeCopia {
  const custo = execucao.valorSol + execucao.taxasSol
  return {
    id: dados.identificador,
    sessaoId: dados.sessaoId,
    carteira: dados.carteira,
    token: dados.token,
    decimais: dados.decimais,
    cicloDeOrigemId: dados.cicloDeOrigemId,
    status: 'aberta',
    quantidade: execucao.quantidadeToken,
    custoBaseSol: custo,
    investidoSol: custo,
    retornadoSol: 0,
    resultadoRealizadoSol: 0,
    taxasSol: execucao.taxasSol,
    valorEntradaTraderSol: dados.valorEntradaTraderSol,
    valorEntradaRoboSol: execucao.valorSol,
    abertaEm: execucao.executadaEm,
    encerradaEm: null,
  }
}

export function aplicarCompraAdicional(posicao: PosicaoDeCopia, execucao: ExecucaoDeCompra): PosicaoDeCopia {
  const custo = execucao.valorSol + execucao.taxasSol
  return {
    ...posicao,
    quantidade: posicao.quantidade + execucao.quantidadeToken,
    custoBaseSol: posicao.custoBaseSol + custo,
    investidoSol: posicao.investidoSol + custo,
    taxasSol: posicao.taxasSol + execucao.taxasSol,
  }
}

export function aplicarVenda(posicao: PosicaoDeCopia, execucao: ExecucaoDeVenda): PosicaoDeCopia {
  const quantidadeVendida = Math.min(execucao.quantidadeToken, posicao.quantidade)
  const fracaoVendida = posicao.quantidade > 0 ? quantidadeVendida / posicao.quantidade : 1
  const restante = posicao.quantidade - quantidadeVendida
  const encerrou = execucao.vendaTotal || restante <= posicao.quantidade * LIMIAR_DE_POEIRA
  const custoVendido = encerrou ? posicao.custoBaseSol : posicao.custoBaseSol * fracaoVendida
  return {
    ...posicao,
    status: encerrou ? 'encerrada' : 'aberta',
    encerradaEm: encerrou ? execucao.executadaEm : null,
    quantidade: encerrou ? 0 : restante,
    custoBaseSol: posicao.custoBaseSol - custoVendido,
    retornadoSol: posicao.retornadoSol + execucao.valorSol,
    resultadoRealizadoSol:
      posicao.resultadoRealizadoSol + execucao.valorSol - custoVendido - execucao.taxasSol,
    taxasSol: posicao.taxasSol + execucao.taxasSol,
  }
}

export function resultadoPercentualDaPosicao(
  posicao: Pick<PosicaoDeCopia, 'investidoSol' | 'resultadoRealizadoSol'>,
) {
  return posicao.investidoSol > 0 ? posicao.resultadoRealizadoSol / posicao.investidoSol : 0
}
