import type { ZodType } from 'zod'
import type { CarteiraAtiva, CarteiraDaSessao, ResumoDeCiclo } from './tipos'

export interface ContextoDaEstrategia<Configuracao, Estado> {
  configuracao: Configuracao
  estado: Estado
  carteirasDaSessao: CarteiraDaSessao[]
  ciclosDoTrader: ResumoDeCiclo[]
  ciclosDoRobo: ResumoDeCiclo[]
  inicioDaSessao: Date
  momento: Date
}

export interface DecisaoDaEstrategia<Estado> {
  carteirasAtivas: CarteiraAtiva[]
  estado: Estado
  motivo: string
}

export interface EstrategiaDeCopia<Configuracao = unknown, Estado = unknown> {
  readonly identificador: string
  readonly nome: string
  readonly descricao: string
  readonly esquemaDeConfiguracao: ZodType<Configuracao>
  estadoInicial(configuracao: Configuracao): Estado
  decidir(contexto: ContextoDaEstrategia<Configuracao, Estado>): DecisaoDaEstrategia<Estado>
}
