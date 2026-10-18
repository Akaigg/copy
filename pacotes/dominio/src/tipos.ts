export type Endereco = string

export type TipoDeOperacao = 'compra' | 'venda' | 'transferencia_entrada' | 'transferencia_saida'

export interface OperacaoDeOrigem {
  id: string
  assinatura: string
  carteira: Endereco
  token: Endereco
  tipo: TipoDeOperacao
  quantidadeToken: number
  decimais: number
  valorSol: number
  precoSol: number | null
  saldoTokenAntes: number
  saldoTokenDepois: number
  saldoSolAntes: number
  plataforma: string | null
  slot: number
  horarioDoBloco: Date
  horarioDeDeteccao: Date
}

export type StatusDoCiclo = 'aberto' | 'encerrado'

export interface CicloDeOrigem {
  id: string
  carteira: Endereco
  token: Endereco
  status: StatusDoCiclo
  abertoEm: Date
  encerradoEm: Date | null
  quantidade: number
  custoBaseSol: number
  investidoSol: number
  retornadoSol: number
  resultadoRealizadoSol: number
  quantidadeDeCompras: number
  quantidadeDeVendas: number
  teveTransferencias: boolean
}

export type ModoDaSessao = 'simulado' | 'real'

export type StatusDaSessao = 'ativa' | 'pausada' | 'encerrada'

export type ModoDeDimensionamento = 'proporcional_ao_patrimonio' | 'multiplicador_fixo' | 'valor_fixo'

export interface ConfiguracaoDeDimensionamento {
  modo: ModoDeDimensionamento
  multiplicador: number
  valorFixoSol: number
  aoFaltarCapital: 'reduzir' | 'nao_copiar'
}

export interface LimitesDaSessao {
  valorMinimoPorOrdemSol: number
  valorMaximoPorOrdemSol: number
  exposicaoMaximaPorTokenSol: number
  posicoesAbertasMaximas: number
  volumeDiarioMaximoDeComprasSol: number
  idadeMaximaParaCopiarCompraSegundos: number
  slippageMaximoBps: number
}

export interface RegrasDeCopia {
  transferenciaDeSaida: 'ignorar' | 'espelhar_como_venda'
}

export interface CarteiraDaSessao {
  endereco: Endereco
  fracaoDoCapital: number
  ordem: number
}

export interface CarteiraAtiva {
  endereco: Endereco
  fracaoDoCapital: number
}

export interface Sessao {
  id: string
  nome: string
  modo: ModoDaSessao
  status: StatusDaSessao
  capitalInicialSol: number
  caixaSol: number
  carteiras: CarteiraDaSessao[]
  estrategiaIdentificador: string
  estrategiaConfiguracao: unknown
  estrategiaEstado: unknown
  carteirasAtivas: CarteiraAtiva[]
  dimensionamento: ConfiguracaoDeDimensionamento
  limites: LimitesDaSessao
  regras: RegrasDeCopia
  criadaEm: Date
  iniciadaEm: Date | null
  encerradaEm: Date | null
}

export type StatusDaPosicao = 'aberta' | 'encerrada'

export interface PosicaoDeCopia {
  id: string
  sessaoId: string
  carteira: Endereco
  token: Endereco
  decimais: number
  cicloDeOrigemId: string
  status: StatusDaPosicao
  quantidade: number
  custoBaseSol: number
  investidoSol: number
  retornadoSol: number
  resultadoRealizadoSol: number
  taxasSol: number
  valorEntradaTraderSol: number
  valorEntradaRoboSol: number
  abertaEm: Date
  encerradaEm: Date | null
}

export type LadoDaOrdem = 'compra' | 'venda'

export type TipoDaOrdem = 'entrada' | 'compra_adicional' | 'venda_parcial' | 'venda_total'

export type StatusDaOrdem = 'pendente' | 'executada' | 'falhou' | 'nao_copiada'

export type FonteDoPreco = 'cotacao' | 'preco_do_trader' | 'transacao'

export interface OrdemDeCopia {
  id: string
  sessaoId: string
  operacaoDeOrigemId: string
  carteira: Endereco
  token: Endereco
  lado: LadoDaOrdem
  tipo: TipoDaOrdem
  status: StatusDaOrdem
  motivo: string | null
  posicaoId: string | null
  valorAlvoSol: number | null
  fracaoAlvo: number | null
  precoDoTraderSol: number | null
  horarioDoBlocoDeOrigem: Date
  criadaEm: Date
  tentativas: number
  quantidadeExecutada: number | null
  valorExecutadoSol: number | null
  precoExecutadoSol: number | null
  taxasSol: number | null
  assinatura: string | null
  fonteDoPreco: FonteDoPreco | null
  executadaEm: Date | null
  latenciaMs: number | null
  desvioDePreco: number | null
}

export interface PedidoDeExecucao {
  ordemId: string
  lado: LadoDaOrdem
  token: Endereco
  decimais: number
  valorSol: number
  quantidadeToken: number
  slippageMaximoBps: number
  precoDeReferenciaSol: number | null
}

export type ResultadoDaExecucao =
  | {
      sucesso: true
      quantidadeToken: number
      valorSol: number
      taxasSol: number
      assinatura: string | null
      fonteDoPreco: FonteDoPreco
      executadaEm: Date
    }
  | {
      sucesso: false
      erro: string
    }

export interface Executor {
  readonly modo: ModoDaSessao
  executar(pedido: PedidoDeExecucao): Promise<ResultadoDaExecucao>
}

export interface ResumoDeCiclo {
  carteira: Endereco
  token: Endereco
  encerradoEm: Date
  resultadoSol: number
  resultadoPercentual: number
}
