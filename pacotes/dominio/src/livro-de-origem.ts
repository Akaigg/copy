import { fracaoReduzida } from './fracao'
import type { CicloDeOrigem, OperacaoDeOrigem } from './tipos'

export type EfeitoNoCiclo = 'abriu' | 'atualizou' | 'encerrou' | 'sem_ciclo'

export interface ResultadoNoLivro {
  ciclo: CicloDeOrigem | null
  efeito: EfeitoNoCiclo
}

export function aplicarOperacaoAoCiclo(
  cicloAberto: CicloDeOrigem | null,
  operacao: OperacaoDeOrigem,
  gerarIdentificador: () => string,
): ResultadoNoLivro {
  switch (operacao.tipo) {
    case 'compra':
      return cicloAberto
        ? registrarCompraAdicional(cicloAberto, operacao)
        : abrirCiclo(operacao, gerarIdentificador())
    case 'venda':
      return cicloAberto ? registrarVenda(cicloAberto, operacao) : { ciclo: null, efeito: 'sem_ciclo' }
    case 'transferencia_saida':
      return cicloAberto
        ? registrarTransferenciaDeSaida(cicloAberto, operacao)
        : { ciclo: null, efeito: 'sem_ciclo' }
    case 'transferencia_entrada':
      return cicloAberto
        ? {
            ciclo: {
              ...cicloAberto,
              quantidade: cicloAberto.quantidade + operacao.quantidadeToken,
              teveTransferencias: true,
            },
            efeito: 'atualizou',
          }
        : { ciclo: null, efeito: 'sem_ciclo' }
  }
}

function abrirCiclo(operacao: OperacaoDeOrigem, identificador: string): ResultadoNoLivro {
  return {
    efeito: 'abriu',
    ciclo: {
      id: identificador,
      carteira: operacao.carteira,
      token: operacao.token,
      status: 'aberto',
      abertoEm: operacao.horarioDoBloco,
      encerradoEm: null,
      quantidade: operacao.quantidadeToken,
      custoBaseSol: operacao.valorSol,
      investidoSol: operacao.valorSol,
      retornadoSol: 0,
      resultadoRealizadoSol: 0,
      quantidadeDeCompras: 1,
      quantidadeDeVendas: 0,
      teveTransferencias: false,
    },
  }
}

function registrarCompraAdicional(ciclo: CicloDeOrigem, operacao: OperacaoDeOrigem): ResultadoNoLivro {
  return {
    efeito: 'atualizou',
    ciclo: {
      ...ciclo,
      quantidade: ciclo.quantidade + operacao.quantidadeToken,
      custoBaseSol: ciclo.custoBaseSol + operacao.valorSol,
      investidoSol: ciclo.investidoSol + operacao.valorSol,
      quantidadeDeCompras: ciclo.quantidadeDeCompras + 1,
    },
  }
}

function registrarVenda(ciclo: CicloDeOrigem, operacao: OperacaoDeOrigem): ResultadoNoLivro {
  const fracao = fracaoReduzida(operacao)
  const custoVendido = ciclo.custoBaseSol * fracao
  const atualizado: CicloDeOrigem = {
    ...ciclo,
    quantidade: ciclo.quantidade * (1 - fracao),
    custoBaseSol: ciclo.custoBaseSol - custoVendido,
    retornadoSol: ciclo.retornadoSol + operacao.valorSol,
    resultadoRealizadoSol: ciclo.resultadoRealizadoSol + operacao.valorSol - custoVendido,
    quantidadeDeVendas: ciclo.quantidadeDeVendas + 1,
  }
  return fracao >= 1
    ? encerrar(atualizado, operacao.horarioDoBloco)
    : { ciclo: atualizado, efeito: 'atualizou' }
}

function registrarTransferenciaDeSaida(ciclo: CicloDeOrigem, operacao: OperacaoDeOrigem): ResultadoNoLivro {
  const fracao = fracaoReduzida(operacao)
  const atualizado: CicloDeOrigem = {
    ...ciclo,
    quantidade: ciclo.quantidade * (1 - fracao),
    custoBaseSol: ciclo.custoBaseSol * (1 - fracao),
    teveTransferencias: true,
  }
  return fracao >= 1
    ? encerrar(atualizado, operacao.horarioDoBloco)
    : { ciclo: atualizado, efeito: 'atualizou' }
}

function encerrar(ciclo: CicloDeOrigem, momento: Date): ResultadoNoLivro {
  return {
    efeito: 'encerrou',
    ciclo: { ...ciclo, status: 'encerrado', encerradoEm: momento, quantidade: 0, custoBaseSol: 0 },
  }
}

export function resultadoPercentualDoCiclo(
  ciclo: Pick<CicloDeOrigem, 'investidoSol' | 'resultadoRealizadoSol'>,
) {
  return ciclo.investidoSol > 0 ? ciclo.resultadoRealizadoSol / ciclo.investidoSol : 0
}
