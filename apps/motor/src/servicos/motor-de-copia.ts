import type { Repositorios } from '@hot/banco'
import type { NovaSessao } from '@hot/compartilhado'
import {
  type ConfiguracaoDaSessaoEnviada,
  esquemaDeConfiguracaoDaSessao,
  esquemaDeNovaSessao,
} from '@hot/compartilhado'
import type { Executor, Sessao, StatusDaSessao } from '@hot/dominio'
import { obterEstrategia, validarConfiguracaoDaEstrategia } from '@hot/estrategias'
import type { BarramentoDeEventos } from '../barramento'
import type { Registro } from '../registro'
import { type OperacaoProcessada, SessaoEmExecucao } from './sessao-em-execucao'

export interface DependenciasDoMotor {
  repositorios: Repositorios
  executorSimulado: Executor
  barramento: BarramentoDeEventos
  registro: Registro
  tentativasDeVenda: number
  relogio: () => Date
  gerarIdentificador: () => string
  esperar: (milissegundos: number) => Promise<void>
}

export class ErroDeSessao extends Error {}

function prepararConfiguracao(enviada: ConfiguracaoDaSessaoEnviada) {
  const configuracao = esquemaDeConfiguracaoDaSessao.parse(enviada)
  obterEstrategia(configuracao.estrategiaIdentificador)
  return {
    carteiras: configuracao.carteiras.map((carteira, ordem) => ({ ...carteira, ordem })),
    estrategiaIdentificador: configuracao.estrategiaIdentificador,
    estrategiaConfiguracao: validarConfiguracaoDaEstrategia(
      configuracao.estrategiaIdentificador,
      configuracao.estrategiaConfiguracao,
    ),
    dimensionamento: configuracao.dimensionamento,
    limites: configuracao.limites,
    regras: configuracao.regras,
  }
}

export class MotorDeCopia {
  private readonly sessoes = new Map<string, SessaoEmExecucao>()
  private temporizador: NodeJS.Timeout | null = null

  constructor(private readonly dependencias: DependenciasDoMotor) {}

  async carregar() {
    const { repositorios, registro } = this.dependencias
    for (const pendente of await repositorios.ordens.listarPendentes()) {
      await repositorios.ordens.atualizar({
        ...pendente,
        status: 'falhou',
        motivo: 'Interrompida por reinício do motor',
      })
    }
    for (const sessao of await repositorios.sessoes.listar()) {
      if (sessao.status === 'encerrada') continue
      const instancia = await this.instanciar(sessao)
      await instancia.reavaliarEstrategia('Motor iniciado')
    }
    registro.info(`${this.sessoes.size} sessões carregadas`)
  }

  obter(id: string) {
    return this.sessoes.get(id) ?? null
  }

  quantidadeDeSessoesAtivas() {
    return [...this.sessoes.values()].filter((sessao) => sessao.dados.status === 'ativa').length
  }

  carteirasEmUso() {
    const carteiras = new Set<string>()
    for (const sessao of this.sessoes.values())
      for (const carteira of sessao.carteirasMonitoradas()) carteiras.add(carteira)
    return carteiras
  }

  async criarSessao(dados: NovaSessao) {
    const validados = esquemaDeNovaSessao.parse(dados)
    const agora = this.dependencias.relogio()
    const sessao: Sessao = {
      id: this.dependencias.gerarIdentificador(),
      nome: validados.nome,
      modo: validados.modo,
      status: 'ativa',
      capitalInicialSol: validados.capitalInicialSol,
      caixaSol: validados.capitalInicialSol,
      ...prepararConfiguracao(validados.configuracao),
      estrategiaEstado: null,
      carteirasAtivas: [],
      criadaEm: agora,
      iniciadaEm: agora,
      encerradaEm: null,
    }
    await this.dependencias.repositorios.sessoes.salvar(sessao)
    const instancia = await this.instanciar(sessao)
    await instancia.reavaliarEstrategia('Sessão criada', true)
    await this.dependencias.repositorios.auditoria.registrar(
      'sessao_criada',
      `Sessão "${sessao.nome}" criada`,
      {
        sessaoId: sessao.id,
        modo: sessao.modo,
        capitalInicialSol: sessao.capitalInicialSol,
      },
    )
    return instancia.dados
  }

  async atualizarConfiguracao(id: string, enviada: ConfiguracaoDaSessaoEnviada) {
    const instancia = this.exigir(id)
    await instancia.atualizarConfiguracao(prepararConfiguracao(enviada))
    await this.dependencias.repositorios.auditoria.registrar(
      'sessao_reconfigurada',
      'Configuração alterada',
      {
        sessaoId: id,
      },
    )
    return instancia.dados
  }

  async alterarStatus(id: string, status: StatusDaSessao) {
    const instancia = this.exigir(id)
    await instancia.alterarStatus(status)
    await this.dependencias.repositorios.auditoria.registrar(
      'sessao_status',
      `Sessão alterada para ${status}`,
      {
        sessaoId: id,
      },
    )
    if (status === 'encerrada') {
      await instancia.aguardarOcioso()
      this.sessoes.delete(id)
    }
    return instancia.dados
  }

  async processarOperacao(evento: OperacaoProcessada) {
    await Promise.all([...this.sessoes.values()].map((sessao) => sessao.processar(evento)))
  }

  async aoEncerrarCicloDoTrader(carteira: string) {
    await Promise.all(
      [...this.sessoes.values()]
        .filter((sessao) => sessao.incluiCarteira(carteira))
        .map((sessao) => sessao.reavaliarEstrategia('Ciclo do trader encerrado')),
    )
  }

  iniciarReavaliacaoPeriodica(intervaloSegundos: number) {
    this.temporizador = setInterval(() => {
      for (const sessao of this.sessoes.values()) {
        sessao
          .reavaliarEstrategia('Reavaliação periódica')
          .catch((erro) =>
            this.dependencias.registro.error(
              { erro, sessao: sessao.id },
              'Falha na reavaliação da estratégia',
            ),
          )
      }
    }, intervaloSegundos * 1000)
  }

  async parar() {
    if (this.temporizador) clearInterval(this.temporizador)
    await this.aguardarOcioso()
  }

  async aguardarOcioso() {
    await Promise.all([...this.sessoes.values()].map((sessao) => sessao.aguardarOcioso()))
  }

  private async instanciar(sessao: Sessao) {
    const posicoesAbertas = await this.dependencias.repositorios.posicoes.listarAbertas(sessao.id)
    const instancia = new SessaoEmExecucao(sessao, posicoesAbertas, {
      ...this.dependencias,
      executor: this.dependencias.executorSimulado,
    })
    this.sessoes.set(sessao.id, instancia)
    return instancia
  }

  private exigir(id: string) {
    const instancia = this.sessoes.get(id)
    if (!instancia) throw new ErroDeSessao('Sessão não encontrada ou já encerrada')
    return instancia
  }
}
