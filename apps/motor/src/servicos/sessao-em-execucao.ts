import type { Repositorios } from '@hot/banco'
import {
  abrirPosicao,
  aplicarCompraAdicional,
  aplicarVenda,
  type EfeitoNoCiclo,
  type Executor,
  type OperacaoDeOrigem,
  type OrdemDeCopia,
  type PedidoDeExecucao,
  type PlanoDeCopia,
  type PosicaoDeCopia,
  planejarCopia,
  type ResultadoDaExecucao,
  type ResumoDeCiclo,
  resultadoPercentualDaPosicao,
  resultadoPercentualDoCiclo,
  type Sessao,
  type StatusDaSessao,
} from '@hot/dominio'
import { obterEstrategia } from '@hot/estrategias'
import type { BarramentoDeEventos } from '../barramento'
import type { Registro } from '../registro'
import { FilaSerial } from './fila-serial'

export interface OperacaoProcessada {
  operacao: OperacaoDeOrigem
  cicloDeOrigemId: string | null
  efeitoNoCiclo: EfeitoNoCiclo
  custoAbertoDoTraderSol: number
}

export interface DependenciasDaSessao {
  repositorios: Repositorios
  executor: Executor
  barramento: BarramentoDeEventos
  registro: Registro
  tentativasDeVenda: number
  relogio: () => Date
  gerarIdentificador: () => string
  esperar: (milissegundos: number) => Promise<void>
}

type PlanoDeCompra = Extract<PlanoDeCopia, { acao: 'comprar' }>
type PlanoDeVenda = Extract<PlanoDeCopia, { acao: 'vender' }>

const UM_DIA_MS = 86_400_000
const HISTORICO_DA_ESTRATEGIA_MS = 30 * UM_DIA_MS
const CHAVE_DE_PLANEJAMENTO = 'planejamento'

export class SessaoEmExecucao {
  private readonly posicoes = new Map<string, PosicaoDeCopia>()
  private readonly planejamento = new FilaSerial()
  private readonly execucoes = new FilaSerial()
  private reservadoSol = 0

  constructor(
    private sessao: Sessao,
    posicoesAbertas: PosicaoDeCopia[],
    private readonly dependencias: DependenciasDaSessao,
  ) {
    for (const posicao of posicoesAbertas) this.posicoes.set(posicao.id, posicao)
  }

  get id() {
    return this.sessao.id
  }

  get dados(): Sessao {
    return this.paraPersistir()
  }

  incluiCarteira(carteira: string) {
    return (
      this.sessao.carteiras.some((c) => c.endereco === carteira) ||
      [...this.posicoes.values()].some((posicao) => posicao.carteira === carteira)
    )
  }

  carteirasMonitoradas() {
    return new Set([
      ...this.sessao.carteiras.map((carteira) => carteira.endereco),
      ...[...this.posicoes.values()].map((posicao) => posicao.carteira),
    ])
  }

  processar(evento: OperacaoProcessada) {
    return this.planejamento.executar(CHAVE_DE_PLANEJAMENTO, () => this.planejarEEnfileirar(evento))
  }

  reavaliarEstrategia(gatilho: string, registrarSempre = false) {
    return this.planejamento.executar(CHAVE_DE_PLANEJAMENTO, () =>
      this.decidirCarteirasAtivas(gatilho, registrarSempre),
    )
  }

  alterarStatus(status: StatusDaSessao) {
    return this.planejamento.executar(CHAVE_DE_PLANEJAMENTO, async () => {
      const agora = this.dependencias.relogio()
      this.sessao = {
        ...this.sessao,
        status,
        iniciadaEm: this.sessao.iniciadaEm ?? (status === 'ativa' ? agora : null),
        encerradaEm: status === 'encerrada' ? agora : null,
      }
      await this.dependencias.repositorios.sessoes.salvar(this.paraPersistir())
      this.dependencias.barramento.publicar({ tipo: 'sessao_atualizada', dados: { id: this.id } })
    })
  }

  atualizarConfiguracao(alteracoes: Partial<Sessao>) {
    return this.planejamento.executar(CHAVE_DE_PLANEJAMENTO, async () => {
      const trocouEstrategia =
        alteracoes.estrategiaIdentificador !== undefined &&
        alteracoes.estrategiaIdentificador !== this.sessao.estrategiaIdentificador
      this.sessao = {
        ...this.sessao,
        ...alteracoes,
        estrategiaEstado: trocouEstrategia ? null : this.sessao.estrategiaEstado,
      }
      await this.dependencias.repositorios.sessoes.salvar(this.paraPersistir())
      await this.decidirCarteirasAtivas('Configuração alterada', true)
    })
  }

