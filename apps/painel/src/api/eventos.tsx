import type { EventoDoSistema, Serializado } from '@hot/compartilhado'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { obterToken } from './cliente'
import { chaves } from './consultas'

const ContextoDeEventos = createContext({ conectado: false })

export function useConexaoEmTempoReal() {
  return useContext(ContextoDeEventos)
}

function chavesAfetadas(evento: Serializado<EventoDoSistema>): ReadonlyArray<readonly unknown[]> {
  switch (evento.tipo) {
    case 'operacao_registrada':
      return [chaves.operacoes, chaves.carteiras, chaves.sistema]
    case 'ciclo_atualizado':
    case 'carteiras_atualizadas':
      return [chaves.carteiras, chaves.operacoes]
    case 'ordem_atualizada':
    case 'posicao_atualizada':
      return [chaves.sessao(evento.dados.sessaoId), chaves.sessoes]
    case 'decisao_da_estrategia':
      return [chaves.sessao(evento.dados.sessaoId)]
    case 'sessao_atualizada':
      return [chaves.sessoes]
    case 'estado_do_monitor':
      return [chaves.sistema]
  }
}

export function ProvedorDeEventos({ children }: { children: ReactNode }) {
  const cliente = useQueryClient()
  const [conectado, definirConectado] = useState(false)

  useEffect(() => {
    let socket: WebSocket | null = null
    let encerrado = false
    let espera = 1000
    let reconexao: ReturnType<typeof setTimeout> | null = null
    let agendamento: ReturnType<typeof setTimeout> | null = null
    const pendentes = new Map<string, readonly unknown[]>()

    const invalidar = (chave: readonly unknown[]) => {
      pendentes.set(JSON.stringify(chave), chave)
      agendamento ??= setTimeout(() => {
        for (const queryKey of pendentes.values()) void cliente.invalidateQueries({ queryKey })
        pendentes.clear()
        agendamento = null
      }, 400)
    }

    const conectar = () => {
      const token = obterToken()
      const protocolo = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(
        `${protocolo}://${window.location.host}/api/eventos${token ? `?token=${encodeURIComponent(token)}` : ''}`,
      )
      socket.onopen = () => {
        definirConectado(true)
        espera = 1000
      }
      socket.onclose = () => {
        definirConectado(false)
        if (encerrado) return
        reconexao = setTimeout(conectar, espera)
        espera = Math.min(espera * 2, 15_000)
      }
      socket.onmessage = (mensagem) => {
        const evento = JSON.parse(mensagem.data as string) as Serializado<EventoDoSistema>
        for (const chave of chavesAfetadas(evento)) invalidar(chave)
      }
    }

    conectar()
    return () => {
      encerrado = true
      if (reconexao) clearTimeout(reconexao)
      if (agendamento) clearTimeout(agendamento)
      socket?.close()
    }
  }, [cliente])

  return <ContextoDeEventos.Provider value={{ conectado }}>{children}</ContextoDeEventos.Provider>
}
