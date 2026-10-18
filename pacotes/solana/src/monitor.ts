import WebSocket from 'ws'
import { normalizarTransacao } from './normalizar'
import type { TransacaoNormalizada, TransacaoRpc } from './tipos'

export interface NotificacaoDeTransacao {
  assinatura: string
  carteiras: string[]
  transacao: TransacaoNormalizada | null
  recebidaEm: Date
}

export interface RegistroDoMonitor {
  info(mensagem: string): void
  aviso(mensagem: string): void
}

export interface FonteDeTransacoes {
  readonly conectada: boolean
  iniciar(): void
  parar(): void
  atualizarCarteiras(carteiras: string[]): void
  aoReceber(ouvinte: (notificacao: NotificacaoDeTransacao) => void): void
  aoReconectar(ouvinte: () => void): void
  aoMudarConexao(ouvinte: (conectada: boolean) => void): void
}

interface MensagemJsonRpc {
  id?: number
  result?: unknown
  error?: { message: string }
  method?: string
  params?: { subscription: number; result: unknown }
}

const INTERVALO_DE_PING_MS = 30_000
const ESPERA_MAXIMA_DE_RECONEXAO_MS = 30_000

abstract class FonteWebSocket implements FonteDeTransacoes {
  protected socket: WebSocket | null = null
  protected carteiras = new Set<string>()
  private ouvintesDeTransacao: Array<(notificacao: NotificacaoDeTransacao) => void> = []
  private ouvintesDeReconexao: Array<() => void> = []
  private ouvintesDeConexao: Array<(conectada: boolean) => void> = []
  private temporizadorDePing: NodeJS.Timeout | null = null
  private tentativasDeReconexao = 0
  private parada = true
  private jaConectou = false
  private proximoIdentificador = 1
  private respostasPendentes = new Map<number, (resultado: unknown) => void>()

  constructor(
    protected readonly url: string,
    protected readonly registro: RegistroDoMonitor,
  ) {}

  get conectada() {
    return this.socket?.readyState === WebSocket.OPEN
  }

  iniciar() {
    this.parada = false
    this.conectar()
  }

  parar() {
    this.parada = true
    if (this.temporizadorDePing) clearInterval(this.temporizadorDePing)
    this.socket?.close()
    this.socket = null
  }

  atualizarCarteiras(carteiras: string[]) {
    const novas = new Set(carteiras)
    const adicionadas = [...novas].filter((carteira) => !this.carteiras.has(carteira))
    const removidas = [...this.carteiras].filter((carteira) => !novas.has(carteira))
    this.carteiras = novas
    if (this.conectada && (adicionadas.length || removidas.length))
      this.sincronizarAssinaturas(adicionadas, removidas)
  }

  aoReceber(ouvinte: (notificacao: NotificacaoDeTransacao) => void) {
    this.ouvintesDeTransacao.push(ouvinte)
  }

  aoReconectar(ouvinte: () => void) {
    this.ouvintesDeReconexao.push(ouvinte)
  }

  aoMudarConexao(ouvinte: (conectada: boolean) => void) {
    this.ouvintesDeConexao.push(ouvinte)
  }

  protected abstract assinarTudo(): void
  protected abstract sincronizarAssinaturas(adicionadas: string[], removidas: string[]): void
  protected abstract tratarNotificacao(assinatura: number, resultado: unknown): void

  protected emitir(notificacao: NotificacaoDeTransacao) {
    for (const ouvinte of this.ouvintesDeTransacao) ouvinte(notificacao)
  }

  protected enviar(metodo: string, parametros: unknown[], aoResponder?: (resultado: unknown) => void) {
    const identificador = this.proximoIdentificador++
    if (aoResponder) this.respostasPendentes.set(identificador, aoResponder)
    this.socket?.send(
      JSON.stringify({ jsonrpc: '2.0', id: identificador, method: metodo, params: parametros }),
    )
  }

