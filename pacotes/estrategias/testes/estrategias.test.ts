import type { CarteiraDaSessao, ContextoDaEstrategia, ResumoDeCiclo } from '@hot/dominio'
import { describe, expect, it } from 'vitest'
import {
  descreverEstrategias,
  estrategiaRotacaoDinamicaPorDesempenho,
  estrategiaRotacaoPorPerdasConsecutivas,
  estrategiaTradicional,
  validarConfiguracaoDaEstrategia,
} from '../src'

const INICIO = new Date('2026-10-18T00:00:00Z')
const A = 'AAAA1111111111111111111111111111111111111111'
const B = 'BBBB1111111111111111111111111111111111111111'
const C = 'CCCC1111111111111111111111111111111111111111'

const fila: CarteiraDaSessao[] = [
  { endereco: A, fracaoDoCapital: 0.5, ordem: 0 },
  { endereco: B, fracaoDoCapital: 0.3, ordem: 1 },
  { endereco: C, fracaoDoCapital: 0.2, ordem: 2 },
]

function ciclo(carteira: string, resultadoSol: number, minuto: number): ResumoDeCiclo {
  return {
    carteira,
    token: 'token',
    encerradoEm: new Date(INICIO.getTime() + minuto * 60_000),
    resultadoSol,
    resultadoPercentual: resultadoSol,
  }
}

function contexto<C, E>(configuracao: C, estado: E, ciclosDoTrader: ResumoDeCiclo[], minuto = 100) {
  return {
    configuracao,
    estado,
    carteirasDaSessao: fila,
    ciclosDoTrader,
    ciclosDoRobo: [],
    inicioDaSessao: INICIO,
    momento: new Date(INICIO.getTime() + minuto * 60_000),
  } satisfies ContextoDaEstrategia<C, E>
}

describe('tradicional', () => {
  it('ativa todas as carteiras com as frações configuradas', () => {
    const decisao = estrategiaTradicional.decidir(contexto({}, null, []))
    expect(decisao.carteirasAtivas).toEqual([
      { endereco: A, fracaoDoCapital: 0.5 },
      { endereco: B, fracaoDoCapital: 0.3 },
      { endereco: C, fracaoDoCapital: 0.2 },
    ])
  })
})

describe('rotação por perdas consecutivas', () => {
  const configuracao = validarConfiguracaoDaEstrategia('rotacao_por_perdas_consecutivas', {}) as {
    limiteDePerdasConsecutivas: number
    carteirasSimultaneas: number
    baseDoResultado: 'trader' | 'robo'
    reativacao: 'nunca' | 'apos_ciclo_lucrativo_do_trader'
  }
  const estrategia = estrategiaRotacaoPorPerdasConsecutivas

  it('começa pela primeira carteira da fila', () => {
    const decisao = estrategia.decidir(contexto(configuracao, estrategia.estadoInicial(configuracao), []))
    expect(decisao.carteirasAtivas).toEqual([{ endereco: A, fracaoDoCapital: 1 }])
  })

  it('pausa após duas perdas seguidas e passa para a próxima', () => {
    const decisao = estrategia.decidir(
      contexto(configuracao, estrategia.estadoInicial(configuracao), [ciclo(A, -1, 1), ciclo(A, -0.5, 2)]),
    )
    expect(decisao.carteirasAtivas).toEqual([{ endereco: B, fracaoDoCapital: 1 }])
    expect(decisao.estado.pausadas[A]).toBeDefined()
    expect(decisao.motivo).toMatch(/pausada após 2 perdas/)
  })

  it('não pausa se um ganho interrompe a sequência', () => {
    const decisao = estrategia.decidir(
      contexto(configuracao, estrategia.estadoInicial(configuracao), [
        ciclo(A, -1, 1),
        ciclo(A, 1, 2),
        ciclo(A, -1, 3),
      ]),
    )
    expect(decisao.carteirasAtivas[0]?.endereco).toBe(A)
  })

  it('ignora ciclos anteriores ao início da sessão', () => {
    const decisao = estrategia.decidir(
      contexto(configuracao, estrategia.estadoInicial(configuracao), [ciclo(A, -1, -10), ciclo(A, -1, -5)]),
    )
    expect(decisao.carteirasAtivas[0]?.endereco).toBe(A)
  })

  it('mantém a carteira pausada nas decisões seguintes', () => {
    const primeira = estrategia.decidir(
      contexto(configuracao, estrategia.estadoInicial(configuracao), [ciclo(A, -1, 1), ciclo(A, -1, 2)]),
    )
    const segunda = estrategia.decidir(
      contexto(configuracao, primeira.estado, [ciclo(A, -1, 1), ciclo(A, -1, 2), ciclo(A, 5, 50)]),
    )
    expect(segunda.carteirasAtivas[0]?.endereco).toBe(B)
  })

  it('reativa após ciclo lucrativo do trader quando configurado', () => {
    const comReativacao = { ...configuracao, reativacao: 'apos_ciclo_lucrativo_do_trader' as const }
    const primeira = estrategia.decidir(
      contexto(
        comReativacao,
        estrategia.estadoInicial(comReativacao),
        [ciclo(A, -1, 1), ciclo(A, -1, 2)],
        10,
      ),
    )
    const ciclos = [ciclo(A, -1, 1), ciclo(A, -1, 2), ciclo(A, 3, 20)]
    const segunda = estrategia.decidir(contexto(comReativacao, primeira.estado, ciclos, 30))
    expect(segunda.carteirasAtivas[0]?.endereco).toBe(A)
    expect(segunda.motivo).toMatch(/reativada/)
  })

  it('copia várias carteiras simultâneas dividindo o capital', () => {
    const duas = { ...configuracao, carteirasSimultaneas: 2 }
    const decisao = estrategia.decidir(
      contexto(duas, estrategia.estadoInicial(duas), [ciclo(A, -1, 1), ciclo(A, -1, 2)]),
    )
    expect(decisao.carteirasAtivas).toEqual([
      { endereco: B, fracaoDoCapital: 0.5 },
      { endereco: C, fracaoDoCapital: 0.5 },
    ])
  })
})

