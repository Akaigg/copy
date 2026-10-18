import type { Carteira, Repositorios, Token } from '@hot/banco'
import type {
  CarteiraResposta,
  ComparacaoDeCiclo,
  DesempenhoDaCarteiraNaSessao,
  DetalheDaCarteiraResposta,
  OperacaoResposta,
  OrdemResposta,
  PontoDaCurva,
  PosicaoResposta,
  ResumoDaSessaoResposta,
} from '@hot/compartilhado'
import {
  type CicloDeOrigem,
  calcularMetricas,
  type PosicaoDeCopia,
  type ResumoDeCiclo,
  resultadoPercentualDaPosicao,
  resultadoPercentualDoCiclo,
  type Sessao,
} from '@hot/dominio'
import { obterEstrategia } from '@hot/estrategias'
import type { MotorDeCopia } from './motor-de-copia'
import type { ServicoDePrecos } from './servico-de-precos'

function resumirCiclo(ciclo: CicloDeOrigem): ResumoDeCiclo {
  return {
    carteira: ciclo.carteira,
    token: ciclo.token,
    encerradoEm: ciclo.encerradoEm as Date,
    resultadoSol: ciclo.resultadoRealizadoSol,
    resultadoPercentual: resultadoPercentualDoCiclo(ciclo),
  }
}

function resumirPosicao(posicao: PosicaoDeCopia): ResumoDeCiclo {
  return {
    carteira: posicao.carteira,
    token: posicao.token,
    encerradoEm: posicao.encerradaEm as Date,
    resultadoSol: posicao.resultadoRealizadoSol,
    resultadoPercentual: resultadoPercentualDaPosicao(posicao),
  }
}

export class ErroNaoEncontrado extends Error {}

export class Consultas {
  constructor(
    private readonly repositorios: Repositorios,
    private readonly precos: ServicoDePrecos,
    private readonly motor: MotorDeCopia,
  ) {}

  private async mapaDeTokens(mints: string[]) {
    const tokens = await this.repositorios.tokens.listarPorMints([...new Set(mints)])
    return new Map<string, Token>(tokens.map((token) => [token.mint, token]))
  }

  private async mapaDeCarteiras() {
    const carteiras = await this.repositorios.carteiras.listar()
    return new Map<string, Carteira>(carteiras.map((carteira) => [carteira.endereco, carteira]))
  }

  private async obterSessao(id: string): Promise<Sessao> {
    const sessao = this.motor.obter(id)?.dados ?? (await this.repositorios.sessoes.obter(id))
    if (!sessao) throw new ErroNaoEncontrado('Sessão não encontrada')
    return sessao
  }

  async listarCarteiras(): Promise<CarteiraResposta[]> {
    const [carteiras, encerrados, abertos, recentes] = await Promise.all([
      this.repositorios.carteiras.listar(),
      this.repositorios.ciclos.listarEncerrados({}),
      this.repositorios.ciclos.listarAbertos(),
      this.repositorios.operacoes.listarRecentes(2000),
    ])
    return carteiras.map((carteira) => this.montarCarteira(carteira, encerrados, abertos, recentes))
  }

  private montarCarteira(
    carteira: Carteira,
    encerrados: CicloDeOrigem[],
    abertos: CicloDeOrigem[],
    recentes: Array<{ carteira: string; horarioDoBloco: Date }>,
  ): CarteiraResposta {
    return {
      endereco: carteira.endereco,
      apelido: carteira.apelido,
      status: carteira.status,
      origem: carteira.origem,
      etiquetas: carteira.etiquetas,
      observacoes: carteira.observacoes,
      criadaEm: carteira.criadaEm,
      metricas: calcularMetricas(
        encerrados.filter((c) => c.carteira === carteira.endereco).map(resumirCiclo),
      ),
      ciclosAbertos: abertos.filter((ciclo) => ciclo.carteira === carteira.endereco).length,
      ultimaOperacaoEm:
        recentes.find((operacao) => operacao.carteira === carteira.endereco)?.horarioDoBloco ?? null,
    }
  }

  async detalharCarteira(endereco: string): Promise<DetalheDaCarteiraResposta> {
    const carteira = await this.repositorios.carteiras.obter(endereco)
    if (!carteira) throw new ErroNaoEncontrado('Carteira não encontrada')
    const [ciclos, operacoes] = await Promise.all([
      this.repositorios.ciclos.listarDaCarteira(endereco),
      this.listarOperacoes(200, endereco),
    ])
    const tokens = await this.mapaDeTokens(ciclos.map((ciclo) => ciclo.token))
    const encerrados = ciclos.filter((ciclo) => ciclo.status === 'encerrado')
    const abertos = ciclos.filter((ciclo) => ciclo.status === 'aberto')
    return {
      carteira: this.montarCarteira(carteira, encerrados, abertos, operacoes),
      ciclos: ciclos.map((ciclo) => ({
        ...ciclo,
        simboloDoToken: tokens.get(ciclo.token)?.simbolo ?? null,
        resultadoPercentual: resultadoPercentualDoCiclo(ciclo),
      })),
      operacoes,
    }
  }