  private conectar() {
    if (this.parada) return
    const socket = new WebSocket(this.url)
    this.socket = socket

    socket.on('open', () => {
      this.registro.info(`Monitor conectado (${this.carteiras.size} carteiras)`)
      this.tentativasDeReconexao = 0
      this.respostasPendentes.clear()
      this.temporizadorDePing = setInterval(() => socket.ping(), INTERVALO_DE_PING_MS)
      this.assinarTudo()
      for (const ouvinte of this.ouvintesDeConexao) ouvinte(true)
      if (this.jaConectou) for (const ouvinte of this.ouvintesDeReconexao) ouvinte()
      this.jaConectou = true
    })

    socket.on('message', (dados) => {
      const mensagem = JSON.parse(dados.toString()) as MensagemJsonRpc
      if (mensagem.error) this.registro.aviso(`Erro do provedor: ${mensagem.error.message}`)
      if (mensagem.id !== undefined) {
        const aoResponder = this.respostasPendentes.get(mensagem.id)
        this.respostasPendentes.delete(mensagem.id)
        if (aoResponder && mensagem.result !== undefined) aoResponder(mensagem.result)
        return
      }
      if (mensagem.params) this.tratarNotificacao(mensagem.params.subscription, mensagem.params.result)
    })

    socket.on('close', () => {
      if (this.temporizadorDePing) clearInterval(this.temporizadorDePing)
      for (const ouvinte of this.ouvintesDeConexao) ouvinte(false)
      if (this.parada) return
      const espera = Math.min(ESPERA_MAXIMA_DE_RECONEXAO_MS, 1000 * 2 ** this.tentativasDeReconexao++)
      this.registro.aviso(`Monitor desconectado. Nova tentativa em ${espera / 1000}s`)
      setTimeout(() => this.conectar(), espera)
    })

    socket.on('error', (erro) => this.registro.aviso(`Erro no monitor: ${erro.message}`))
  }
}

export class FonteDeLogs extends FonteWebSocket {
  private carteiraPorAssinatura = new Map<number, string>()
  private assinaturaPorCarteira = new Map<string, number>()

  protected assinarTudo() {
    this.carteiraPorAssinatura.clear()
    this.assinaturaPorCarteira.clear()
    for (const carteira of this.carteiras) this.assinar(carteira)
  }

  protected sincronizarAssinaturas(adicionadas: string[], removidas: string[]) {
    for (const carteira of adicionadas) this.assinar(carteira)
    for (const carteira of removidas) {
      const assinatura = this.assinaturaPorCarteira.get(carteira)
      if (assinatura === undefined) continue
      this.enviar('logsUnsubscribe', [assinatura])
      this.assinaturaPorCarteira.delete(carteira)
      this.carteiraPorAssinatura.delete(assinatura)
    }
  }

  protected tratarNotificacao(assinatura: number, resultado: unknown) {
    const carteira = this.carteiraPorAssinatura.get(assinatura)
    const valor = (resultado as { value?: { signature: string; err: unknown } }).value
    if (!carteira || !valor || valor.err) return
    this.emitir({
      assinatura: valor.signature,
      carteiras: [carteira],
      transacao: null,
      recebidaEm: new Date(),
    })
  }

  private assinar(carteira: string) {
    this.enviar('logsSubscribe', [{ mentions: [carteira] }, { commitment: 'confirmed' }], (resultado) => {
      const assinatura = resultado as number
      this.carteiraPorAssinatura.set(assinatura, carteira)
      this.assinaturaPorCarteira.set(carteira, assinatura)
    })
  }
}

export class FonteHelius extends FonteWebSocket {
  private assinaturaAtual: number | null = null

  protected assinarTudo() {
    this.assinaturaAtual = null
    if (this.carteiras.size === 0) return
    this.enviar(
      'transactionSubscribe',
      [
        { accountInclude: [...this.carteiras], failed: false, vote: false },
        {
          commitment: 'confirmed',
          encoding: 'jsonParsed',
          transactionDetails: 'full',
          maxSupportedTransactionVersion: 0,
        },
      ],
      (resultado) => {
        this.assinaturaAtual = resultado as number
      },
    )
  }

  protected sincronizarAssinaturas() {
    if (this.assinaturaAtual !== null) this.enviar('transactionUnsubscribe', [this.assinaturaAtual])
    this.assinarTudo()
  }

  protected tratarNotificacao(assinatura: number, resultado: unknown) {
    if (assinatura !== this.assinaturaAtual) return
    const dados = resultado as {
      signature: string
      slot: number
      transaction: { transaction: TransacaoRpc['transaction']; meta: TransacaoRpc['meta'] }
    }
    const transacao = normalizarTransacao({
      slot: dados.slot,
      blockTime: null,
      meta: dados.transaction.meta,
      transaction: dados.transaction.transaction,
    })
    if (!transacao) return
    const carteiras = transacao.contas.filter((conta) => this.carteiras.has(conta))
    this.emitir({ assinatura: dados.signature, carteiras, transacao, recebidaEm: new Date() })
  }
}
