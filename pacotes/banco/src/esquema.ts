import type {
  CarteiraAtiva,
  ConfiguracaoDeDimensionamento,
  FonteDoPreco,
  LadoDaOrdem,
  LimitesDaSessao,
  ModoDaSessao,
  RegrasDeCopia,
  StatusDaOrdem,
  StatusDaPosicao,
  StatusDaSessao,
  StatusDoCiclo,
  TipoDaOrdem,
  TipoDeOperacao,
} from '@hot/dominio'
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

const momento = (nome: string) => timestamp(nome, { withTimezone: true, mode: 'date' })

export type StatusDaCarteira = 'candidata' | 'monitorada' | 'descartada'

export const carteiras = pgTable('carteiras', {
  endereco: text('endereco').primaryKey(),
  apelido: text('apelido'),
  status: text('status').$type<StatusDaCarteira>().notNull().default('monitorada'),
  origem: text('origem').notNull().default('manual'),
  etiquetas: jsonb('etiquetas').$type<string[]>().notNull().default([]),
  observacoes: text('observacoes'),
  ultimaAssinatura: text('ultima_assinatura'),
  criadaEm: momento('criada_em').notNull().defaultNow(),
})

export const tokens = pgTable('tokens', {
  mint: text('mint').primaryKey(),
  simbolo: text('simbolo'),
  nome: text('nome'),
  icone: text('icone'),
  decimais: integer('decimais').notNull(),
  primeiraVezVistoEm: momento('primeira_vez_visto_em').notNull().defaultNow(),
})

export const operacoesDeOrigem = pgTable(
  'operacoes_origem',
  {
    id: text('id').primaryKey(),
    assinatura: text('assinatura').notNull(),
    carteira: text('carteira').notNull(),
    token: text('token').notNull(),
    tipo: text('tipo').$type<TipoDeOperacao>().notNull(),
    quantidadeToken: doublePrecision('quantidade_token').notNull(),
    decimais: integer('decimais').notNull(),
    valorSol: doublePrecision('valor_sol').notNull(),
    precoSol: doublePrecision('preco_sol'),
    saldoTokenAntes: doublePrecision('saldo_token_antes').notNull(),
    saldoTokenDepois: doublePrecision('saldo_token_depois').notNull(),
    saldoSolAntes: doublePrecision('saldo_sol_antes').notNull(),
    plataforma: text('plataforma'),
    slot: bigint('slot', { mode: 'number' }).notNull(),
    horarioDoBloco: momento('horario_do_bloco').notNull(),
    horarioDeDeteccao: momento('horario_de_deteccao').notNull(),
    cicloId: text('ciclo_id'),
    efeitoNoCiclo: text('efeito_no_ciclo').notNull(),
    historica: boolean('historica').notNull().default(false),
  },
  (tabela) => [
    index('operacoes_origem_carteira_horario').on(tabela.carteira, tabela.horarioDoBloco),
    index('operacoes_origem_horario').on(tabela.horarioDoBloco),
    index('operacoes_origem_ciclo').on(tabela.cicloId),
  ],
)

export const ciclosDeOrigem = pgTable(
  'ciclos_origem',
  {
    id: text('id').primaryKey(),
    carteira: text('carteira').notNull(),
    token: text('token').notNull(),
    status: text('status').$type<StatusDoCiclo>().notNull(),
    abertoEm: momento('aberto_em').notNull(),
    encerradoEm: momento('encerrado_em'),
    quantidade: doublePrecision('quantidade').notNull(),
    custoBaseSol: doublePrecision('custo_base_sol').notNull(),
    investidoSol: doublePrecision('investido_sol').notNull(),
    retornadoSol: doublePrecision('retornado_sol').notNull(),
    resultadoRealizadoSol: doublePrecision('resultado_realizado_sol').notNull(),
    quantidadeDeCompras: integer('quantidade_de_compras').notNull(),
    quantidadeDeVendas: integer('quantidade_de_vendas').notNull(),
    teveTransferencias: boolean('teve_transferencias').notNull(),
  },
  (tabela) => [
    index('ciclos_origem_carteira').on(tabela.carteira, tabela.encerradoEm),
    uniqueIndex('ciclos_origem_aberto_unico').on(tabela.carteira, tabela.token).where(sql`status = 'aberto'`),
  ],
)

export const sessoes = pgTable('sessoes', {
  id: text('id').primaryKey(),
  nome: text('nome').notNull(),
  modo: text('modo').$type<ModoDaSessao>().notNull(),
  status: text('status').$type<StatusDaSessao>().notNull(),
  capitalInicialSol: doublePrecision('capital_inicial_sol').notNull(),
  caixaSol: doublePrecision('caixa_sol').notNull(),
  estrategiaIdentificador: text('estrategia_identificador').notNull(),
  estrategiaConfiguracao: jsonb('estrategia_configuracao').$type<unknown>().notNull(),
  estrategiaEstado: jsonb('estrategia_estado').$type<unknown>(),
  carteirasAtivas: jsonb('carteiras_ativas').$type<CarteiraAtiva[]>().notNull(),
  dimensionamento: jsonb('dimensionamento').$type<ConfiguracaoDeDimensionamento>().notNull(),
  limites: jsonb('limites').$type<LimitesDaSessao>().notNull(),
  regras: jsonb('regras').$type<RegrasDeCopia>().notNull(),
  criadaEm: momento('criada_em').notNull(),
  iniciadaEm: momento('iniciada_em'),
  encerradaEm: momento('encerrada_em'),
})