  async aguardarOcioso() {
    await this.planejamento.aguardarTudo()
    await this.execucoes.aguardarTudo()
    await this.planejamento.aguardarTudo()
  }

  private paraPersistir(): Sessao {
    return { ...this.sessao, caixaSol: this.sessao.caixaSol + this.reservadoSol }
  }

  private async salvarEstado() {
    await this.dependencias.repositorios.sessoes.salvarEstado(this.paraPersistir())
    this.dependencias.barramento.publicar({ tipo: 'sessao_atualizada', dados: { id: this.id } })
  }

  private async planejarEEnfileirar(evento: OperacaoProcessada) {
    const { repositorios, barramento, relogio } = this.dependencias
    const agora = relogio()
    const plano = planejarCopia({
      sessao: this.sessao,
      posicoesAbertas: [...this.posicoes.values()],
      operacao: evento.operacao,
      cicloDeOrigemId: evento.cicloDeOrigemId,
      efeitoNoCiclo: evento.efeitoNoCiclo,
      custoAbertoDoTraderSol: evento.custoAbertoDoTraderSol,
      comprasNasUltimas24hSol: await repositorios.ordens.somarComprasDesde(
        this.id,
        new Date(agora.getTime() - UM_DIA_MS),
      ),
      agora,
    })
    if (plano.acao === 'ignorar') return

    const ordem = this.criarOrdem(evento.operacao, plano, agora)
    if (!(await repositorios.ordens.inserir(ordem))) return
    barramento.publicar({ tipo: 'ordem_atualizada', dados: ordem })

    const chaveDoCiclo = `${evento.operacao.carteira}:${evento.operacao.token}:${evento.cicloDeOrigemId}`
    if (plano.acao === 'comprar') {
      this.reservar(ordem, plano, evento)
      void this.execucoes.executar(chaveDoCiclo, () => this.executarCompra(ordem, plano, evento))
    }
    if (plano.acao === 'vender') {
      void this.execucoes.executar(chaveDoCiclo, () => this.executarVenda(ordem, plano))
    }
  }

  private criarOrdem(
    operacao: OperacaoDeOrigem,
    plano: Exclude<PlanoDeCopia, { acao: 'ignorar' }>,
    agora: Date,
  ) {
    const base = {
      id: this.dependencias.gerarIdentificador(),
      sessaoId: this.id,
      operacaoDeOrigemId: operacao.id,
      carteira: operacao.carteira,
      token: operacao.token,
      tipo: plano.tipo,
      precoDoTraderSol: operacao.precoSol,
      horarioDoBlocoDeOrigem: operacao.horarioDoBloco,
      criadaEm: agora,
      tentativas: 0,
      quantidadeExecutada: null,
      valorExecutadoSol: null,
      precoExecutadoSol: null,
      taxasSol: null,
      assinatura: null,
      fonteDoPreco: null,
      executadaEm: null,
      latenciaMs: null,
      desvioDePreco: null,
    } satisfies Partial<OrdemDeCopia>

    switch (plano.acao) {
      case 'nao_copiar':
        return {
          ...base,
          lado: plano.lado,
          status: 'nao_copiada',
          motivo: plano.motivo,
          posicaoId: null,
          valorAlvoSol: null,
          fracaoAlvo: null,
        } satisfies OrdemDeCopia
      case 'comprar':
        return {
          ...base,
          lado: 'compra',
          status: 'pendente',
          motivo: plano.ajustes.length ? plano.ajustes.join('; ') : null,
          posicaoId: plano.posicao?.id ?? this.dependencias.gerarIdentificador(),
          valorAlvoSol: plano.valorSol,
          fracaoAlvo: null,
        } satisfies OrdemDeCopia
      case 'vender':
        return {
          ...base,
          lado: 'venda',
          status: 'pendente',
          motivo: null,
          posicaoId: plano.posicao.id,
          valorAlvoSol: null,
          fracaoAlvo: plano.fracao,
        } satisfies OrdemDeCopia
    }
  }

  private reservar(
    ordem: OrdemDeCopia,
    plano: PlanoDeCompra,
    { operacao, cicloDeOrigemId }: OperacaoProcessada,
  ) {
    this.sessao.caixaSol -= plano.valorSol
    this.reservadoSol += plano.valorSol
    if (plano.tipo !== 'entrada' || !ordem.posicaoId) return
    this.posicoes.set(ordem.posicaoId, {
      id: ordem.posicaoId,
      sessaoId: this.id,
      carteira: operacao.carteira,
      token: operacao.token,
      decimais: operacao.decimais,
      cicloDeOrigemId: cicloDeOrigemId as string,
      status: 'aberta',
      quantidade: 0,
      custoBaseSol: plano.valorSol,
      investidoSol: 0,
      retornadoSol: 0,
      resultadoRealizadoSol: 0,
      taxasSol: 0,
      valorEntradaTraderSol: operacao.valorSol,
      valorEntradaRoboSol: plano.valorSol,
      abertaEm: ordem.criadaEm,
      encerradaEm: null,
    })
  }

