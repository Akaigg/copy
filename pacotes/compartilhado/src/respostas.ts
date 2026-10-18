import type {
  CarteiraAtiva,
  CicloDeOrigem,
  MetricasDeDesempenho,
  OperacaoDeOrigem,
  OrdemDeCopia,
  PosicaoDeCopia,
  Sessao,
} from '@hot/dominio'

export type Serializado<T> = T extends Date
  ? string
  : T extends Array<infer Item>
    ? Serializado<Item>[]
    : T extends object
      ? { [Chave in keyof T]: Serializado<T[Chave]> }
      : T

export interface InformacoesDoTokenResposta {
  mint: string
  simbolo: string | null
  nome: string | null
  icone: string | null
}

export interface CarteiraResposta {
  endereco: string
  apelido: string | null
  status: 'candidata' | 'monitorada' | 'descartada'
  origem: string
  etiquetas: string[]
  observacoes: string | null
  criadaEm: Date
  metricas: MetricasDeDesempenho
  ciclosAbertos: number
  ultimaOperacaoEm: Date | null
}

export interface OperacaoResposta extends OperacaoDeOrigem {
  cicloId: string | null
  efeitoNoCiclo: string
  historica: boolean
  apelidoDaCarteira: string | null
  simboloDoToken: string | null
}

export interface DetalheDaCarteiraResposta {
  carteira: CarteiraResposta
  ciclos: Array<CicloDeOrigem & { simboloDoToken: string | null; resultadoPercentual: number }>
  operacoes: OperacaoResposta[]
}

export interface EstrategiaResposta {
  identificador: string
  nome: string
  descricao: string
  esquemaDeConfiguracao: Record<string, unknown>
}

export interface PosicaoResposta extends PosicaoDeCopia {
  simboloDoToken: string | null
  apelidoDaCarteira: string | null
  precoAtualSol: number | null
  valorDeMercadoSol: number | null
  resultadoNaoRealizadoSol: number | null
  resultadoPercentual: number
}

export interface OrdemResposta extends OrdemDeCopia {
  simboloDoToken: string | null
  apelidoDaCarteira: string | null
}

export interface ResumoDaSessaoResposta {
  sessao: Sessao
  nomeDaEstrategia: string
  patrimonioContabilSol: number
  patrimonioDeMercadoSol: number | null
  resultadoRealizadoSol: number
  resultadoTotalSol: number | null
  resultadoPercentual: number | null
  posicoesAbertas: number
  metricasDoRobo: MetricasDeDesempenho
  ordensPorStatus: Partial<Record<OrdemDeCopia['status'], number>>
  latenciaMediaMs: number | null
  desvioMedioCompra: number | null
  desvioMedioVenda: number | null
}

export interface DesempenhoDaCarteiraNaSessao {
  endereco: string
  apelido: string | null
  fracaoConfigurada: number
  ordemNaFila: number
  ativa: CarteiraAtiva | null
  metricasDoRobo: MetricasDeDesempenho
  metricasDoTrader: MetricasDeDesempenho
  custoAbertoSol: number
  posicoesAbertas: number
}

export interface ComparacaoDeCiclo {
  posicaoId: string
  carteira: string
  apelidoDaCarteira: string | null
  token: string
  simboloDoToken: string | null
  abertaEm: Date
  encerradaEm: Date | null
  resultadoDoTraderPercentual: number | null
  resultadoDoRoboPercentual: number
  diferencaPercentual: number | null
  resultadoDoRoboSol: number
  cicloDoTraderEncerrado: boolean
}

export interface PontoDaCurva {
  momento: Date
  resultadoAcumuladoSol: number
}

export interface EstadoDoSistema {
  monitor: { fonte: string; conectada: boolean; carteiras: number }
  executorSimulado: string
  sessoesAtivas: number
  operacoesProcessadas: number
  ultimaOperacaoEm: Date | null
  iniciadoEm: Date
}

export type EventoDoSistema =
  | { tipo: 'operacao_registrada'; dados: OperacaoResposta }
  | { tipo: 'ciclo_atualizado'; dados: CicloDeOrigem }
  | { tipo: 'ordem_atualizada'; dados: OrdemDeCopia }
  | { tipo: 'posicao_atualizada'; dados: PosicaoDeCopia }
  | { tipo: 'sessao_atualizada'; dados: { id: string } }
  | {
      tipo: 'decisao_da_estrategia'
      dados: { sessaoId: string; carteirasAtivas: CarteiraAtiva[]; motivo: string }
    }
  | { tipo: 'estado_do_monitor'; dados: { conectada: boolean } }
  | { tipo: 'carteiras_atualizadas'; dados: { endereco: string } }
