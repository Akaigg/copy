import { existsSync } from 'node:fs'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { ErroNaoEncontrado } from '../servicos/consultas'
import { ErroDeSessao } from '../servicos/motor-de-copia'
import type { ContextoDaApi } from './contexto'
import { registrarRotasDeCarteiras } from './rotas-carteiras'
import { registrarRotasDeSessoes } from './rotas-sessoes'
import { registrarRotasDoSistema } from './rotas-sistema'

export class ErroDeConflito extends Error {}

function tokenDaRequisicao(cabecalho: string | undefined, consulta: unknown) {
  if (cabecalho?.startsWith('Bearer ')) return cabecalho.slice('Bearer '.length)
  return (consulta as { token?: string } | undefined)?.token ?? null
}

export async function criarServidor(contexto: ContextoDaApi): Promise<FastifyInstance> {
  const servidor = Fastify({ logger: false })
  await servidor.register(fastifyWebsocket)

  servidor.addHook('onRequest', async (requisicao, resposta) => {
    const tokenExigido = contexto.configuracao.PAINEL_TOKEN
    if (!tokenExigido || !requisicao.url.startsWith('/api')) return
    if (tokenDaRequisicao(requisicao.headers.authorization, requisicao.query) !== tokenExigido) {
      await resposta.code(401).send({ erro: 'Não autorizado' })
    }
  })

  servidor.setErrorHandler(async (erro, _requisicao, resposta) => {
    if (erro instanceof ZodError) {
      return resposta.code(400).send({
        erro: erro.issues
          .map((problema) => `${problema.path.join('.') || 'dados'}: ${problema.message}`)
          .join('; '),
      })
    }
    if (erro instanceof ErroNaoEncontrado) return resposta.code(404).send({ erro: erro.message })
    if (erro instanceof ErroDeSessao) return resposta.code(400).send({ erro: erro.message })
    if (erro instanceof ErroDeConflito) return resposta.code(409).send({ erro: erro.message })
    contexto.registro.error({ erro }, 'Erro na API')
    return resposta.code(500).send({ erro: erro instanceof Error ? erro.message : 'Erro interno' })
  })

  servidor.get('/api/eventos', { websocket: true }, (socket) => {
    const cancelar = contexto.barramento.assinar((evento) => socket.send(JSON.stringify(evento)))
    socket.on('close', cancelar)
  })

  registrarRotasDoSistema(servidor, contexto)
  registrarRotasDeCarteiras(servidor, contexto)
  registrarRotasDeSessoes(servidor, contexto)

  if (contexto.pastaDoPainel && existsSync(contexto.pastaDoPainel)) {
    await servidor.register(fastifyStatic, { root: contexto.pastaDoPainel })
    servidor.setNotFoundHandler(async (requisicao, resposta) => {
      if (requisicao.url.startsWith('/api')) return resposta.code(404).send({ erro: 'Rota não encontrada' })
      return resposta.sendFile('index.html')
    })
  }

  return servidor
}