export const carteirasDaSessao = pgTable(
  'carteiras_da_sessao',
  {
    sessaoId: text('sessao_id').notNull(),
    endereco: text('endereco').notNull(),
    fracaoDoCapital: doublePrecision('fracao_do_capital').notNull(),
    ordem: integer('ordem').notNull(),
  },
  (tabela) => [primaryKey({ columns: [tabela.sessaoId, tabela.endereco] })],
)

export const decisoesDaEstrategia = pgTable(
  'decisoes_estrategia',
  {
    id: serial('id').primaryKey(),
    sessaoId: text('sessao_id').notNull(),
    momento: momento('momento').notNull(),
    carteirasAtivas: jsonb('carteiras_ativas').$type<CarteiraAtiva[]>().notNull(),
    motivo: text('motivo').notNull(),
  },
  (tabela) => [index('decisoes_estrategia_sessao').on(tabela.sessaoId, tabela.momento)],
)

export const posicoesDeCopia = pgTable(
  'posicoes_copia',
  {
    id: text('id').primaryKey(),
    sessaoId: text('sessao_id').notNull(),
    carteira: text('carteira').notNull(),
    token: text('token').notNull(),
    decimais: integer('decimais').notNull(),
    cicloDeOrigemId: text('ciclo_de_origem_id').notNull(),
    status: text('status').$type<StatusDaPosicao>().notNull(),
    quantidade: doublePrecision('quantidade').notNull(),
    custoBaseSol: doublePrecision('custo_base_sol').notNull(),
    investidoSol: doublePrecision('investido_sol').notNull(),
    retornadoSol: doublePrecision('retornado_sol').notNull(),
    resultadoRealizadoSol: doublePrecision('resultado_realizado_sol').notNull(),
    taxasSol: doublePrecision('taxas_sol').notNull(),
    valorEntradaTraderSol: doublePrecision('valor_entrada_trader_sol').notNull(),
    valorEntradaRoboSol: doublePrecision('valor_entrada_robo_sol').notNull(),
    abertaEm: momento('aberta_em').notNull(),
    encerradaEm: momento('encerrada_em'),
  },
  (tabela) => [index('posicoes_copia_sessao').on(tabela.sessaoId, tabela.status)],
)

export const ordensDeCopia = pgTable(
  'ordens_copia',
  {
    id: text('id').primaryKey(),
    sessaoId: text('sessao_id').notNull(),
    operacaoDeOrigemId: text('operacao_de_origem_id').notNull(),
    carteira: text('carteira').notNull(),
    token: text('token').notNull(),
    lado: text('lado').$type<LadoDaOrdem>().notNull(),
    tipo: text('tipo').$type<TipoDaOrdem>().notNull(),
    status: text('status').$type<StatusDaOrdem>().notNull(),
    motivo: text('motivo'),
    posicaoId: text('posicao_id'),
    valorAlvoSol: doublePrecision('valor_alvo_sol'),
    fracaoAlvo: doublePrecision('fracao_alvo'),
    precoDoTraderSol: doublePrecision('preco_do_trader_sol'),
    horarioDoBlocoDeOrigem: momento('horario_do_bloco_de_origem').notNull(),
    criadaEm: momento('criada_em').notNull(),
    tentativas: integer('tentativas').notNull(),
    quantidadeExecutada: doublePrecision('quantidade_executada'),
    valorExecutadoSol: doublePrecision('valor_executado_sol'),
    precoExecutadoSol: doublePrecision('preco_executado_sol'),
    taxasSol: doublePrecision('taxas_sol'),
    assinatura: text('assinatura'),
    fonteDoPreco: text('fonte_do_preco').$type<FonteDoPreco>(),
    executadaEm: momento('executada_em'),
    latenciaMs: doublePrecision('latencia_ms'),
    desvioDePreco: doublePrecision('desvio_de_preco'),
  },
  (tabela) => [
    uniqueIndex('ordens_copia_idempotencia').on(tabela.sessaoId, tabela.operacaoDeOrigemId),
    index('ordens_copia_sessao').on(tabela.sessaoId, tabela.criadaEm),
  ],
)

export const eventosDeAuditoria = pgTable('eventos_auditoria', {
  id: serial('id').primaryKey(),
  momento: momento('momento').notNull().defaultNow(),
  tipo: text('tipo').notNull(),
  descricao: text('descricao').notNull(),
  dados: jsonb('dados').$type<unknown>(),
})