  async listarOperacoes(limite: number, carteira?: string): Promise<OperacaoResposta[]> {
    const operacoes = await this.repositorios.operacoes.listarRecentes(limite, carteira)
    const [tokens, carteiras] = await Promise.all([
      this.mapaDeTokens(operacoes.map((operacao) => operacao.token)),
      this.mapaDeCarteiras(),
    ])
    return operacoes.map((operacao) => ({
      ...operacao,
      apelidoDaCarteira: carteiras.get(operacao.carteira)?.apelido ?? null,
      simboloDoToken: tokens.get(operacao.token)?.simbolo ?? null,
    }))
  }

  async resumirSessao(id: string): Promise<ResumoDaSessaoResposta> {
    const sessao = await this.obterSessao(id)
    const [posicoes, encerradas, ordensPorStatus, metricasDeExecucao] = await Promise.all([
      this.listarPosicoes(id, 'aberta'),
      this.repositorios.posicoes.listarEncerradas(id),
      this.repositorios.ordens.contarPorStatus(id),
      this.repositorios.ordens.metricasDeExecucao(id),
    ])
    const custoAberto = posicoes.reduce((total, posicao) => total + posicao.custoBaseSol, 0)
    const temTodosOsPrecos = posicoes.every((posicao) => posicao.valorDeMercadoSol !== null)
    const valorDeMercado = posicoes.reduce((total, posicao) => total + (posicao.valorDeMercadoSol ?? 0), 0)
    const patrimonioDeMercadoSol = temTodosOsPrecos ? sessao.caixaSol + valorDeMercado : null
    const resultadoTotalSol =
      patrimonioDeMercadoSol === null ? null : patrimonioDeMercadoSol - sessao.capitalInicialSol
    return {
      sessao,
      nomeDaEstrategia: obterEstrategia(sessao.estrategiaIdentificador).nome,
      patrimonioContabilSol: sessao.caixaSol + custoAberto,
      patrimonioDeMercadoSol,
      resultadoRealizadoSol: [...posicoes, ...encerradas].reduce(
        (total, p) => total + p.resultadoRealizadoSol,
        0,
      ),
      resultadoTotalSol,
      resultadoPercentual: resultadoTotalSol === null ? null : resultadoTotalSol / sessao.capitalInicialSol,
      posicoesAbertas: posicoes.length,
      metricasDoRobo: calcularMetricas(encerradas.map(resumirPosicao)),
      ordensPorStatus,
      ...metricasDeExecucao,
    }
  }

  async listarResumosDeSessoes() {
    const sessoes = await this.repositorios.sessoes.listar()
    return Promise.all(sessoes.map((sessao) => this.resumirSessao(sessao.id)))
  }

  async listarPosicoes(id: string, status?: 'aberta' | 'encerrada'): Promise<PosicaoResposta[]> {
    const todas =
      status === 'aberta'
        ? await this.repositorios.posicoes.listarAbertas(id)
        : status === 'encerrada'
          ? await this.repositorios.posicoes.listarEncerradas(id)
          : await this.repositorios.posicoes.listar(id)
    const abertas = todas.filter((posicao) => posicao.status === 'aberta')
    const [tokens, carteiras, precos] = await Promise.all([
      this.mapaDeTokens(todas.map((posicao) => posicao.token)),
      this.mapaDeCarteiras(),
      this.precos.precosEmSol(abertas.map((posicao) => posicao.token)),
    ])
    return todas.map((posicao) => {
      const precoAtualSol = posicao.status === 'aberta' ? (precos.get(posicao.token) ?? null) : null
      const valorDeMercadoSol = precoAtualSol === null ? null : precoAtualSol * posicao.quantidade
      return {
        ...posicao,
        simboloDoToken: tokens.get(posicao.token)?.simbolo ?? null,
        apelidoDaCarteira: carteiras.get(posicao.carteira)?.apelido ?? null,
        precoAtualSol,
        valorDeMercadoSol: posicao.status === 'encerrada' ? 0 : valorDeMercadoSol,
        resultadoNaoRealizadoSol:
          valorDeMercadoSol === null ? null : valorDeMercadoSol - posicao.custoBaseSol,
        resultadoPercentual: resultadoPercentualDaPosicao(posicao),
      }
    })
  }

  async listarOrdens(id: string, limite: number): Promise<OrdemResposta[]> {
    const ordens = await this.repositorios.ordens.listar(id, limite)
    const [tokens, carteiras] = await Promise.all([
      this.mapaDeTokens(ordens.map((ordem) => ordem.token)),
      this.mapaDeCarteiras(),
    ])
    return ordens.map((ordem) => ({
      ...ordem,
      simboloDoToken: tokens.get(ordem.token)?.simbolo ?? null,
      apelidoDaCarteira: carteiras.get(ordem.carteira)?.apelido ?? null,
    }))
  }

