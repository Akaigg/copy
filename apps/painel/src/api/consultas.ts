import type {
  CarteiraResposta,
  ComparacaoDeCiclo,
  ConfiguracaoDaSessaoEnviada,
  DesempenhoDaCarteiraNaSessao,
  DetalheDaCarteiraResposta,
  EstadoDoSistema,
  EstrategiaResposta,
  NovaCarteira,
  NovaSessao,
  OperacaoResposta,
  OrdemResposta,
  PontoDaCurva,
  PosicaoResposta,
  ResumoDaSessaoResposta,
  Serializado,
} from '@hot/compartilhado'
import type { Sessao, StatusDaSessao } from '@hot/dominio'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requisitar } from './cliente'

export interface DecisaoResposta {
  id: number
  sessaoId: string
  momento: string
  carteirasAtivas: Array<{ endereco: string; fracaoDoCapital: number }>
  motivo: string
}

export interface EventoDeAuditoriaResposta {
  id: number
  momento: string
  tipo: string
  descricao: string
  dados: unknown
}

export const chaves = {
  sistema: ['sistema'] as const,
  carteiras: ['carteiras'] as const,
  operacoes: ['operacoes'] as const,
  estrategias: ['estrategias'] as const,
  sessoes: ['sessoes'] as const,
  sessao: (id: string) => ['sessoes', id] as const,
}

export const useEstadoDoSistema = () =>
  useQuery({
    queryKey: [...chaves.sistema, 'estado'],
    queryFn: () => requisitar<Serializado<EstadoDoSistema>>('/api/sistema/estado'),
    refetchInterval: 10_000,
  })

export const useAuditoria = () =>
  useQuery({
    queryKey: [...chaves.sistema, 'auditoria'],
    queryFn: () => requisitar<EventoDeAuditoriaResposta[]>('/api/sistema/auditoria?limite=200'),
  })

export const useCarteiras = () =>
  useQuery({
    queryKey: chaves.carteiras,
    queryFn: () => requisitar<Serializado<CarteiraResposta>[]>('/api/carteiras'),
  })

export const useCarteira = (endereco: string) =>
  useQuery({
    queryKey: [...chaves.carteiras, endereco],
    queryFn: () => requisitar<Serializado<DetalheDaCarteiraResposta>>(`/api/carteiras/${endereco}`),
  })

export const useOperacoes = (limite = 100, carteira?: string) =>
  useQuery({
    queryKey: [...chaves.operacoes, limite, carteira ?? 'todas'],
    queryFn: () =>
      requisitar<Serializado<OperacaoResposta>[]>(
        `/api/operacoes?limite=${limite}${carteira ? `&carteira=${carteira}` : ''}`,
      ),
  })

export const useEstrategias = () =>
  useQuery({
    queryKey: chaves.estrategias,
    queryFn: () => requisitar<EstrategiaResposta[]>('/api/estrategias'),
    staleTime: Number.POSITIVE_INFINITY,
  })

export const useSessoes = () =>
  useQuery({
    queryKey: chaves.sessoes,
    queryFn: () => requisitar<Serializado<ResumoDaSessaoResposta>[]>('/api/sessoes'),
  })

export const useSessao = (id: string) =>
  useQuery({
    queryKey: [...chaves.sessao(id), 'resumo'],
    queryFn: () => requisitar<Serializado<ResumoDaSessaoResposta>>(`/api/sessoes/${id}`),
  })

export const usePosicoes = (id: string) =>
  useQuery({
    queryKey: [...chaves.sessao(id), 'posicoes'],
    queryFn: () => requisitar<Serializado<PosicaoResposta>[]>(`/api/sessoes/${id}/posicoes`),
  })

export const useOrdens = (id: string) =>
  useQuery({
    queryKey: [...chaves.sessao(id), 'ordens'],
    queryFn: () => requisitar<Serializado<OrdemResposta>[]>(`/api/sessoes/${id}/ordens`),
  })

export const useDesempenhoPorCarteira = (id: string) =>
  useQuery({
    queryKey: [...chaves.sessao(id), 'carteiras'],
    queryFn: () => requisitar<Serializado<DesempenhoDaCarteiraNaSessao>[]>(`/api/sessoes/${id}/carteiras`),
  })

export const useComparacao = (id: string) =>
  useQuery({
    queryKey: [...chaves.sessao(id), 'comparacao'],
    queryFn: () => requisitar<Serializado<ComparacaoDeCiclo>[]>(`/api/sessoes/${id}/comparacao`),
  })

export const useDecisoes = (id: string) =>
  useQuery({
    queryKey: [...chaves.sessao(id), 'decisoes'],
    queryFn: () => requisitar<DecisaoResposta[]>(`/api/sessoes/${id}/decisoes`),
  })

export const useCurva = (id: string) =>
  useQuery({
    queryKey: [...chaves.sessao(id), 'curva'],
    queryFn: () => requisitar<Serializado<PontoDaCurva>[]>(`/api/sessoes/${id}/curva`),
  })

export function useAdicionarCarteira() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (dados: NovaCarteira) => requisitar('/api/carteiras', { metodo: 'POST', corpo: dados }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: chaves.carteiras }),
  })
}

export function useAtualizarCarteira(endereco: string) {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (dados: Record<string, unknown>) =>
      requisitar(`/api/carteiras/${endereco}`, { metodo: 'PATCH', corpo: dados }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: chaves.carteiras }),
  })
}

export function useCriarSessao() {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (dados: NovaSessao) =>
      requisitar<Serializado<Sessao>>('/api/sessoes', { metodo: 'POST', corpo: dados }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: chaves.sessoes }),
  })
}

export function useReconfigurarSessao(id: string) {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (dados: ConfiguracaoDaSessaoEnviada) =>
      requisitar<Serializado<Sessao>>(`/api/sessoes/${id}/configuracao`, { metodo: 'PUT', corpo: dados }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: chaves.sessoes }),
  })
}

export function useAlterarStatusDaSessao(id: string) {
  const cliente = useQueryClient()
  return useMutation({
    mutationFn: (status: StatusDaSessao) =>
      requisitar(`/api/sessoes/${id}/status`, { metodo: 'POST', corpo: { status } }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: chaves.sessoes }),
  })
}
