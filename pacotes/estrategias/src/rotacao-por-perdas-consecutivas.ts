import { contarPerdasConsecutivas, type EstrategiaDeCopia } from '@hot/dominio'
import { z } from 'zod'
import { abreviarEndereco, ciclosDaCarteira, descreverAtivas, ordenarPelaFila } from './utilidades'

const esquema = z.object({
  limiteDePerdasConsecutivas: z
    .number()
    .int()
    .min(1)
    .default(2)
    .describe('Perdas consecutivas para pausar a carteira'),
  carteirasSimultaneas: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe('Quantidade de carteiras copiadas ao mesmo tempo'),
  baseDoResultado: z
    .enum(['trader', 'robo'])
    .default('trader')
    .describe('Considerar o resultado dos ciclos do trader ou das posições do robô'),
  reativacao: z
    .enum(['nunca', 'apos_ciclo_lucrativo_do_trader'])
    .default('nunca')
    .describe('Quando uma carteira pausada volta para a fila'),
})

export interface EstadoDaRotacaoPorPerdas {
  pausadas: Record<string, string>
  contagemDesde: Record<string, string>
}

export const estrategiaRotacaoPorPerdasConsecutivas: EstrategiaDeCopia<
  z.infer<typeof esquema>,
  EstadoDaRotacaoPorPerdas
> = {
  identificador: 'rotacao_por_perdas_consecutivas',
  nome: 'Rotação por perdas consecutivas',
  descricao:
    'Copia as carteiras na ordem da fila. Quando uma carteira atinge o limite de perdas consecutivas, novas entradas dela são pausadas e a próxima da fila assume.',
  esquemaDeConfiguracao: esquema,
  estadoInicial: () => ({ pausadas: {}, contagemDesde: {} }),
  decidir: ({
    configuracao,
    estado,
    carteirasDaSessao,
    ciclosDoTrader,
    ciclosDoRobo,
    inicioDaSessao,
    momento,
  }) => {
    const pausadas = { ...(estado?.pausadas ?? {}) }
    const contagemDesde = { ...(estado?.contagemDesde ?? {}) }
    const ciclosDaBase = configuracao.baseDoResultado === 'robo' ? ciclosDoRobo : ciclosDoTrader
    const fila = ordenarPelaFila(carteirasDaSessao)
    const eventos: string[] = []

    for (const { endereco } of fila) {
      const pausadaEm = pausadas[endereco]
      if (pausadaEm) {
        const lucrouDepoisDaPausa = ciclosDaCarteira(ciclosDoTrader, endereco, new Date(pausadaEm)).some(
          (ciclo) => ciclo.resultadoSol > 0,
        )
        if (configuracao.reativacao === 'apos_ciclo_lucrativo_do_trader' && lucrouDepoisDaPausa) {
          delete pausadas[endereco]
          contagemDesde[endereco] = momento.toISOString()
          eventos.push(`${abreviarEndereco(endereco)} reativada após ciclo lucrativo do trader`)
        }
        continue
      }
      const reinicio = contagemDesde[endereco]
      const desde = reinicio && new Date(reinicio) > inicioDaSessao ? new Date(reinicio) : inicioDaSessao
      const perdas = contarPerdasConsecutivas(ciclosDaCarteira(ciclosDaBase, endereco, desde))
      if (perdas >= configuracao.limiteDePerdasConsecutivas) {
        pausadas[endereco] = momento.toISOString()
        eventos.push(`${abreviarEndereco(endereco)} pausada após ${perdas} perdas consecutivas`)
      }
    }

    const ativas = fila
      .filter(({ endereco }) => !pausadas[endereco])
      .slice(0, configuracao.carteirasSimultaneas)
    const fracaoDoCapital = 1 / configuracao.carteirasSimultaneas
    return {
      carteirasAtivas: ativas.map(({ endereco }) => ({ endereco, fracaoDoCapital })),
      estado: { pausadas, contagemDesde },
      motivo: [...eventos, descreverAtivas(ativas.map(({ endereco }) => endereco))].join('. '),
    }
  },
}