  private async executarComSeguranca(pedido: PedidoDeExecucao): Promise<ResultadoDaExecucao> {
    try {
      return await this.dependencias.executor.executar(pedido)
    } catch (erro) {
      return { sucesso: false, erro: erro instanceof Error ? erro.message : String(erro) }
    }
  }

  private async executarCompra(ordem: OrdemDeCopia, plano: PlanoDeCompra, evento: OperacaoProcessada) {
    const { operacao } = evento
    const posicaoId = ordem.posicaoId as string
    const resultado = await this.executarComSeguranca({
      ordemId: ordem.id,
      lado: 'compra',
      token: operacao.token,
      decimais: operacao.decimais,
      valorSol: plano.valorSol,
      quantidadeToken: 0,
      slippageMaximoBps: this.sessao.limites.slippageMaximoBps,
      precoDeReferenciaSol: operacao.precoSol,
    })
    this.reservadoSol -= plano.valorSol
    const posicaoAtual = this.posicoes.get(posicaoId)

    if (!resultado.sucesso || resultado.quantidadeToken <= 0 || !posicaoAtual) {
      this.sessao.caixaSol += plano.valorSol
      if (plano.tipo === 'entrada') this.posicoes.delete(posicaoId)
      const motivo = resultado.sucesso ? 'Posição encerrada antes da execução' : resultado.erro
      await this.finalizarOrdem({ ...ordem, status: 'falhou', motivo, tentativas: 1 })
      await this.salvarEstado()
      return
    }

    this.sessao.caixaSol += plano.valorSol - resultado.valorSol - resultado.taxasSol
    const execucao = { ...resultado }
    const posicao =
      plano.tipo === 'entrada'
        ? abrirPosicao(
            {
              identificador: posicaoId,
              sessaoId: this.id,
              carteira: operacao.carteira,
              token: operacao.token,
              decimais: operacao.decimais,
              cicloDeOrigemId: evento.cicloDeOrigemId as string,
              valorEntradaTraderSol: operacao.valorSol,
            },
            execucao,
          )
        : aplicarCompraAdicional(posicaoAtual, execucao)

    this.posicoes.set(posicao.id, posicao)
    await this.dependencias.repositorios.posicoes.salvar(posicao)
    await this.finalizarOrdem(this.ordemExecutada(ordem, resultado, 1))
    this.dependencias.barramento.publicar({ tipo: 'posicao_atualizada', dados: posicao })
    await this.salvarEstado()
  }

  private async executarVenda(ordem: OrdemDeCopia, plano: PlanoDeVenda) {
    const posicao = this.posicoes.get(plano.posicao.id)
    if (!posicao || posicao.quantidade <= 0) {
      await this.finalizarOrdem({
        ...ordem,
        status: 'nao_copiada',
        motivo: 'A compra de entrada não foi executada',
      })
      return
    }

    const quantidadeToken =
      plano.tipo === 'venda_total' ? posicao.quantidade : posicao.quantidade * plano.fracao
    const pedido: PedidoDeExecucao = {
      ordemId: ordem.id,
      lado: 'venda',
      token: posicao.token,
      decimais: posicao.decimais,
      valorSol: 0,
      quantidadeToken,
      slippageMaximoBps: this.sessao.limites.slippageMaximoBps,
      precoDeReferenciaSol: ordem.precoDoTraderSol,
    }

    let tentativas = 0
    let resultado: ResultadoDaExecucao = { sucesso: false, erro: 'Venda não executada' }
    while (tentativas < this.dependencias.tentativasDeVenda) {
      tentativas++
      resultado = await this.executarComSeguranca(pedido)
      if (resultado.sucesso) break
      this.dependencias.registro.warn(
        { ordem: ordem.id, erro: resultado.erro, tentativas },
        'Falha ao vender',
      )
      if (tentativas < this.dependencias.tentativasDeVenda)
        await this.dependencias.esperar(1000 * 2 ** (tentativas - 1))
    }

    if (!resultado.sucesso) {
      await this.finalizarOrdem({ ...ordem, status: 'falhou', motivo: resultado.erro, tentativas })
      await this.dependencias.repositorios.auditoria.registrar(
        'venda_falhou',
        `Venda não executada após ${tentativas} tentativas`,
        { sessaoId: this.id, ordemId: ordem.id, erro: resultado.erro },
      )
      return
    }

    const atualizada = aplicarVenda(posicao, { ...resultado, vendaTotal: plano.tipo === 'venda_total' })
    this.sessao.caixaSol += resultado.valorSol - resultado.taxasSol
    if (atualizada.status === 'encerrada') this.posicoes.delete(atualizada.id)
    else this.posicoes.set(atualizada.id, atualizada)

    await this.dependencias.repositorios.posicoes.salvar(atualizada)
    await this.finalizarOrdem(this.ordemExecutada(ordem, resultado, tentativas))
    this.dependencias.barramento.publicar({ tipo: 'posicao_atualizada', dados: atualizada })
    await this.salvarEstado()
    if (atualizada.status === 'encerrada') void this.reavaliarEstrategia('Posição do robô encerrada')
  }

