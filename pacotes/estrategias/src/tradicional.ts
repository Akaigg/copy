import type { EstrategiaDeCopia } from '@hot/dominio'
import { z } from 'zod'
import { descreverAtivas } from './utilidades'

const esquema = z.object({})

export const estrategiaTradicional: EstrategiaDeCopia<z.infer<typeof esquema>, null> = {
  identificador: 'tradicional',
  nome: 'Copy Trading tradicional',
  descricao:
    'Copia continuamente todas as carteiras selecionadas, distribuindo o capital conforme a fração definida para cada uma.',
  esquemaDeConfiguracao: esquema,
  estadoInicial: () => null,
  decidir: ({ carteirasDaSessao }) => ({
    carteirasAtivas: carteirasDaSessao
      .filter((carteira) => carteira.fracaoDoCapital > 0)
      .map(({ endereco, fracaoDoCapital }) => ({ endereco, fracaoDoCapital })),
    estado: null,
    motivo: descreverAtivas(carteirasDaSessao.filter((c) => c.fracaoDoCapital > 0).map((c) => c.endereco)),
  }),
}
