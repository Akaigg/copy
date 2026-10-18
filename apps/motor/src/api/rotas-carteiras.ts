import { esquemaDeAtualizacaoDeCarteira, esquemaDeNovaCarteira } from '@hot/compartilhado'
import type { FastifyInstance } from 'fastify'
import type { ContextoDaApi } from './contexto'

interface ParametrosDeCarteira {
  endereco: string
}

export function registrarRotasDeCarteiras(servidor: FastifyInstance, contexto: ContextoDaApi) {
  servidor.get('/api/carteiras', async () => contexto.consultas.listarCarteiras())

  servidor.post('/api/carteiras', async (requisicao, resposta) => {
    const carteira = await contexto.adicionarCarteira(esquemaDeNovaCarteira.parse(requisicao.body))
    return resposta.code(201).send(carteira)
  })

  servidor.get<{ Params: ParametrosDeCarteira }>('/api/carteiras/:endereco', async (requisicao) =>
    contexto.consultas.detalharCarteira(requisicao.params.endereco),
  )

  servidor.patch<{ Params: ParametrosDeCarteira }>('/api/carteiras/:endereco', async (requisicao) =>
    contexto.atualizarCarteira(
      requisicao.params.endereco,
      esquemaDeAtualizacaoDeCarteira.parse(requisicao.body),
    ),
  )
}