  private ordemExecutada(
    ordem: OrdemDeCopia,
    resultado: Extract<ResultadoDaExecucao, { sucesso: true }>,
    tentativas: number,
  ): OrdemDeCopia {
    const precoExecutadoSol =
      resultado.quantidadeToken > 0 ? resultado.valorSol / resultado.quantidadeToken : null
    return {
      ...ordem,
      status: 'executada',
      tentativas,
      quantidadeExecutada: resultado.quantidadeToken,
      valorExecutadoSol: resultado.valorSol,
      precoExecutadoSol,
      taxasSol: resultado.taxasSol,
      assinatura: resultado.assinatura,
      fonteDoPreco: resultado.fonteDoPreco,
      executadaEm: resultado.executadaEm,
      latenciaMs: resultado.executadaEm.getTime() - ordem.horarioDoBlocoDeOrigem.getTime(),
      desvioDePreco:
        precoExecutadoSol && ordem.precoDoTraderSol ? precoExecutadoSol / ordem.precoDoTraderSol - 1 : null,
    }
  }

  private async finalizarOrdem(ordem: OrdemDeCopia) {
    await this.dependencias.repositorios.ordens.atualizar(ordem)
    this.dependencias.barramento.publicar({ tipo: 'ordem_atualizada', dados: ordem })
  }

  private async decidirCarteirasAtivas(gatilho: string, registrarSempre: boolean) {
    const { repositorios, barramento, relogio } = this.dependencias
    const estrategia = obterEstrategia(this.sessao.estrategiaIdentificador)
    const agora = relogio()
    const configuracao = estrategia.esquemaDeConfiguracao.parse(this.sessao.estrategiaConfiguracao ?? {})
    const ciclosDoTrader: ResumoDeCiclo[] = (
      await repositorios.ciclos.listarEncerrados({
        carteiras: this.sessao.carteiras.map((carteira) => carteira.endereco),
        desde: new Date(agora.getTime() - HISTORICO_DA_ESTRATEGIA_MS),
      })
    ).map((ciclo) => ({
      carteira: ciclo.carteira,
      token: ciclo.token,
      encerradoEm: ciclo.encerradoEm as Date,
      resultadoSol: ciclo.resultadoRealizadoSol,
      resultadoPercentual: resultadoPercentualDoCiclo(ciclo),
    }))
    const ciclosDoRobo: ResumoDeCiclo[] = (await repositorios.posicoes.listarEncerradas(this.id)).map(
      (posicao) => ({
        carteira: posicao.carteira,
        token: posicao.token,
        encerradoEm: posicao.encerradaEm as Date,
        resultadoSol: posicao.resultadoRealizadoSol,
        resultadoPercentual: resultadoPercentualDaPosicao(posicao),
      }),
    )

    const decisao = estrategia.decidir({
      configuracao,
      estado: this.sessao.estrategiaEstado ?? estrategia.estadoInicial(configuracao),
      carteirasDaSessao: this.sessao.carteiras,
      ciclosDoTrader,
      ciclosDoRobo,
      inicioDaSessao: this.sessao.iniciadaEm ?? this.sessao.criadaEm,
      momento: agora,
    })

    const mudou = JSON.stringify(decisao.carteirasAtivas) !== JSON.stringify(this.sessao.carteirasAtivas)
    this.sessao = {
      ...this.sessao,
      carteirasAtivas: decisao.carteirasAtivas,
      estrategiaEstado: decisao.estado,
    }
    await repositorios.sessoes.salvarEstado(this.paraPersistir())
    if (!mudou && !registrarSempre) return

    const motivo = `${gatilho}. ${decisao.motivo}`
    await repositorios.sessoes.registrarDecisao({
      sessaoId: this.id,
      momento: agora,
      carteirasAtivas: decisao.carteirasAtivas,
      motivo,
    })
    barramento.publicar({
      tipo: 'decisao_da_estrategia',
      dados: { sessaoId: this.id, carteirasAtivas: decisao.carteirasAtivas, motivo },
    })
    barramento.publicar({ tipo: 'sessao_atualizada', dados: { id: this.id } })
  }
}
