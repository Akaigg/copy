import type { CicloDeOrigem, OperacaoDeOrigem, OrdemDeCopia, PosicaoDeCopia, Sessao } from '@hot/dominio'
import { and, desc, eq, gte, inArray, isNotNull, sql, sum } from 'drizzle-orm'
import type { Banco } from './conexao'
import {
  carteiras,
  carteirasDaSessao,
  ciclosDeOrigem,
  decisoesDaEstrategia,
  eventosDeAuditoria,
  operacoesDeOrigem,
  ordensDeCopia,
  posicoesDeCopia,
  type StatusDaCarteira,
  sessoes,
  tokens,
} from './esquema'

export type Carteira = typeof carteiras.$inferSelect
export type NovaCarteira = typeof carteiras.$inferInsert
export type Token = typeof tokens.$inferSelect
export type OperacaoRegistrada = typeof operacoesDeOrigem.$inferSelect
export type DecisaoRegistrada = typeof decisoesDaEstrategia.$inferSelect
export type EventoDeAuditoria = typeof eventosDeAuditoria.$inferSelect

export class RepositorioDeCarteiras {
  constructor(private readonly banco: Banco) {}

  listar() {
    return this.banco.select().from(carteiras).orderBy(desc(carteiras.criadaEm))
  }

  listarPorStatus(status: StatusDaCarteira) {
    return this.banco.select().from(carteiras).where(eq(carteiras.status, status))
  }

  async obter(endereco: string) {
    const [carteira] = await this.banco.select().from(carteiras).where(eq(carteiras.endereco, endereco))
    return carteira ?? null
  }

  async criar(dados: NovaCarteira) {
    const [carteira] = await this.banco.insert(carteiras).values(dados).returning()
    return carteira as Carteira
  }

  async atualizar(endereco: string, dados: Partial<Omit<NovaCarteira, 'endereco'>>) {
    const [carteira] = await this.banco
      .update(carteiras)
      .set(dados)
      .where(eq(carteiras.endereco, endereco))
      .returning()
    return carteira ?? null
  }
}

export class RepositorioDeTokens {
  constructor(private readonly banco: Banco) {}

  async atualizarMetadados(mint: string, metadados: Pick<Token, 'simbolo' | 'nome' | 'icone'>) {
    await this.banco.update(tokens).set(metadados).where(eq(tokens.mint, mint))
  }

  async registrarSeAusente(mint: string, decimais: number) {
    const inseridos = await this.banco
      .insert(tokens)
      .values({ mint, decimais })
      .onConflictDoNothing()
      .returning({ mint: tokens.mint })
    return inseridos.length > 0
  }

  listarPorMints(mints: string[]) {
    if (mints.length === 0) return Promise.resolve([] as Token[])
    return this.banco.select().from(tokens).where(inArray(tokens.mint, mints))
  }
}

export class RepositorioDeOperacoes {
  constructor(private readonly banco: Banco) {}

  async existe(id: string) {
    const [encontrada] = await this.banco
      .select({ id: operacoesDeOrigem.id })
      .from(operacoesDeOrigem)
      .where(eq(operacoesDeOrigem.id, id))
    return Boolean(encontrada)
  }

  async assinaturaJaProcessada(assinatura: string, carteira: string) {
    const [encontrada] = await this.banco
      .select({ id: operacoesDeOrigem.id })
      .from(operacoesDeOrigem)
      .where(and(eq(operacoesDeOrigem.assinatura, assinatura), eq(operacoesDeOrigem.carteira, carteira)))
      .limit(1)
    return Boolean(encontrada)
  }

  async inserir(
    operacao: OperacaoDeOrigem,
    cicloId: string | null,
    efeitoNoCiclo: string,
    historica: boolean,
  ) {
    const inseridas = await this.banco
      .insert(operacoesDeOrigem)
      .values({ ...operacao, cicloId, efeitoNoCiclo, historica })
      .onConflictDoNothing()
      .returning({ id: operacoesDeOrigem.id })
    return inseridas.length > 0
  }

