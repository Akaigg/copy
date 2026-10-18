import { describe, expect, it } from 'vitest'
import {
  abrirPosicao,
  aplicarCompraAdicional,
  aplicarVenda,
  calcularMetricas,
  contarPerdasConsecutivas,
} from '../src'
import { AGORA, CARTEIRA_A, TOKEN_X } from './fabricas'

describe('posição de cópia', () => {
  it('apura resultado com taxas ao longo do ciclo', () => {
    const aberta = abrirPosicao(
      {
        identificador: 'p1',
        sessaoId: 's1',
        carteira: CARTEIRA_A,
        token: TOKEN_X,
        decimais: 6,
        cicloDeOrigemId: 'c1',
        valorEntradaTraderSol: 1,
      },
      { quantidadeToken: 1000, valorSol: 0.5, taxasSol: 0.001, executadaEm: AGORA },
    )
    const reforcada = aplicarCompraAdicional(aberta, {
      quantidadeToken: 500,
      valorSol: 0.25,
      taxasSol: 0.001,
      executadaEm: AGORA,
    })
    expect(reforcada).toMatchObject({ quantidade: 1500, investidoSol: 0.752 })

    const parcial = aplicarVenda(reforcada, {
      quantidadeToken: 750,
      valorSol: 0.6,
      taxasSol: 0.001,
      executadaEm: AGORA,
      vendaTotal: false,
    })
    expect(parcial.status).toBe('aberta')
    expect(parcial.custoBaseSol).toBeCloseTo(0.376)
    expect(parcial.resultadoRealizadoSol).toBeCloseTo(0.6 - 0.376 - 0.001)

    const encerrada = aplicarVenda(parcial, {
      quantidadeToken: 750,
      valorSol: 0.2,
      taxasSol: 0.001,
      executadaEm: AGORA,
      vendaTotal: true,
    })
    expect(encerrada).toMatchObject({ status: 'encerrada', quantidade: 0 })
    expect(encerrada.resultadoRealizadoSol).toBeCloseTo(0.8 - 0.752 - 0.002)
    expect(encerrada.custoBaseSol).toBeCloseTo(0)
  })
})

describe('métricas', () => {
  const ciclo = (resultadoSol: number, minuto: number) => ({
    carteira: CARTEIRA_A,
    token: TOKEN_X,
    encerradoEm: new Date(AGORA.getTime() + minuto * 60_000),
    resultadoSol,
    resultadoPercentual: resultadoSol,
  })

  it('calcula acertos, fator de lucro e sequências de perdas', () => {
    const ciclos = [ciclo(1, 1), ciclo(-0.5, 2), ciclo(-0.5, 3), ciclo(2, 4), ciclo(-1, 5)]
    const metricas = calcularMetricas(ciclos)
    expect(metricas).toMatchObject({
      quantidadeDeCiclos: 5,
      acertos: 2,
      perdas: 3,
      resultadoSol: 1,
      fatorDeLucro: 1.5,
      maiorSequenciaDePerdas: 2,
      perdasConsecutivasAtuais: 1,
    })
    expect(contarPerdasConsecutivas([ciclo(-1, 1), ciclo(-1, 2)])).toBe(2)
  })
})
