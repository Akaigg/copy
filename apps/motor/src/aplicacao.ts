import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { type ConexaoComBanco, conectarBanco, criarRepositorios } from '@hot/banco'
import {
  type AtualizacaoDeCarteira,
  type ConfiguracaoDaSessaoEnviada,
  type EstadoDoSistema,
  esquemaDeNovaCarteira,
  type NovaCarteira,
  type NovaSessao,
} from '@hot/compartilhado'
import { type Executor, ExecutorDeReferencia } from '@hot/dominio'
import {
  ClienteJupiter,
  ClienteRpcSolana,
  ExecutorSimuladoJupiter,
  FonteDeLogs,
  type FonteDeTransacoes,
  FonteHelius,
} from '@hot/solana'
import type { ContextoDaApi } from './api/contexto'
import { criarServidor, ErroDeConflito } from './api/servidor'
import { BarramentoDeEventos } from './barramento'
import type { Configuracao } from './configuracao'
import type { Registro } from './registro'
import { Consultas, ErroNaoEncontrado } from './servicos/consultas'
import { MotorDeCopia } from './servicos/motor-de-copia'
import { ProcessadorDeTransacoes } from './servicos/processador-de-transacoes'
import { type ServicoDePrecos, ServicoDePrecosJupiter } from './servicos/servico-de-precos'

export interface Substituicoes {
  executor?: Executor
  precos?: ServicoDePrecos
  fonte?: FonteDeTransacoes | null
  rpc?: ClienteRpcSolana | null
  relogio?: () => Date
  esperar?: (milissegundos: number) => Promise<void>
  pastaDoPainel?: string | null
}

const PASTA_DO_PAINEL = fileURLToPath(new URL('../../painel/dist', import.meta.url))

function criarFonte(configuracao: Configuracao, registro: Registro): FonteDeTransacoes | null {
  const registroDoMonitor = {
    info: (mensagem: string) => registro.info(mensagem),
    aviso: (mensagem: string) => registro.warn(mensagem),
  }
  switch (configuracao.FONTE_DE_TRANSACOES) {
    case 'logs':
      return new FonteDeLogs(configuracao.SOLANA_WS_URL, registroDoMonitor)
    case 'helius':
      return new FonteHelius(configuracao.SOLANA_WS_URL, registroDoMonitor)
    case 'desativada':
      return null
  }
}

function criarExecutor(configuracao: Configuracao, jupiter: ClienteJupiter): Executor {
  if (configuracao.EXECUTOR_SIMULADO === 'referencia') {
    return new ExecutorDeReferencia({
      penalidadeDePrecoBps: configuracao.PENALIDADE_SEM_COTACAO_BPS,
      taxaPorOperacaoSol: configuracao.TAXA_ESTIMADA_POR_OPERACAO_SOL,
    })
  }
  return new ExecutorSimuladoJupiter({
    jupiter,
    latenciaAdicionalMs: configuracao.LATENCIA_SIMULADA_MS,
    taxaPorOperacaoSol: configuracao.TAXA_ESTIMADA_POR_OPERACAO_SOL,
    usarPrecoDoTraderSemCotacao: true,
    penalidadeSemCotacaoBps: configuracao.PENALIDADE_SEM_COTACAO_BPS,
  })
}

