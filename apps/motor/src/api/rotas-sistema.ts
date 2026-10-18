import { descreverEstrategias } from '@hot/estrategias'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ContextoDaApi } from './contexto'

const esquemaDeLimite = z.object({
  limite: z.coerce.number().int().min(1).max(1000).default(100),
  carteira: z.string().optional(),
})

export function registrarRotasDoSistema(servidor: FastifyInstance, contexto: ContextoDaApi) {
  servidor.get('/api/sistema/estado', async () => contexto.estadoDoSistema())

  servidor.get('/api/sistema/auditoria', async (requisicao) => {
    const { limite } = esquemaDeLimite.parse(requisicao.query)
    return contexto.repositorios.auditoria.listar(limite)
  })

  servidor.get('/api/estrategias', async () => descreverEstrategias())

  servidor.get('/api/operacoes', async (requisicao) => {
    const { limite, carteira } = esquemaDeLimite.parse(requisicao.query)
    return contexto.consultas.listarOperacoes(limite, carteira)
  })
}
