import type { EstrategiaDeCopia } from '@hot/dominio'
import { z } from 'zod'
import { estrategiaRotacaoDinamicaPorDesempenho } from './rotacao-dinamica-por-desempenho'
import { estrategiaRotacaoPorPerdasConsecutivas } from './rotacao-por-perdas-consecutivas'
import { estrategiaTradicional } from './tradicional'

const estrategiasRegistradas = [
  estrategiaTradicional,
  estrategiaRotacaoPorPerdasConsecutivas,
  estrategiaRotacaoDinamicaPorDesempenho,
] as unknown as EstrategiaDeCopia[]

const porIdentificador = new Map(
  estrategiasRegistradas.map((estrategia) => [estrategia.identificador, estrategia]),
)

export function listarEstrategias() {
  return estrategiasRegistradas
}

export function obterEstrategia(identificador: string): EstrategiaDeCopia {
  const estrategia = porIdentificador.get(identificador)
  if (!estrategia) throw new Error(`Estratégia desconhecida: ${identificador}`)
  return estrategia
}

export function validarConfiguracaoDaEstrategia(identificador: string, configuracao: unknown) {
  return obterEstrategia(identificador).esquemaDeConfiguracao.parse(configuracao ?? {})
}

export function descreverEstrategias() {
  return estrategiasRegistradas.map((estrategia) => ({
    identificador: estrategia.identificador,
    nome: estrategia.nome,
    descricao: estrategia.descricao,
    esquemaDeConfiguracao: z.toJSONSchema(estrategia.esquemaDeConfiguracao, { io: 'input' }),
  }))
}
