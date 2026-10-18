import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatarDataHora, formatarSolComSinal } from '../utilidades/formatacao'
import { Vazio } from './interface'

export interface SerieDeResultado {
  nome: string
  cor: string
  pontos: Array<{ momento: string; resultadoAcumuladoSol: number }>
}

export const CORES_DAS_SERIES = ['#f97316', '#38bdf8', '#a3e635', '#e879f9', '#facc15', '#2dd4bf']

export function GraficoDeResultado({
  series,
  altura = 260,
}: {
  series: SerieDeResultado[]
  altura?: number
}) {
  const comPontos = series.filter((serie) => serie.pontos.length > 0)
  if (comPontos.length === 0) {
    return (
      <Vazio titulo="Sem resultados realizados ainda" descricao="A curva aparece após as primeiras vendas." />
    )
  }
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <LineChart margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
        <XAxis
          dataKey="tempo"
          type="number"
          domain={['dataMin', 'dataMax']}
          scale="time"
          stroke="#71717a"
          fontSize={11}
          tickFormatter={(tempo: number) =>
            new Date(tempo).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          }
        />
        <YAxis
          stroke="#71717a"
          fontSize={11}
          width={64}
          tickFormatter={(valor: number) => valor.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
        />
        <Tooltip
          contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }}
          labelFormatter={(tempo) => formatarDataHora(new Date(Number(tempo)).toISOString())}
          formatter={(valor) => formatarSolComSinal(Number(valor))}
        />
        {comPontos.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {comPontos.map((serie) => (
          <Line
            key={serie.nome}
            name={serie.nome}
            data={serie.pontos.map((ponto) => ({
              tempo: new Date(ponto.momento).getTime(),
              valor: ponto.resultadoAcumuladoSol,
            }))}
            dataKey="valor"
            stroke={serie.cor}
            strokeWidth={2}
            dot={false}
            type="stepAfter"
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