  listarRecentes(limite: number, carteira?: string) {
    return this.banco
      .select()
      .from(operacoesDeOrigem)
      .where(carteira ? eq(operacoesDeOrigem.carteira, carteira) : undefined)
      .orderBy(desc(operacoesDeOrigem.horarioDoBloco))
      .limit(limite)
  }

  listarPorIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([] as OperacaoRegistrada[])
    return this.banco.select().from(operacoesDeOrigem).where(inArray(operacoesDeOrigem.id, ids))
  }
}

export class RepositorioDeCiclos {
  constructor(private readonly banco: Banco) {}

  async obterAberto(carteira: string, token: string): Promise<CicloDeOrigem | null> {
    const [ciclo] = await this.banco
      .select()
      .from(ciclosDeOrigem)
      .where(
        and(
          eq(ciclosDeOrigem.carteira, carteira),
          eq(ciclosDeOrigem.token, token),
          eq(ciclosDeOrigem.status, 'aberto'),
        ),
      )
    return ciclo ?? null
  }

  async salvar(ciclo: CicloDeOrigem) {
    await this.banco
      .insert(ciclosDeOrigem)
      .values(ciclo)
      .onConflictDoUpdate({ target: ciclosDeOrigem.id, set: ciclo })
  }

  async custoAbertoDaCarteira(carteira: string) {
    const [resultado] = await this.banco
      .select({ total: sum(ciclosDeOrigem.custoBaseSol) })
      .from(ciclosDeOrigem)
      .where(and(eq(ciclosDeOrigem.carteira, carteira), eq(ciclosDeOrigem.status, 'aberto')))
    return Number(resultado?.total ?? 0)
  }

  listarDaCarteira(carteira: string, limite = 200) {
    return this.banco
      .select()
      .from(ciclosDeOrigem)
      .where(eq(ciclosDeOrigem.carteira, carteira))
      .orderBy(desc(ciclosDeOrigem.abertoEm))
      .limit(limite)
  }

  listarEncerrados(filtro: { carteiras?: string[]; desde?: Date }) {
    if (filtro.carteiras && filtro.carteiras.length === 0) return Promise.resolve([] as CicloDeOrigem[])
    return this.banco
      .select()
      .from(ciclosDeOrigem)
      .where(
        and(
          eq(ciclosDeOrigem.status, 'encerrado'),
          filtro.carteiras ? inArray(ciclosDeOrigem.carteira, filtro.carteiras) : undefined,
          filtro.desde ? gte(ciclosDeOrigem.encerradoEm, filtro.desde) : undefined,
        ),
      )
      .orderBy(ciclosDeOrigem.encerradoEm)
  }

  listarPorIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([] as CicloDeOrigem[])
    return this.banco.select().from(ciclosDeOrigem).where(inArray(ciclosDeOrigem.id, ids))
  }

  listarAbertos() {
    return this.banco.select().from(ciclosDeOrigem).where(eq(ciclosDeOrigem.status, 'aberto'))
  }
}

export class RepositorioDeSessoes {
  constructor(private readonly banco: Banco) {}

  async listar(): Promise<Sessao[]> {
    const linhas = await this.banco.select().from(sessoes).orderBy(desc(sessoes.criadaEm))
    const vinculos = await this.banco.select().from(carteirasDaSessao)
    return linhas.map((linha) => ({
      ...linha,
      carteiras: vinculos
        .filter((vinculo) => vinculo.sessaoId === linha.id)
        .map(({ endereco, fracaoDoCapital, ordem }) => ({ endereco, fracaoDoCapital, ordem }))
        .sort((a, b) => a.ordem - b.ordem),
    }))
  }

