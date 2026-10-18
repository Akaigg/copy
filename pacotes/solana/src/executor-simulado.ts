import {
  type Executor,
  ExecutorDeReferencia,
  type ModoDaSessao,
  type PedidoDeExecucao,
  type ResultadoDaExecucao,
} from '@hot/dominio'
import { LAMPORTS_POR_SOL, MINT_SOL_EMBRULHADO } from './constantes'
import type { ClienteJupiter } from './jupiter'

export interface ConfiguracaoDoExecutorSimulado {
  jupiter: ClienteJupiter
  latenciaAdicionalMs: number
  taxaPorOperacaoSol: number
  usarPrecoDoTraderSemCotacao: boolean
  penalidadeSemCotacaoBps: number
}

function paraBruto(quantidade: number, decimais: number) {
  return BigInt(Math.floor(quantidade * 10 ** decimais))
}

export class ExecutorSimuladoJupiter implements Executor {
  readonly modo: ModoDaSessao = 'simulado'
  private readonly reserva: ExecutorDeReferencia

  constructor(private readonly configuracao: ConfiguracaoDoExecutorSimulado) {
    this.reserva = new ExecutorDeReferencia({
      penalidadeDePrecoBps: configuracao.penalidadeSemCotacaoBps,
      taxaPorOperacaoSol: configuracao.taxaPorOperacaoSol,
    })
  }

  async executar(pedido: PedidoDeExecucao): Promise<ResultadoDaExecucao> {
    if (this.configuracao.latenciaAdicionalMs > 0) {
      await new Promise((resolver) => setTimeout(resolver, this.configuracao.latenciaAdicionalMs))
    }
    try {
      return pedido.lado === 'compra' ? await this.simularCompra(pedido) : await this.simularVenda(pedido)
    } catch (erro) {
      if (this.configuracao.usarPrecoDoTraderSemCotacao) {
        const resultado = await this.reserva.executar(pedido)
        if (resultado.sucesso) return resultado
      }
      return { sucesso: false, erro: erro instanceof Error ? erro.message : String(erro) }
    }
  }

  private async simularCompra(pedido: PedidoDeExecucao): Promise<ResultadoDaExecucao> {
    const cotacao = await this.configuracao.jupiter.cotar({
      mintEntrada: MINT_SOL_EMBRULHADO,
      mintSaida: pedido.token,
      quantidadeBruta: paraBruto(pedido.valorSol, 9),
      slippageBps: pedido.slippageMaximoBps,
    })
    return {
      sucesso: true,
      quantidadeToken: Number(cotacao.quantidadeSaidaBruta) / 10 ** pedido.decimais,
      valorSol: Number(cotacao.quantidadeEntradaBruta) / LAMPORTS_POR_SOL,
      taxasSol: this.configuracao.taxaPorOperacaoSol,
      assinatura: null,
      fonteDoPreco: 'cotacao',
      executadaEm: new Date(),
    }
  }

  private async simularVenda(pedido: PedidoDeExecucao): Promise<ResultadoDaExecucao> {
    const cotacao = await this.configuracao.jupiter.cotar({
      mintEntrada: pedido.token,
      mintSaida: MINT_SOL_EMBRULHADO,
      quantidadeBruta: paraBruto(pedido.quantidadeToken, pedido.decimais),
      slippageBps: pedido.slippageMaximoBps,
    })
    return {
      sucesso: true,
      quantidadeToken: Number(cotacao.quantidadeEntradaBruta) / 10 ** pedido.decimais,
      valorSol: Number(cotacao.quantidadeSaidaBruta) / LAMPORTS_POR_SOL,
      taxasSol: this.configuracao.taxaPorOperacaoSol,
      assinatura: null,
      fonteDoPreco: 'cotacao',
      executadaEm: new Date(),
    }
  }
}