export async function criarAplicacao(
  configuracao: Configuracao,
  registro: Registro,
  substituicoes: Substituicoes = {},
) {
  const conexao: ConexaoComBanco = await conectarBanco(configuracao.BANCO_URL)
  const repositorios = criarRepositorios(conexao.banco)
  const barramento = new BarramentoDeEventos()
  const jupiter = new ClienteJupiter({
    urlBase: configuracao.JUPITER_API_URL,
    chaveDeApi: configuracao.JUPITER_API_CHAVE,
  })
  const precos = substituicoes.precos ?? new ServicoDePrecosJupiter(jupiter)
  const rpc =
    substituicoes.rpc !== undefined ? substituicoes.rpc : new ClienteRpcSolana(configuracao.SOLANA_RPC_URL)
  const fonte = substituicoes.fonte !== undefined ? substituicoes.fonte : criarFonte(configuracao, registro)
  const iniciadoEm = new Date()

  const motor = new MotorDeCopia({
    repositorios,
    executorSimulado: substituicoes.executor ?? criarExecutor(configuracao, jupiter),
    barramento,
    registro,
    tentativasDeVenda: configuracao.TENTATIVAS_DE_VENDA,
    relogio: substituicoes.relogio ?? (() => new Date()),
    gerarIdentificador: randomUUID,
    esperar:
      substituicoes.esperar ??
      ((milissegundos) => new Promise((resolver) => setTimeout(resolver, milissegundos))),
  })

  const enriquecerToken = async (mint: string) => {
    try {
      const informacoes = await jupiter.obterInformacoesDoToken(mint)
      if (!informacoes) return
      await repositorios.tokens.atualizarMetadados(mint, {
        simbolo: informacoes.simbolo,
        nome: informacoes.nome,
        icone: informacoes.icone,
      })
    } catch (erro) {
      registro.debug({ erro, mint }, 'Metadados do token indisponíveis')
    }
  }

  const processador = new ProcessadorDeTransacoes({
    banco: conexao.banco,
    repositorios,
    rpc,
    precos,
    motor,
    barramento,
    registro,
    aoDescobrirToken: (mint) => void enriquecerToken(mint),
  })
  const consultas = new Consultas(repositorios, precos, motor)

  const carteirasParaMonitorar = async () => {
    const monitoradas = await repositorios.carteiras.listarPorStatus('monitorada')
    return [...new Set([...monitoradas.map((carteira) => carteira.endereco), ...motor.carteirasEmUso()])]
  }

  let quantidadeMonitorada = 0
  const sincronizarMonitor = async () => {
    const carteiras = await carteirasParaMonitorar()
    quantidadeMonitorada = carteiras.length
    fonte?.atualizarCarteiras(carteiras)
  }

  const garantirCarteiras = async (enderecos: string[]) => {
    for (const endereco of enderecos) {
      const existente = await repositorios.carteiras.obter(endereco)
      if (!existente) {
        await repositorios.carteiras.criar({ endereco })
        void processador.recuperarLacunas(endereco)
      } else if (existente.status !== 'monitorada') {
        await repositorios.carteiras.atualizar(endereco, { status: 'monitorada' })
      }
    }
  }

  const contexto: ContextoDaApi = {
    configuracao,
    repositorios,
    consultas,
    motor,
    barramento,
    registro,
    pastaDoPainel: substituicoes.pastaDoPainel !== undefined ? substituicoes.pastaDoPainel : PASTA_DO_PAINEL,
    estadoDoSistema: (): EstadoDoSistema => ({
      monitor: {
        fonte: configuracao.FONTE_DE_TRANSACOES,
        conectada: fonte?.conectada ?? false,
        carteiras: quantidadeMonitorada,
      },
      executorSimulado: configuracao.EXECUTOR_SIMULADO,
      sessoesAtivas: motor.quantidadeDeSessoesAtivas(),
      operacoesProcessadas: processador.operacoesProcessadas,
      ultimaOperacaoEm: processador.ultimaOperacaoEm,
      iniciadoEm,
    }),
    adicionarCarteira: async (dados: NovaCarteira) => {
      const validados = esquemaDeNovaCarteira.parse(dados)
      if (await repositorios.carteiras.obter(validados.endereco))
        throw new ErroDeConflito('Carteira já cadastrada')
      const carteira = await repositorios.carteiras.criar({
        endereco: validados.endereco,
        apelido: validados.apelido ?? null,
      })
      await repositorios.auditoria.registrar(
        'carteira_adicionada',
        `Carteira ${validados.endereco} adicionada`,
      )
      await sincronizarMonitor()
      if (validados.importarHistorico > 0)
        void processador.importarHistorico(validados.endereco, validados.importarHistorico)
      else void processador.recuperarLacunas(validados.endereco)
      barramento.publicar({ tipo: 'carteiras_atualizadas', dados: { endereco: validados.endereco } })
      return carteira
    },
    atualizarCarteira: async (endereco: string, dados: AtualizacaoDeCarteira) => {
      const atualizada = await repositorios.carteiras.atualizar(endereco, dados)
      if (!atualizada) throw new ErroNaoEncontrado('Carteira não encontrada')
      await sincronizarMonitor()
      barramento.publicar({ tipo: 'carteiras_atualizadas', dados: { endereco } })
      return atualizada
    },
    criarSessao: async (dados: NovaSessao) => {
      await garantirCarteiras(dados.configuracao.carteiras.map((carteira) => carteira.endereco))
      const sessao = await motor.criarSessao(dados)
      await sincronizarMonitor()
      return sessao
    },
    reconfigurarSessao: async (id: string, enviada: ConfiguracaoDaSessaoEnviada) => {
      await garantirCarteiras(enviada.carteiras.map((carteira) => carteira.endereco))
      const sessao = await motor.atualizarConfiguracao(id, enviada)
      await sincronizarMonitor()
      return sessao
    },
    sincronizarMonitor,
  }

  const servidor = await criarServidor(contexto)

  return {
    contexto,
    servidor,
    processador,
    motor,
    repositorios,
    async iniciar(escutar = true) {
      await motor.carregar()
      if (fonte) {
        fonte.aoReceber((notificacao) => void processador.receber(notificacao))
        fonte.aoMudarConexao((conectada) =>
          barramento.publicar({ tipo: 'estado_do_monitor', dados: { conectada } }),
        )
        fonte.aoReconectar(async () => {
          for (const carteira of await carteirasParaMonitorar()) void processador.recuperarLacunas(carteira)
        })
        await sincronizarMonitor()
        fonte.iniciar()
        for (const carteira of await carteirasParaMonitorar()) void processador.recuperarLacunas(carteira)
      }
      motor.iniciarReavaliacaoPeriodica(configuracao.INTERVALO_DE_REAVALIACAO_SEGUNDOS)
      if (escutar) await servidor.listen({ host: configuracao.HOST, port: configuracao.PORTA })
    },
    async parar() {
      fonte?.parar()
      await processador.aguardarOcioso()
      await motor.parar()
      await servidor.close()
      await conexao.fechar()
    },
  }
}

export type Aplicacao = Awaited<ReturnType<typeof criarAplicacao>>