  async obter(id: string): Promise<Sessao | null> {
    const [linha] = await this.banco.select().from(sessoes).where(eq(sessoes.id, id))
    if (!linha) return null
    const vinculos = await this.banco
      .select()
      .from(carteirasDaSessao)
      .where(eq(carteirasDaSessao.sessaoId, id))
      .orderBy(carteirasDaSessao.ordem)
    return {
      ...linha,
      carteiras: vinculos.map(({ endereco, fracaoDoCapital, ordem }) => ({
        endereco,
        fracaoDoCapital,
        ordem,
      })),
    }
  }

  async salvar(sessao: Sessao) {
    const { carteiras: vinculadas, ...dados } = sessao
    await this.banco.transaction(async (transacao) => {
      await transacao.insert(sessoes).values(dados).onConflictDoUpdate({ target: sessoes.id, set: dados })
      await transacao.delete(carteirasDaSessao).where(eq(carteirasDaSessao.sessaoId, sessao.id))
      if (vinculadas.length) {
        await transacao
          .insert(carteirasDaSessao)
          .values(vinculadas.map((c) => ({ ...c, sessaoId: sessao.id })))
      }
    })
  }

  async salvarEstado(sessao: Pick<Sessao, 'id' | 'caixaSol' | 'estrategiaEstado' | 'carteirasAtivas'>) {
    await this.banco
      .update(sessoes)
      .set({
        caixaSol: sessao.caixaSol,
        estrategiaEstado: sessao.estrategiaEstado,
        carteirasAtivas: sessao.carteirasAtivas,
      })
      .where(eq(sessoes.id, sessao.id))
  }

  async registrarDecisao(decisao: typeof decisoesDaEstrategia.$inferInsert) {
    await this.banco.insert(decisoesDaEstrategia).values(decisao)
  }

  listarDecisoes(sessaoId: string, limite = 100) {
    return this.banco
      .select()
      .from(decisoesDaEstrategia)
      .where(eq(decisoesDaEstrategia.sessaoId, sessaoId))
      .orderBy(desc(decisoesDaEstrategia.momento))
      .limit(limite)
  }
}

export class RepositorioDePosicoes {
  constructor(private readonly banco: Banco) {}

  listarAbertas(sessaoId: string): Promise<PosicaoDeCopia[]> {
    return this.banco
      .select()
      .from(posicoesDeCopia)
      .where(and(eq(posicoesDeCopia.sessaoId, sessaoId), eq(posicoesDeCopia.status, 'aberta')))
  }

  listar(sessaoId: string): Promise<PosicaoDeCopia[]> {
    return this.banco
      .select()
      .from(posicoesDeCopia)
      .where(eq(posicoesDeCopia.sessaoId, sessaoId))
      .orderBy(desc(posicoesDeCopia.abertaEm))
  }

  listarEncerradas(sessaoId: string): Promise<PosicaoDeCopia[]> {
    return this.banco
      .select()
      .from(posicoesDeCopia)
      .where(and(eq(posicoesDeCopia.sessaoId, sessaoId), eq(posicoesDeCopia.status, 'encerrada')))
      .orderBy(posicoesDeCopia.encerradaEm)
  }

  async salvar(posicao: PosicaoDeCopia) {
    await this.banco
      .insert(posicoesDeCopia)
      .values(posicao)
      .onConflictDoUpdate({ target: posicoesDeCopia.id, set: posicao })
  }
}

export class RepositorioDeOrdens {
  constructor(private readonly banco: Banco) {}

  async inserir(ordem: OrdemDeCopia) {
    const inseridas = await this.banco
      .insert(ordensDeCopia)
      .values(ordem)
      .onConflictDoNothing()
      .returning({ id: ordensDeCopia.id })
    return inseridas.length > 0
  }

  async atualizar(ordem: OrdemDeCopia) {
    await this.banco.update(ordensDeCopia).set(ordem).where(eq(ordensDeCopia.id, ordem.id))
  }

  listar(sessaoId: string, limite = 200): Promise<OrdemDeCopia[]> {
    return this.banco
      .select()
      .from(ordensDeCopia)
      .where(eq(ordensDeCopia.sessaoId, sessaoId))
      .orderBy(desc(ordensDeCopia.criadaEm))
      .limit(limite)
  }

