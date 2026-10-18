import { z } from 'zod'

export const esquemaDeEndereco = z
  .string()
  .trim()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Endereço Solana inválido')

export const esquemaDeNovaCarteira = z.object({
  endereco: esquemaDeEndereco,
  apelido: z.string().trim().max(60).optional(),
  importarHistorico: z.number().int().min(0).max(1000).default(0),
})

export const esquemaDeAtualizacaoDeCarteira = z.object({
  apelido: z.string().trim().max(60).nullable().optional(),
  status: z.enum(['candidata', 'monitorada', 'descartada']).optional(),
  observacoes: z.string().max(2000).nullable().optional(),
  etiquetas: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
})

export const esquemaDeDimensionamento = z.object({
  modo: z
    .enum(['proporcional_ao_patrimonio', 'multiplicador_fixo', 'valor_fixo'])
    .default('proporcional_ao_patrimonio'),
  multiplicador: z.number().positive().default(1),
  valorFixoSol: z.number().positive().default(0.05),
  aoFaltarCapital: z.enum(['reduzir', 'nao_copiar']).default('reduzir'),
})

export const esquemaDeLimites = z.object({
  valorMinimoPorOrdemSol: z.number().min(0).default(0.001),
  valorMaximoPorOrdemSol: z.number().positive().default(1),
  exposicaoMaximaPorTokenSol: z.number().positive().default(2),
  posicoesAbertasMaximas: z.number().int().min(1).default(20),
  volumeDiarioMaximoDeComprasSol: z.number().positive().default(20),
  idadeMaximaParaCopiarCompraSegundos: z.number().positive().default(30),
  slippageMaximoBps: z.number().int().min(1).max(10_000).default(2000),
})

export const esquemaDeRegras = z.object({
  transferenciaDeSaida: z.enum(['ignorar', 'espelhar_como_venda']).default('ignorar'),
})

export const esquemaDeCarteiraDaSessao = z.object({
  endereco: esquemaDeEndereco,
  fracaoDoCapital: z.number().min(0).max(1),
})

export const esquemaDeConfiguracaoDaSessao = z
  .object({
    carteiras: z.array(esquemaDeCarteiraDaSessao).min(1, 'Selecione ao menos uma carteira'),
    estrategiaIdentificador: z.string().default('tradicional'),
    estrategiaConfiguracao: z.record(z.string(), z.unknown()).default({}),
    dimensionamento: esquemaDeDimensionamento.default(esquemaDeDimensionamento.parse({})),
    limites: esquemaDeLimites.default(esquemaDeLimites.parse({})),
    regras: esquemaDeRegras.default(esquemaDeRegras.parse({})),
  })
  .refine((dados) => new Set(dados.carteiras.map((c) => c.endereco)).size === dados.carteiras.length, {
    message: 'Carteira repetida na sessão',
    path: ['carteiras'],
  })
  .refine((dados) => dados.carteiras.reduce((total, c) => total + c.fracaoDoCapital, 0) <= 1.0001, {
    message: 'A soma das frações de capital não pode passar de 100%',
    path: ['carteiras'],
  })

export const esquemaDeNovaSessao = z.object({
  nome: z.string().trim().min(1).max(80),
  modo: z.literal('simulado').default('simulado'),
  capitalInicialSol: z.number().positive(),
  configuracao: esquemaDeConfiguracaoDaSessao,
})

export const esquemaDeMudancaDeStatus = z.object({
  status: z.enum(['ativa', 'pausada', 'encerrada']),
})

export type NovaCarteira = z.input<typeof esquemaDeNovaCarteira>
export type AtualizacaoDeCarteira = z.input<typeof esquemaDeAtualizacaoDeCarteira>
export type ConfiguracaoDaSessaoEnviada = z.input<typeof esquemaDeConfiguracaoDaSessao>
export type NovaSessao = z.input<typeof esquemaDeNovaSessao>
