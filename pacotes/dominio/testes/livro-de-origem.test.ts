import { describe, expect, it } from 'vitest'
import { aplicarOperacaoAoCiclo, resultadoPercentualDoCiclo } from '../src'
import { criarOperacao } from './fabricas'

const gerar = () => 'ciclo-1'

describe('livro de origem', () => {
  it('abre um ciclo na primeira compra', () => {
    const { ciclo, efeito } = aplicarOperacaoAoCiclo(null, criarOperacao(), gerar)
    expect(efeito).toBe('abriu')
    expect(ciclo).toMatchObject({ id: 'ciclo-1', status: 'aberto', quantidade: 1_000_000, investidoSol: 1 })
  })

  it('acumula compras adicionais no mesmo ciclo', () => {
    const aberto = aplicarOperacaoAoCiclo(null, criarOperacao(), gerar).ciclo
    const { ciclo, efeito } = aplicarOperacaoAoCiclo(
      aberto,
      criarOperacao({
        valorSol: 0.5,
        quantidadeToken: 400_000,
        saldoTokenAntes: 1_000_000,
        saldoTokenDepois: 1_400_000,
      }),
      gerar,
    )
    expect(efeito).toBe('atualizou')
    expect(ciclo).toMatchObject({
      quantidade: 1_400_000,
      investidoSol: 1.5,
      custoBaseSol: 1.5,
      quantidadeDeCompras: 2,
    })
  })

  it('calcula a venda parcial pela fração do saldo on-chain', () => {
    const aberto = aplicarOperacaoAoCiclo(null, criarOperacao(), gerar).ciclo
    const { ciclo, efeito } = aplicarOperacaoAoCiclo(
      aberto,
      criarOperacao({
        tipo: 'venda',
        quantidadeToken: 250_000,
        valorSol: 0.75,
        saldoTokenAntes: 1_000_000,
        saldoTokenDepois: 750_000,
      }),
      gerar,
    )
    expect(efeito).toBe('atualizou')
    expect(ciclo?.quantidade).toBeCloseTo(750_000)
    expect(ciclo?.custoBaseSol).toBeCloseTo(0.75)
    expect(ciclo?.resultadoRealizadoSol).toBeCloseTo(0.5)
  })

  it('encerra o ciclo quando o saldo zera e apura o resultado', () => {
    const aberto = aplicarOperacaoAoCiclo(null, criarOperacao(), gerar).ciclo
    const parcial = aplicarOperacaoAoCiclo(
      aberto,
      criarOperacao({
        tipo: 'venda',
        quantidadeToken: 500_000,
        valorSol: 0.2,
        saldoTokenAntes: 1_000_000,
        saldoTokenDepois: 500_000,
      }),
      gerar,
    ).ciclo
    const { ciclo, efeito } = aplicarOperacaoAoCiclo(
      parcial,
      criarOperacao({
        tipo: 'venda',
        quantidadeToken: 500_000,
        valorSol: 0.3,
        saldoTokenAntes: 500_000,
        saldoTokenDepois: 0,
      }),
      gerar,
    )
    expect(efeito).toBe('encerrou')
    expect(ciclo?.status).toBe('encerrado')
    expect(ciclo?.resultadoRealizadoSol).toBeCloseTo(-0.5)
    expect(resultadoPercentualDoCiclo(ciclo as NonNullable<typeof ciclo>)).toBeCloseTo(-0.5)
  })

  it('não abre ciclo em vendas de tokens anteriores ao monitoramento', () => {
    const resultado = aplicarOperacaoAoCiclo(null, criarOperacao({ tipo: 'venda' }), gerar)
    expect(resultado).toEqual({ ciclo: null, efeito: 'sem_ciclo' })
  })

  it('reduz custo proporcionalmente em transferências de saída', () => {
    const aberto = aplicarOperacaoAoCiclo(null, criarOperacao(), gerar).ciclo
    const { ciclo } = aplicarOperacaoAoCiclo(
      aberto,
      criarOperacao({
        tipo: 'transferencia_saida',
        valorSol: 0,
        quantidadeToken: 500_000,
        saldoTokenAntes: 1_000_000,
        saldoTokenDepois: 500_000,
      }),
      gerar,
    )
    expect(ciclo).toMatchObject({
      quantidade: 500_000,
      custoBaseSol: 0.5,
      teveTransferencias: true,
      resultadoRealizadoSol: 0,
    })
  })
})