describe('rotação dinâmica por desempenho', () => {
  const estrategia = estrategiaRotacaoDinamicaPorDesempenho
  const base = estrategia.esquemaDeConfiguracao.parse({ minimoDeCiclos: 2 })
  const ciclos = [
    ciclo(A, -1, 1),
    ciclo(A, 0.5, 2),
    ciclo(B, 2, 3),
    ciclo(B, 1, 4),
    ciclo(C, 0.5, 5),
    ciclo(C, 0.4, 6),
  ]

  it('ativa as melhores carteiras pelo critério escolhido', () => {
    const decisao = estrategia.decidir(contexto(base, null, ciclos))
    expect(decisao.carteirasAtivas).toEqual([
      { endereco: B, fracaoDoCapital: 0.5 },
      { endereco: C, fracaoDoCapital: 0.5 },
    ])
  })

  it('distribui proporcionalmente ao desempenho', () => {
    const proporcional = { ...base, distribuicao: 'proporcional_ao_desempenho' as const }
    const decisao = estrategia.decidir(contexto(proporcional, null, ciclos))
    expect(decisao.carteirasAtivas[0]).toEqual({ endereco: B, fracaoDoCapital: 3 / 3.9 })
  })

  it('completa vagas com carteiras sem histórico suficiente', () => {
    const decisao = estrategia.decidir(contexto(base, null, [ciclo(C, 1, 1), ciclo(C, 1, 2)]))
    expect(decisao.carteirasAtivas.map((ativa) => ativa.endereco)).toEqual([C, A])
  })

  it('desconsidera ciclos fora da janela', () => {
    const decisao = estrategia.decidir(contexto({ ...base, janelaEmHoras: 1 }, null, ciclos, 64))
    expect(decisao.carteirasAtivas.map((ativa) => ativa.endereco)).toEqual([C, A])
  })
})

describe('registro', () => {
  it('descreve as estratégias com esquema de configuração', () => {
    const descricoes = descreverEstrategias()
    expect(descricoes.map((d) => d.identificador)).toEqual([
      'tradicional',
      'rotacao_por_perdas_consecutivas',
      'rotacao_dinamica_por_desempenho',
    ])
    expect(descricoes[1]?.esquemaDeConfiguracao).toMatchObject({ type: 'object' })
  })
})
