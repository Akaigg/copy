import type { PontoDaCurva, ResumoDaSessaoResposta, Serializado } from '@hot/compartilhado'
import { useQueries } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { requisitar } from '../api/cliente'
import { chaves, useSessoes } from '../api/consultas'
import { CORES_DAS_SERIES, GraficoDeResultado } from '../componentes/grafico-de-resultado'
import { Cabecalho, Carregando, Cartao, Vazio } from '../componentes/interface'
import { SeloDeStatus } from '../componentes/selos'
import {
  corDoResultado,
  formatarLatencia,
  formatarNumero,
  formatarPercentual,
  formatarSol,
  formatarSolComSinal,
  rotulo,
} from '../utilidades/formatacao'

type Resumo = Serializado<ResumoDaSessaoResposta>

const LINHAS: Array<[string, (resumo: Resumo) => ReactNode]> = [
  ['Estratégia', (r) => r.nomeDaEstrategia],
  ['Dimensionamento', (r) => rotulo(r.sessao.dimensionamento.modo)],
  ['Carteiras', (r) => r.sessao.carteiras.length],
  ['Capital inicial', (r) => formatarSol(r.sessao.capitalInicialSol, 2)],
  ['Patrimônio', (r) => formatarSol(r.patrimonioDeMercadoSol ?? r.patrimonioContabilSol, 3)],
  [
    'Resultado realizado',
    (r) => (
      <span className={corDoResultado(r.resultadoRealizadoSol)}>
        {formatarSolComSinal(r.resultadoRealizadoSol, 3)}
      </span>
    ),
  ],
  [
    'Resultado total',
    (r) => (
      <span className={corDoResultado(r.resultadoPercentual)}>
        {formatarPercentual(r.resultadoPercentual)}
      </span>
    ),
  ],
  ['Ciclos encerrados', (r) => r.metricasDoRobo.quantidadeDeCiclos],
  ['Taxa de acerto', (r) => formatarPercentual(r.metricasDoRobo.taxaDeAcerto, 0, false)],
  ['Média por ciclo', (r) => formatarPercentual(r.metricasDoRobo.resultadoPercentualMedio)],
  ['Fator de lucro', (r) => formatarNumero(r.metricasDoRobo.fatorDeLucro)],
  ['Maior perda', (r) => formatarSolComSinal(r.metricasDoRobo.maiorPerdaSol, 3)],
  ['Pior sequência de perdas', (r) => r.metricasDoRobo.maiorSequenciaDePerdas],
  ['Ordens executadas', (r) => r.ordensPorStatus.executada ?? 0],
  ['Ordens não copiadas', (r) => r.ordensPorStatus.nao_copiada ?? 0],
  ['Ordens com falha', (r) => r.ordensPorStatus.falhou ?? 0],
  ['Latência média', (r) => formatarLatencia(r.latenciaMediaMs)],
  ['Desvio médio na compra', (r) => formatarPercentual(r.desvioMedioCompra, 2)],
  ['Desvio médio na venda', (r) => formatarPercentual(r.desvioMedioVenda, 2)],
]

export function PaginaCompararSessoes() {
  const sessoes = useSessoes()
  const [selecionadas, definirSelecionadas] = useState<string[]>([])
  const curvas = useQueries({
    queries: selecionadas.map((id) => ({
      queryKey: [...chaves.sessao(id), 'curva'],
      queryFn: () => requisitar<Serializado<PontoDaCurva>[]>(`/api/sessoes/${id}/curva`),
    })),
  })

  if (sessoes.isLoading) return <Carregando />
  const todas = sessoes.data ?? []
  const escolhidas = selecionadas
    .map((id) => todas.find((resumo) => resumo.sessao.id === id))
    .filter((resumo): resumo is Resumo => Boolean(resumo))

  const alternar = (id: string) =>
    definirSelecionadas(
      selecionadas.includes(id) ? selecionadas.filter((s) => s !== id) : [...selecionadas, id],
    )

  return (
    <>
      <Cabecalho
        titulo="Comparar sessões"
        descricao="Compare estratégias, alocações e dimensionamentos executados sobre os mesmos eventos."
      />
      <Cartao titulo="Sessões" className="mb-6">
        {todas.length === 0 ? (
          <Vazio titulo="Nenhuma sessão para comparar" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {todas.map((resumo) => (
              <label
                key={resumo.sessao.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  className="accent-orange-500"
                  checked={selecionadas.includes(resumo.sessao.id)}
                  onChange={() => alternar(resumo.sessao.id)}
                />
                {resumo.sessao.nome}
                <SeloDeStatus valor={resumo.sessao.status} />
              </label>
            ))}
          </div>
        )}
      </Cartao>

      {escolhidas.length > 0 && (
        <>
          <Cartao titulo="Resultado realizado acumulado" className="mb-6">
            <GraficoDeResultado
              altura={300}
              series={escolhidas.map((resumo, indice) => ({
                nome: resumo.sessao.nome,
                cor: CORES_DAS_SERIES[indice % CORES_DAS_SERIES.length] as string,
                pontos: curvas[indice]?.data ?? [],
              }))}
            />
          </Cartao>
          <Cartao semEspacamento>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-2 text-left font-medium">Indicador</th>
                    {escolhidas.map((resumo) => (
                      <th
                        key={resumo.sessao.id}
                        className="px-4 py-2 text-right font-medium normal-case text-zinc-300"
                      >
                        {resumo.sessao.nome}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {LINHAS.map(([titulo, valor]) => (
                    <tr key={titulo}>
                      <td className="px-4 py-2 text-zinc-400">{titulo}</td>
                      {escolhidas.map((resumo) => (
                        <td key={resumo.sessao.id} className="px-4 py-2 text-right tabular-nums">
                          {valor(resumo)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>
        </>
      )}
    </>
  )
}
