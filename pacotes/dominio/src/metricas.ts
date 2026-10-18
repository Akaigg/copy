import type { ResumoDeCiclo } from './tipos'

export interface MetricasDeDesempenho {
  quantidadeDeCiclos: number
  acertos: number
  perdas: number
  taxaDeAcerto: number
  resultadoSol: number
  resultadoPercentualMedio: number
  fatorDeLucro: number | null
  maiorGanhoSol: number
  maiorPerdaSol: number
  maiorSequenciaDePerdas: number
  perdasConsecutivasAtuais: number
}

export function calcularMetricas(ciclos: ResumoDeCiclo[]): MetricasDeDesempenho {
  const ordenados = [...ciclos].sort((a, b) => a.encerradoEm.getTime() - b.encerradoEm.getTime())
  const ganhos = ordenados.filter((ciclo) => ciclo.resultadoSol > 0)
  const perdas = ordenados.filter((ciclo) => ciclo.resultadoSol < 0)
  const somaDosGanhos = ganhos.reduce((total, ciclo) => total + ciclo.resultadoSol, 0)
  const somaDasPerdas = perdas.reduce((total, ciclo) => total - ciclo.resultadoSol, 0)

  let sequenciaAtual = 0
  let maiorSequencia = 0
  for (const ciclo of ordenados) {
    sequenciaAtual = ciclo.resultadoSol < 0 ? sequenciaAtual + 1 : 0
    maiorSequencia = Math.max(maiorSequencia, sequenciaAtual)
  }

  return {
    quantidadeDeCiclos: ordenados.length,
    acertos: ganhos.length,
    perdas: perdas.length,
    taxaDeAcerto: ordenados.length ? ganhos.length / ordenados.length : 0,
    resultadoSol: somaDosGanhos - somaDasPerdas,
    resultadoPercentualMedio: ordenados.length
      ? ordenados.reduce((total, ciclo) => total + ciclo.resultadoPercentual, 0) / ordenados.length
      : 0,
    fatorDeLucro: somaDasPerdas > 0 ? somaDosGanhos / somaDasPerdas : null,
    maiorGanhoSol: Math.max(0, ...ordenados.map((ciclo) => ciclo.resultadoSol)),
    maiorPerdaSol: Math.min(0, ...ordenados.map((ciclo) => ciclo.resultadoSol)),
    maiorSequenciaDePerdas: maiorSequencia,
    perdasConsecutivasAtuais: contarPerdasConsecutivas(ordenados),
  }
}

export function contarPerdasConsecutivas(ciclos: ResumoDeCiclo[]): number {
  const ordenados = [...ciclos].sort((a, b) => b.encerradoEm.getTime() - a.encerradoEm.getTime())
  let perdas = 0
  for (const ciclo of ordenados) {
    if (ciclo.resultadoSol >= 0) break
    perdas++
  }
  return perdas
}