  async desempenhoPorCarteira(id: string): Promise<DesempenhoDaCarteiraNaSessao[]> {
    const sessao = await this.obterSessao(id)
    const posicoes = await this.repositorios.posicoes.listar(id)
    const enderecos = [
      ...new Set([...sessao.carteiras.map((c) => c.endereco), ...posicoes.map((p) => p.carteira)]),
    ]
    const inicio = sessao.iniciadaEm ?? sessao.criadaEm
    const [ciclosDoTrader, carteiras] = await Promise.all([
      this.repositorios.ciclos.listarEncerrados({ carteiras: enderecos, desde: inicio }),
      this.mapaDeCarteiras(),
    ])
    return enderecos.map((endereco) => {
      const configurada = sessao.carteiras.find((c) => c.endereco === endereco)
      const daCarteira = posicoes.filter((posicao) => posicao.carteira === endereco)
      const abertas = daCarteira.filter((posicao) => posicao.status === 'aberta')
      return {
        endereco,
        apelido: carteiras.get(endereco)?.apelido ?? null,
        fracaoConfigurada: configurada?.fracaoDoCapital ?? 0,
        ordemNaFila: configurada?.ordem ?? -1,
        ativa: sessao.carteirasAtivas.find((ativa) => ativa.endereco === endereco) ?? null,
        metricasDoRobo: calcularMetricas(
          daCarteira.filter((posicao) => posicao.status === 'encerrada').map(resumirPosicao),
        ),
        metricasDoTrader: calcularMetricas(
          ciclosDoTrader.filter((ciclo) => ciclo.carteira === endereco).map(resumirCiclo),
        ),
        custoAbertoSol: abertas.reduce((total, posicao) => total + posicao.custoBaseSol, 0),
        posicoesAbertas: abertas.length,
      }
    })
  }

  async compararComTraders(id: string): Promise<ComparacaoDeCiclo[]> {
    const posicoes = await this.repositorios.posicoes.listar(id)
    const [ciclos, tokens, carteiras] = await Promise.all([
      this.repositorios.ciclos.listarPorIds([...new Set(posicoes.map((posicao) => posicao.cicloDeOrigemId))]),
      this.mapaDeTokens(posicoes.map((posicao) => posicao.token)),
      this.mapaDeCarteiras(),
    ])
    const ciclosPorId = new Map(ciclos.map((ciclo) => [ciclo.id, ciclo]))
    return posicoes.map((posicao) => {
      const ciclo = ciclosPorId.get(posicao.cicloDeOrigemId)
      const resultadoDoTraderPercentual = ciclo ? resultadoPercentualDoCiclo(ciclo) : null
      const resultadoDoRoboPercentual = resultadoPercentualDaPosicao(posicao)
      return {
        posicaoId: posicao.id,
        carteira: posicao.carteira,
        apelidoDaCarteira: carteiras.get(posicao.carteira)?.apelido ?? null,
        token: posicao.token,
        simboloDoToken: tokens.get(posicao.token)?.simbolo ?? null,
        abertaEm: posicao.abertaEm,
        encerradaEm: posicao.encerradaEm,
        resultadoDoTraderPercentual,
        resultadoDoRoboPercentual,
        diferencaPercentual:
          resultadoDoTraderPercentual === null
            ? null
            : resultadoDoRoboPercentual - resultadoDoTraderPercentual,
        resultadoDoRoboSol: posicao.resultadoRealizadoSol,
        cicloDoTraderEncerrado: ciclo?.status === 'encerrado',
      }
    })
  }

  async curvaDeResultado(id: string): Promise<PontoDaCurva[]> {
    const executadas = await this.repositorios.ordens.listarExecutadas(id)
    const custoPorPosicao = new Map<string, { quantidade: number; custo: number }>()
    let acumulado = 0
    const pontos: PontoDaCurva[] = []
    for (const ordem of executadas) {
      const chave = ordem.posicaoId as string
      const atual = custoPorPosicao.get(chave) ?? { quantidade: 0, custo: 0 }
      const quantidade = ordem.quantidadeExecutada ?? 0
      const valor = ordem.valorExecutadoSol ?? 0
      const taxas = ordem.taxasSol ?? 0
      if (ordem.lado === 'compra') {
        custoPorPosicao.set(chave, {
          quantidade: atual.quantidade + quantidade,
          custo: atual.custo + valor + taxas,
        })
        continue
      }
      const encerrou = ordem.tipo === 'venda_total' || quantidade >= atual.quantidade * (1 - 1e-6)
      const fracao = atual.quantidade > 0 ? Math.min(1, quantidade / atual.quantidade) : 1
      const custoVendido = encerrou ? atual.custo : atual.custo * fracao
      custoPorPosicao.set(chave, {
        quantidade: atual.quantidade - quantidade,
        custo: atual.custo - custoVendido,
      })
      acumulado += valor - custoVendido - taxas
      pontos.push({ momento: ordem.executadaEm as Date, resultadoAcumuladoSol: acumulado })
    }
    return pontos
  }

  listarDecisoes(id: string) {
    return this.repositorios.sessoes.listarDecisoes(id)
  }
}
