import { randomUUID } from 'node:crypto'
import { type Banco, criarRepositorios, type Repositorios } from '@hot/banco'
import type { OperacaoResposta } from '@hot/compartilhado'
import { aplicarOperacaoAoCiclo, type OperacaoDeOrigem } from '@hot/dominio'
import {
  type ClienteRpcSolana,
  decodificarOperacoes,
  type NotificacaoDeTransacao,
  normalizarTransacao,
  type TransacaoNormalizada,
} from '@hot/solana'
import type { BarramentoDeEventos } from '../barramento'
import type { Registro } from '../registro'
import { FilaSerial } from './fila-serial'
import type { MotorDeCopia } from './motor-de-copia'
import type { ServicoDePrecos } from './servico-de-precos'

export interface DependenciasDoProcessador {
  banco: Banco
  repositorios: Repositorios
  rpc: ClienteRpcSolana | null
  precos: ServicoDePrecos
  motor: MotorDeCopia
  barramento: BarramentoDeEventos
  registro: Registro
  aoDescobrirToken: (mint: string) => void
}

const LIMITE_DE_RECUPERACAO = 100
const MEMORIA_DE_ASSINATURAS = 5000
const TENTATIVAS_DE_BUSCA = 4
const ESPERA_ENTRE_BUSCAS_MS = 5000

export class ProcessadorDeTransacoes {
  private readonly filas = new FilaSerial()
  private readonly assinaturasRecentes = new Set<string>()
  operacoesProcessadas = 0
  ultimaOperacaoEm: Date | null = null

  constructor(private readonly dependencias: DependenciasDoProcessador) {}

  receber(notificacao: NotificacaoDeTransacao, tentativa = 1): Promise<unknown> {
    const transacao = notificacao.transacao
      ? Promise.resolve(notificacao.transacao)
      : this.buscarTransacao(notificacao.assinatura).catch(() => null)
    const tarefas = notificacao.carteiras
      .filter((carteira) => this.marcarComoVista(`${notificacao.assinatura}:${carteira}`))
      .map((carteira) =>
        this.filas.executar(carteira, async () => {
          const normalizada = await transacao
          if (normalizada) return this.aplicarTransacao(carteira, normalizada, notificacao.recebidaEm, false)
          this.reagendar({ ...notificacao, carteiras: [carteira] }, tentativa)
        }),
      )
    return Promise.all(tarefas).catch((erro) =>
      this.dependencias.registro.error(
        { erro, assinatura: notificacao.assinatura },
        'Falha ao processar transação',
      ),
    )
  }

  private reagendar(notificacao: NotificacaoDeTransacao, tentativa: number) {
    for (const carteira of notificacao.carteiras)
      this.assinaturasRecentes.delete(`${notificacao.assinatura}:${carteira}`)
    if (tentativa >= TENTATIVAS_DE_BUSCA) {
      this.dependencias.registro.error(
        { assinatura: notificacao.assinatura },
        'Transação descartada após novas tentativas',
      )
      return
    }
    setTimeout(() => void this.receber(notificacao, tentativa + 1), ESPERA_ENTRE_BUSCAS_MS * tentativa)
  }

  recuperarLacunas(carteira: string) {
    return this.filas.executar(carteira, async () => {
      const { rpc, repositorios, registro } = this.dependencias
      if (!rpc) return
      const registrada = await repositorios.carteiras.obter(carteira)
      if (!registrada) return
      if (!registrada.ultimaAssinatura) {
        const [ultima] = await rpc.obterAssinaturas(carteira, { limite: 1 })
        if (ultima) await repositorios.carteiras.atualizar(carteira, { ultimaAssinatura: ultima.signature })
        return
      }
      const perdidas = await rpc.obterAssinaturas(carteira, {
        ate: registrada.ultimaAssinatura,
        limite: LIMITE_DE_RECUPERACAO,
      })
      if (perdidas.length) registro.info({ carteira, quantidade: perdidas.length }, 'Recuperando transações')
      for (const assinatura of perdidas.reverse()) {
        if (assinatura.err || !this.marcarComoVista(`${assinatura.signature}:${carteira}`)) continue
        const transacao = await this.buscarTransacao(assinatura.signature)
        if (transacao) await this.aplicarTransacao(carteira, transacao, new Date(), false)
      }
    })
  }

