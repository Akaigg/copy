import {
  esquemaDeConfiguracaoDaSessao,
  esquemaDeMudancaDeStatus,
  esquemaDeNovaSessao,
} from '@hot/compartilhado'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ContextoDaApi } from './contexto'

interface ParametrosDeSessao {
  id: string
}

const esquemaDeFiltroDePosicoes = z.object({ status: z.enum(['aberta', 'encerrada']).optional() })
const esquemaDeLimite = z.object({ limite: z.coerce.number().int().min(1).max(2000).default(300) })

export function registrarRotasDeSessoes(servidor: FastifyInstance, contexto: ContextoDaApi) {
  const { consultas, motor } = contexto

  servidor.get('/api/sessoes', async () => consultas.listarResumosDeSessoes())

  servidor.post('/api/sessoes', async (requisicao, resposta) => {
    const sessao = await contexto.criarSessao(esquemaDeNovaSessao.parse(requisicao.body))
    return resposta.code(201).send(sessao)
  })

  servidor.get<{ Params: ParametrosDeSessao }>('/api/sessoes/:id', async (requisicao) =>
    consultas.resumirSessao(requisicao.params.id),
  )

  servidor.get<{ Params: ParametrosDeSessao }>('/api/sessoes/:id/posicoes', async (requisicao) => {
    const { status } = esquemaDeFiltroDePosicoes.parse(requisicao.query)
    return consultas.listarPosicoes(requisicao.params.id, status)
  })

  servidor.get<{ Params: ParametrosDeSessao }>('/api/sessoes/:id/ordens', async (requisicao) => {
    const { limite } = esquemaDeLimite.parse(requisicao.query)
    return consultas.listarOrdens(requisicao.params.id, limite)
  })

  servidor.get<{ Params: ParametrosDeSessao }>('/api/sessoes/:id/carteiras', async (requisicao) =>
    consultas.desempenhoPorCarteira(requisicao.params.id),
  )

  servidor.get<{ Params: ParametrosDeSessao }>('/api/sessoes/:id/comparacao', async (requisicao) =>
    consultas.compararComTraders(requisicao.params.id),
  )

  servidor.get<{ Params: ParametrosDeSessao }>('/api/sessoes/:id/decisoes', async (requisicao) =>
    consultas.listarDecisoes(requisicao.params.id),
  )

  servidor.get<{ Params: ParametrosDeSessao }>('/api/sessoes/:id/curva', async (requisicao) =>
    consultas.curvaDeResultado(requisicao.params.id),
  )

  servidor.post<{ Params: ParametrosDeSessao }>('/api/sessoes/:id/status', async (requisicao) => {
    const { status } = esquemaDeMudancaDeStatus.parse(requisicao.body)
    const sessao = await motor.alterarStatus(requisicao.params.id, status)
    await contexto.sincronizarMonitor()
    return sessao
  })

  servidor.put<{ Params: ParametrosDeSessao }>('/api/sessoes/:id/configuracao', async (requisicao) => {
    return contexto.reconfigurarSessao(
      requisicao.params.id,
      esquemaDeConfiguracaoDaSessao.parse(requisicao.body),
    )
  })
}