  listarExecutadas(sessaoId: string): Promise<OrdemDeCopia[]> {
    return this.banco
      .select()
      .from(ordensDeCopia)
      .where(and(eq(ordensDeCopia.sessaoId, sessaoId), eq(ordensDeCopia.status, 'executada')))
      .orderBy(ordensDeCopia.criadaEm)
  }

  listarPendentes(): Promise<OrdemDeCopia[]> {
    return this.banco.select().from(ordensDeCopia).where(eq(ordensDeCopia.status, 'pendente'))
  }

  async somarComprasDesde(sessaoId: string, desde: Date) {
    const [resultado] = await this.banco
      .select({ total: sum(ordensDeCopia.valorAlvoSol) })
      .from(ordensDeCopia)
      .where(
        and(
          eq(ordensDeCopia.sessaoId, sessaoId),
          eq(ordensDeCopia.lado, 'compra'),
          inArray(ordensDeCopia.status, ['pendente', 'executada']),
          gte(ordensDeCopia.criadaEm, desde),
        ),
      )
    return Number(resultado?.total ?? 0)
  }

  async contarPorStatus(sessaoId: string) {
    const linhas = await this.banco
      .select({ status: ordensDeCopia.status, total: sql<number>`count(*)::int` })
      .from(ordensDeCopia)
      .where(eq(ordensDeCopia.sessaoId, sessaoId))
      .groupBy(ordensDeCopia.status)
    return Object.fromEntries(linhas.map((linha) => [linha.status, Number(linha.total)])) as Partial<
      Record<OrdemDeCopia['status'], number>
    >
  }

  async metricasDeExecucao(sessaoId: string) {
    const [resultado] = await this.banco
      .select({
        latenciaMediaMs: sql<number | null>`avg(${ordensDeCopia.latenciaMs})`,
        desvioMedioCompra: sql<
          number | null
        >`avg(${ordensDeCopia.desvioDePreco}) filter (where ${ordensDeCopia.lado} = 'compra')`,
        desvioMedioVenda: sql<
          number | null
        >`avg(${ordensDeCopia.desvioDePreco}) filter (where ${ordensDeCopia.lado} = 'venda')`,
      })
      .from(ordensDeCopia)
      .where(and(eq(ordensDeCopia.sessaoId, sessaoId), isNotNull(ordensDeCopia.executadaEm)))
    return {
      latenciaMediaMs: resultado?.latenciaMediaMs === null ? null : Number(resultado?.latenciaMediaMs),
      desvioMedioCompra: resultado?.desvioMedioCompra === null ? null : Number(resultado?.desvioMedioCompra),
      desvioMedioVenda: resultado?.desvioMedioVenda === null ? null : Number(resultado?.desvioMedioVenda),
    }
  }
}

export class RepositorioDeAuditoria {
  constructor(private readonly banco: Banco) {}

  async registrar(tipo: string, descricao: string, dados?: unknown) {
    await this.banco.insert(eventosDeAuditoria).values({ tipo, descricao, dados: dados ?? null })
  }

  listar(limite = 100) {
    return this.banco
      .select()
      .from(eventosDeAuditoria)
      .orderBy(desc(eventosDeAuditoria.momento))
      .limit(limite)
  }
}

export function criarRepositorios(banco: Banco) {
  return {
    carteiras: new RepositorioDeCarteiras(banco),
    tokens: new RepositorioDeTokens(banco),
    operacoes: new RepositorioDeOperacoes(banco),
    ciclos: new RepositorioDeCiclos(banco),
    sessoes: new RepositorioDeSessoes(banco),
    posicoes: new RepositorioDePosicoes(banco),
    ordens: new RepositorioDeOrdens(banco),
    auditoria: new RepositorioDeAuditoria(banco),
  }
}

export type Repositorios = ReturnType<typeof criarRepositorios>