  importarHistorico(carteira: string, limite: number) {
    return this.filas.executar(carteira, async () => {
      const { rpc, repositorios, registro, barramento } = this.dependencias
      if (!rpc) return
      const assinaturas = await rpc.obterAssinaturas(carteira, { limite })
      registro.info({ carteira, quantidade: assinaturas.length }, 'Importando histórico')
      for (const assinatura of [...assinaturas].reverse()) {
        if (assinatura.err) continue
        this.marcarComoVista(`${assinatura.signature}:${carteira}`)
        const transacao = await this.buscarTransacao(assinatura.signature)
        if (transacao) {
          await this.aplicarTransacao(carteira, transacao, transacao.horarioDoBloco ?? new Date(), true)
        }
      }
      const [maisRecente] = assinaturas
      if (maisRecente)
        await repositorios.carteiras.atualizar(carteira, { ultimaAssinatura: maisRecente.signature })
      barramento.publicar({ tipo: 'carteiras_atualizadas', dados: { endereco: carteira } })
    })
  }

  aguardarOcioso() {
    return this.filas.aguardarTudo()
  }

  private marcarComoVista(chave: string) {
    if (this.assinaturasRecentes.has(chave)) return false
    this.assinaturasRecentes.add(chave)
    if (this.assinaturasRecentes.size > MEMORIA_DE_ASSINATURAS) {
      const maisAntiga = this.assinaturasRecentes.values().next().value
      if (maisAntiga) this.assinaturasRecentes.delete(maisAntiga)
    }
    return true
  }

  private async buscarTransacao(assinatura: string): Promise<TransacaoNormalizada | null> {
    const { rpc, registro } = this.dependencias
    if (!rpc) return null
    const bruta = await rpc.obterTransacaoComRetentativas(assinatura)
    if (!bruta) {
      registro.warn({ assinatura }, 'Transação não encontrada no RPC')
      return null
    }
    return normalizarTransacao(bruta)
  }

  private async aplicarTransacao(
    carteira: string,
    transacao: TransacaoNormalizada,
    recebidaEm: Date,
    historica: boolean,
  ) {
    const precoSolEmUsd = await this.dependencias.precos.precoSolEmUsd()
    const operacoes = decodificarOperacoes(transacao, carteira, {
      precoSolEmUsd,
      horarioDeDeteccao: recebidaEm,
    })
    for (const operacao of operacoes) await this.registrarOperacao(operacao, historica)
    if (!historica) {
      await this.dependencias.repositorios.carteiras.atualizar(carteira, {
        ultimaAssinatura: transacao.assinatura,
      })
    }
  }

  private async registrarOperacao(operacao: OperacaoDeOrigem, historica: boolean) {
    const { banco, repositorios, barramento, motor } = this.dependencias
    const registrada = await banco.transaction(async (transacao) => {
      const escopo = criarRepositorios(transacao as unknown as Banco)
      if (await escopo.operacoes.existe(operacao.id)) return null
      const cicloAberto = await escopo.ciclos.obterAberto(operacao.carteira, operacao.token)
      const custoAbertoDoTraderSol = await escopo.ciclos.custoAbertoDaCarteira(operacao.carteira)
      const { ciclo, efeito } = aplicarOperacaoAoCiclo(cicloAberto, operacao, randomUUID)
      if (ciclo) await escopo.ciclos.salvar(ciclo)
      await escopo.operacoes.inserir(operacao, ciclo?.id ?? null, efeito, historica)
      return { ciclo, efeito, custoAbertoDoTraderSol }
    })
    if (!registrada) return

    this.operacoesProcessadas++
    this.ultimaOperacaoEm = operacao.horarioDeDeteccao
    if (await repositorios.tokens.registrarSeAusente(operacao.token, operacao.decimais)) {
      this.dependencias.aoDescobrirToken(operacao.token)
    }

    const [carteira, [token]] = await Promise.all([
      repositorios.carteiras.obter(operacao.carteira),
      repositorios.tokens.listarPorMints([operacao.token]),
    ])
    const resposta: OperacaoResposta = {
      ...operacao,
      cicloId: registrada.ciclo?.id ?? null,
      efeitoNoCiclo: registrada.efeito,
      historica,
      apelidoDaCarteira: carteira?.apelido ?? null,
      simboloDoToken: token?.simbolo ?? null,
    }
    barramento.publicar({ tipo: 'operacao_registrada', dados: resposta })
    if (registrada.ciclo) barramento.publicar({ tipo: 'ciclo_atualizado', dados: registrada.ciclo })

    if (historica) return
    await motor.processarOperacao({
      operacao,
      cicloDeOrigemId: registrada.ciclo?.id ?? null,
      efeitoNoCiclo: registrada.efeito,
      custoAbertoDoTraderSol: registrada.custoAbertoDoTraderSol,
    })
    if (registrada.efeito === 'encerrou') await motor.aoEncerrarCicloDoTrader(operacao.carteira)
  }
}
