import type { ConfiguracaoDeDimensionamento, OperacaoDeOrigem, PosicaoDeCopia } from './tipos'

export interface DadosParaEntrada {
  configuracao: ConfiguracaoDeDimensionamento
  operacao: OperacaoDeOrigem
  custoAbertoDoTraderSol: number
  capitalAlocadoSol: number
}

export function calcularValorDeEntrada({
  configuracao,
  operacao,
  custoAbertoDoTraderSol,
  capitalAlocadoSol,
}: DadosParaEntrada): number {
  switch (configuracao.modo) {
    case 'proporcional_ao_patrimonio': {
      const patrimonioDoTrader = operacao.saldoSolAntes + custoAbertoDoTraderSol
      const fracaoDoTrader = patrimonioDoTrader > 0 ? Math.min(1, operacao.valorSol / patrimonioDoTrader) : 1
      return fracaoDoTrader * capitalAlocadoSol
    }
    case 'multiplicador_fixo':
      return operacao.valorSol * configuracao.multiplicador
    case 'valor_fixo':
      return configuracao.valorFixoSol
  }
}

export function calcularValorDeCompraAdicional(operacao: OperacaoDeOrigem, posicao: PosicaoDeCopia): number {
  if (posicao.valorEntradaTraderSol <= 0) return 0
  return posicao.valorEntradaRoboSol * (operacao.valorSol / posicao.valorEntradaTraderSol)
}
