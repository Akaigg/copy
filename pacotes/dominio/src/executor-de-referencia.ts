import type { Executor, ModoDaSessao, PedidoDeExecucao, ResultadoDaExecucao } from './tipos'

export interface ConfiguracaoDoExecutorDeReferencia {
  penalidadeDePrecoBps: number
  taxaPorOperacaoSol: number
  relogio?: () => Date
}

export class ExecutorDeReferencia implements Executor {
  readonly modo: ModoDaSessao = 'simulado'

  constructor(private readonly configuracao: ConfiguracaoDoExecutorDeReferencia) {}

  async executar(pedido: PedidoDeExecucao): Promise<ResultadoDaExecucao> {
    if (!pedido.precoDeReferenciaSol || pedido.precoDeReferenciaSol <= 0) {
      return { sucesso: false, erro: 'Preço de referência indisponível' }
    }
    const penalidade = this.configuracao.penalidadeDePrecoBps / 10_000
    const executadaEm = this.configuracao.relogio?.() ?? new Date()
    const taxasSol = this.configuracao.taxaPorOperacaoSol
    if (pedido.lado === 'compra') {
      const preco = pedido.precoDeReferenciaSol * (1 + penalidade)
      return {
        sucesso: true,
        quantidadeToken: pedido.valorSol / preco,
        valorSol: pedido.valorSol,
        taxasSol,
        assinatura: null,
        fonteDoPreco: 'preco_do_trader',
        executadaEm,
      }
    }
    const preco = pedido.precoDeReferenciaSol * (1 - penalidade)
    return {
      sucesso: true,
      quantidadeToken: pedido.quantidadeToken,
      valorSol: pedido.quantidadeToken * preco,
      taxasSol,
      assinatura: null,
      fonteDoPreco: 'preco_do_trader',
      executadaEm,
    }
  }
}
