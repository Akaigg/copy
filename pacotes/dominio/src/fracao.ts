import type { OperacaoDeOrigem } from './tipos'

export const LIMIAR_DE_POEIRA = 1e-6

export function zerouPosicao(operacao: OperacaoDeOrigem): boolean {
  return operacao.saldoTokenDepois <= operacao.saldoTokenAntes * LIMIAR_DE_POEIRA
}

export function fracaoReduzida(operacao: OperacaoDeOrigem): number {
  if (zerouPosicao(operacao)) return 1
  if (operacao.saldoTokenAntes <= 0) return 1
  return Math.min(1, operacao.quantidadeToken / operacao.saldoTokenAntes)
}
