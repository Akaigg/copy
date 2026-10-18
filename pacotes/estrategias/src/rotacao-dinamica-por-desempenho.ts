import { calcularMetricas, type EstrategiaDeCopia, type ResumoDeCiclo } from '@hot/dominio'
import { z } from 'zod'
import { abreviarEndereco, ciclosDaCarteira, descreverAtivas, ordenarPelaFila } from './utilidades'

const esquema = z.object({
  quantidadeDeCarteiras: z
    .number()
    .int()
    .min(1)
    .default(2)
    .describe('Quantidade de carteiras ativas ao mesmo tempo'),
  janelaEmHoras: z.number().min(1).default(72).describe('Período considerado para medir o desempenho'),
  criterio: z
    .enum(['resultado_sol', 'resultado_percentual_medio', 'taxa_de_acerto', 'fator_de_lucro'])
    .default('resultado_sol')
    .describe('Critério de classificação das carteiras'),
  minimoDeCiclos: z
    .number()
    .int()
    .min(1)
    .default(3)
    .describe('Ciclos mínimos na janela para a carteira ser classificada'),
  baseDoResultado: z
    .enum(['trader', 'robo'])
    .default('trader')
    .describe('Considerar o resultado dos ciclos do trader ou das posições do robô'),
  distribuicao: z
    .enum(['igual', 'proporcional_ao_desempenho'])
    .default('igual')
    .describe('Como dividir o capital entre as carteiras ativas'),
  preencherComCarteirasSemHistorico: z
    .boolean()
    .default(true)
    .describe('Completar as vagas com carteiras ainda sem ciclos suficientes'),
})

type Configuracao = z.infer<typeof esquema>

const FATOR_DE_LUCRO_SEM_PERDAS = 1000

function pontuar(ciclos: ResumoDeCiclo[], criterio: Configuracao['criterio']) {
  const metricas = calcularMetricas(ciclos)
  switch (criterio) {
    case 'resultado_sol':
      return metricas.resultadoSol
    case 'resultado_percentual_medio':
      return metricas.resultadoPercentualMedio
    case 'taxa_de_acerto':
      return metricas.taxaDeAcerto
    case 'fator_de_lucro':
      return metricas.fatorDeLucro ?? (metricas.acertos > 0 ? FATOR_DE_LUCRO_SEM_PERDAS : 0)
  }
}

export const estrategiaRotacaoDinamicaPorDesempenho: EstrategiaDeCopia<Configuracao, null> = {
  identificador: 'rotacao_dinamica_por_desempenho',
  nome: 'Rotação dinâmica por desempenho',
  descricao:
    'Classifica periodicamente as carteiras pelo desempenho em uma janela móvel e ativa as melhores, alternando conforme os resultados mudam.',
  esquemaDeConfiguracao: esquema,
  estadoInicial: () => null,
  decidir: ({ configuracao, carteirasDaSessao, ciclosDoTrader, ciclosDoRobo, momento }) => {
    const ciclosDaBase = configuracao.baseDoResultado === 'robo' ? ciclosDoRobo : ciclosDoTrader
    const inicioDaJanela = new Date(momento.getTime() - configuracao.janelaEmHoras * 3_600_000)
    const avaliadas = ordenarPelaFila(carteirasDaSessao).map(({ endereco }) => {
      const ciclos = ciclosDaCarteira(ciclosDaBase, endereco, inicioDaJanela)
      const classificavel = ciclos.length >= configuracao.minimoDeCiclos
      return {
        endereco,
        classificavel,
        pontuacao: classificavel ? pontuar(ciclos, configuracao.criterio) : 0,
      }
    })

    const classificadas = avaliadas
      .filter((avaliada) => avaliada.classificavel)
      .sort((a, b) => b.pontuacao - a.pontuacao)
    const semHistorico = configuracao.preencherComCarteirasSemHistorico
      ? avaliadas.filter((avaliada) => !avaliada.classificavel)
      : []
    const escolhidas = [...classificadas, ...semHistorico].slice(0, configuracao.quantidadeDeCarteiras)

    const somaPositiva = escolhidas.reduce((total, escolhida) => total + Math.max(0, escolhida.pontuacao), 0)
    const proporcional = configuracao.distribuicao === 'proporcional_ao_desempenho' && somaPositiva > 0
    const carteirasAtivas = escolhidas.map(({ endereco, pontuacao }) => ({
      endereco,
      fracaoDoCapital: proporcional
        ? Math.max(0, pontuacao) / somaPositiva
        : 1 / configuracao.quantidadeDeCarteiras,
    }))

    const ranking = classificadas
      .map(({ endereco, pontuacao }) => `${abreviarEndereco(endereco)} ${pontuacao.toFixed(3)}`)
      .join(', ')
    return {
      carteirasAtivas: carteirasAtivas.filter((ativa) => ativa.fracaoDoCapital > 0),
      estado: null,
      motivo: [
        ranking
          ? `Classificação (${configuracao.criterio}): ${ranking}`
          : 'Nenhuma carteira com ciclos suficientes',
        descreverAtivas(carteirasAtivas.filter((a) => a.fracaoDoCapital > 0).map((a) => a.endereco)),
      ].join('. '),
    }
  },
}
