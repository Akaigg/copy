import { Pause, Pencil, Play, Square } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import {
  useAlterarStatusDaSessao,
  useComparacao,
  useCurva,
  useDecisoes,
  useDesempenhoPorCarteira,
  useOrdens,
  usePosicoes,
  useSessao,
} from '../api/consultas'
import { Endereco, Token } from '../componentes/endereco'
import { FormularioDeSessao } from '../componentes/formulario-de-sessao'
import { CORES_DAS_SERIES, GraficoDeResultado } from '../componentes/grafico-de-resultado'
import {
  Abas,
  Botao,
  Cabecalho,
  Carregando,
  Cartao,
  Indicador,
  MensagemDeErro,
  Selo,
  Tabela,
  Vazio,
} from '../componentes/interface'
import { SeloDeStatus } from '../componentes/selos'
import {
  corDoResultado,
  formatarDataHora,
  formatarLatencia,
  formatarNumero,
  formatarPercentual,
  formatarPreco,
  formatarSol,
  formatarSolComSinal,
  rotulo,
} from '../utilidades/formatacao'

type Aba = 'posicoes' | 'ordens' | 'carteiras' | 'comparacao' | 'decisoes'

function AbaDePosicoes({ id }: { id: string }) {
  const posicoes = usePosicoes(id)
  if (posicoes.isLoading) return <Carregando />
  return (
    <Tabela
      linhas={posicoes.data ?? []}
      chave={(p) => p.id}
      vazio="Nenhuma posição aberta ainda"
      colunas={[
        { titulo: 'Token', celula: (p) => <Token mint={p.token} simbolo={p.simboloDoToken} /> },
        {
          titulo: 'Carteira',
          celula: (p) => (
            <Endereco
              endereco={p.carteira}
              apelido={p.apelidoDaCarteira}
              linkInterno={`/carteiras/${p.carteira}`}
            />
          ),
        },
        { titulo: 'Status', celula: (p) => <SeloDeStatus valor={p.status} /> },
        { titulo: 'Aberta em', celula: (p) => formatarDataHora(p.abertaEm) },
        {
          titulo: 'Quantidade',
          alinhamento: 'direita',
          celula: (p) => (p.status === 'aberta' ? formatarNumero(p.quantidade) : '—'),
        },
        { titulo: 'Investido', alinhamento: 'direita', celula: (p) => formatarSol(p.investidoSol) },
        { titulo: 'Custo aberto', alinhamento: 'direita', celula: (p) => formatarSol(p.custoBaseSol) },
        {
          titulo: 'Valor atual',
          alinhamento: 'direita',
          celula: (p) => (p.status === 'aberta' ? formatarSol(p.valorDeMercadoSol) : '—'),
        },
        {
          titulo: 'Não realizado',
          alinhamento: 'direita',
          celula: (p) => (
            <span className={corDoResultado(p.resultadoNaoRealizadoSol)}>
              {formatarSolComSinal(p.resultadoNaoRealizadoSol)}
            </span>
          ),
        },
        {
          titulo: 'Realizado',
          alinhamento: 'direita',
          celula: (p) => (
            <span className={corDoResultado(p.resultadoRealizadoSol)}>
              {formatarSolComSinal(p.resultadoRealizadoSol)}
              {p.status === 'encerrada' && (
                <span className="ml-1 text-xs">({formatarPercentual(p.resultadoPercentual)})</span>
              )}
            </span>
          ),
        },
      ]}
    />
  )
}

function AbaDeOrdens({ id }: { id: string }) {
  const ordens = useOrdens(id)
  if (ordens.isLoading) return <Carregando />
  return (
    <Tabela
      linhas={ordens.data ?? []}
      chave={(o) => o.id}
      vazio="Nenhuma ordem gerada ainda"
      colunas={[
        { titulo: 'Criada em', celula: (o) => formatarDataHora(o.criadaEm) },
        {
          titulo: 'Carteira',
          celula: (o) => (
            <Endereco
              endereco={o.carteira}
              apelido={o.apelidoDaCarteira}
              linkInterno={`/carteiras/${o.carteira}`}
            />
          ),
        },
        { titulo: 'Token', celula: (o) => <Token mint={o.token} simbolo={o.simboloDoToken} /> },
        { titulo: 'Tipo', celula: (o) => <SeloDeStatus valor={o.tipo} /> },
        { titulo: 'Status', celula: (o) => <SeloDeStatus valor={o.status} /> },
        {
          titulo: 'Alvo',
          alinhamento: 'direita',
          celula: (o) =>
            o.valorAlvoSol !== null
              ? formatarSol(o.valorAlvoSol)
              : o.fracaoAlvo !== null
                ? formatarPercentual(o.fracaoAlvo, 1, false)
                : '—',
        },
        { titulo: 'Executado', alinhamento: 'direita', celula: (o) => formatarSol(o.valorExecutadoSol) },
        { titulo: 'Preço trader', alinhamento: 'direita', celula: (o) => formatarPreco(o.precoDoTraderSol) },
        { titulo: 'Preço robô', alinhamento: 'direita', celula: (o) => formatarPreco(o.precoExecutadoSol) },
        {
          titulo: 'Desvio',
          alinhamento: 'direita',
          celula: (o) => {
            const desfavoravel =
              o.desvioDePreco === null ? 0 : o.lado === 'compra' ? -o.desvioDePreco : o.desvioDePreco
            return (
              <span className={corDoResultado(desfavoravel)}>{formatarPercentual(o.desvioDePreco, 2)}</span>
            )
          },
        },
        { titulo: 'Latência', alinhamento: 'direita', celula: (o) => formatarLatencia(o.latenciaMs) },
        {
          titulo: 'Preço via',
          celula: (o) => (o.fonteDoPreco ? <Selo>{rotulo(o.fonteDoPreco)}</Selo> : '—'),
        },
        {
          titulo: 'Motivo',
          className: 'max-w-xs truncate whitespace-normal text-xs text-zinc-400',
          celula: (o) => o.motivo ?? '',
        },
      ]}
    />
  )
}

function AbaDeCarteiras({ id }: { id: string }) {
  const desempenho = useDesempenhoPorCarteira(id)
  if (desempenho.isLoading) return <Carregando />
  return (
    <Tabela
      linhas={desempenho.data ?? []}
      chave={(c) => c.endereco}
      colunas={[
        {
          titulo: 'Fila',
          alinhamento: 'direita',
          celula: (c) => (c.ordemNaFila >= 0 ? `${c.ordemNaFila + 1}º` : '—'),
        },
        {
          titulo: 'Carteira',
          celula: (c) => (
            <Endereco endereco={c.endereco} apelido={c.apelido} linkInterno={`/carteiras/${c.endereco}`} />
          ),
        },
        {
          titulo: 'Situação',
          celula: (c) =>
            c.ativa ? (
              <Selo tom="sucesso">Ativa · {formatarPercentual(c.ativa.fracaoDoCapital, 0, false)}</Selo>
            ) : (
              <Selo>Sem novas entradas</Selo>
            ),
        },
        { titulo: 'Posições abertas', alinhamento: 'direita', celula: (c) => c.posicoesAbertas },
        { titulo: 'Custo aberto', alinhamento: 'direita', celula: (c) => formatarSol(c.custoAbertoSol, 3) },
        {
          titulo: 'Ciclos trader',
          alinhamento: 'direita',
          celula: (c) => c.metricasDoTrader.quantidadeDeCiclos,
        },
        {
          titulo: 'Resultado trader',
          alinhamento: 'direita',
          celula: (c) => (
            <span className={corDoResultado(c.metricasDoTrader.resultadoPercentualMedio)}>
              {formatarPercentual(c.metricasDoTrader.resultadoPercentualMedio)} ·{' '}
              {formatarPercentual(c.metricasDoTrader.taxaDeAcerto, 0, false)} acerto
            </span>
          ),
        },
        { titulo: 'Ciclos robô', alinhamento: 'direita', celula: (c) => c.metricasDoRobo.quantidadeDeCiclos },
        {
          titulo: 'Resultado robô',
          alinhamento: 'direita',
          celula: (c) => (
            <span className={corDoResultado(c.metricasDoRobo.resultadoSol)}>
              {formatarSolComSinal(c.metricasDoRobo.resultadoSol, 3)} ·{' '}
              {formatarPercentual(c.metricasDoRobo.resultadoPercentualMedio)}
            </span>
          ),
        },
        {
          titulo: 'Perdas seguidas',
          alinhamento: 'direita',
          celula: (c) => c.metricasDoRobo.perdasConsecutivasAtuais,
        },
      ]}
    />
  )
}

function AbaDeComparacao({ id }: { id: string }) {
  const comparacao = useComparacao(id)
  if (comparacao.isLoading) return <Carregando />
  return (
    <Tabela
      linhas={comparacao.data ?? []}
      chave={(c) => c.posicaoId}
      vazio="As comparações aparecem quando o robô abre posições"
      colunas={[
        { titulo: 'Token', celula: (c) => <Token mint={c.token} simbolo={c.simboloDoToken} /> },
        {
          titulo: 'Carteira',
          celula: (c) => (
            <Endereco
              endereco={c.carteira}
              apelido={c.apelidoDaCarteira}
              linkInterno={`/carteiras/${c.carteira}`}
            />
          ),
        },
        { titulo: 'Abertura', celula: (c) => formatarDataHora(c.abertaEm) },
        {
          titulo: 'Situação',
          celula: (c) => (c.encerradaEm ? <Selo>Encerrada</Selo> : <Selo tom="info">Em andamento</Selo>),
        },
        {
          titulo: 'Trader',
          alinhamento: 'direita',
          celula: (c) => (
            <span className={corDoResultado(c.resultadoDoTraderPercentual)}>
              {formatarPercentual(c.resultadoDoTraderPercentual)}
            </span>
          ),
        },
        {
          titulo: 'Robô',
          alinhamento: 'direita',
          celula: (c) => (
            <span className={corDoResultado(c.resultadoDoRoboPercentual)}>
              {formatarPercentual(c.resultadoDoRoboPercentual)}
            </span>
          ),
        },
        {
          titulo: 'Diferença',
          alinhamento: 'direita',
          celula: (c) => (
            <span className={corDoResultado(c.diferencaPercentual)}>
              {formatarPercentual(c.diferencaPercentual, 1)}
            </span>
          ),
        },
        {
          titulo: 'Resultado robô',
          alinhamento: 'direita',
          celula: (c) => (
            <span className={corDoResultado(c.resultadoDoRoboSol)}>
              {formatarSolComSinal(c.resultadoDoRoboSol)}
            </span>
          ),
        },
      ]}
    />
  )
}

function AbaDeDecisoes({ id }: { id: string }) {
  const decisoes = useDecisoes(id)
  if (decisoes.isLoading) return <Carregando />
  if (!decisoes.data?.length) return <Vazio titulo="Nenhuma decisão registrada" />
  return (
    <ol className="divide-y divide-zinc-800/70">
      {decisoes.data.map((decisao) => (
        <li key={decisao.id} className="px-5 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            {formatarDataHora(decisao.momento)}
            <Selo tom="sucesso">{decisao.carteirasAtivas.length} ativas</Selo>
          </div>
          <p className="mt-1 text-sm text-zinc-300">{decisao.motivo}</p>
        </li>
      ))}
    </ol>
  )
}

export function PaginaDetalheDaSessao() {
  const { id = '' } = useParams()
  const resumo = useSessao(id)
  const curva = useCurva(id)
  const alterarStatus = useAlterarStatusDaSessao(id)
  const [aba, definirAba] = useState<Aba>('posicoes')
  const [editando, definirEditando] = useState(false)

  if (resumo.isLoading) return <Carregando />
  if (resumo.error || !resumo.data) return <MensagemDeErro erro={resumo.error} />
  const dados = resumo.data
  const { sessao } = dados
  const encerrada = sessao.status === 'encerrada'

  const encerrar = () => {
    if (
      window.confirm(
        'Encerrar a sessão? Ela deixará de copiar compras e vendas. As posições abertas ficam congeladas.',
      )
    ) {
      alterarStatus.mutate('encerrada')
    }
  }

  return (
    <>
      <Cabecalho
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {sessao.nome}
            <SeloDeStatus valor={sessao.status} />
            <SeloDeStatus valor={sessao.modo} />
          </span>
        }
        descricao={`${dados.nomeDaEstrategia} · ${rotulo(sessao.dimensionamento.modo)} · criada em ${formatarDataHora(sessao.criadaEm)}`}
        acoes={
          !encerrada && (
            <>
              <Botao onClick={() => definirEditando(!editando)}>
                <Pencil className="size-4" />
                {editando ? 'Fechar configuração' : 'Configurar'}
              </Botao>
              {sessao.status === 'ativa' ? (
                <Botao onClick={() => alterarStatus.mutate('pausada')} carregando={alterarStatus.isPending}>
                  <Pause className="size-4" />
                  Pausar compras
                </Botao>
              ) : (
                <Botao
                  variante="primario"
                  onClick={() => alterarStatus.mutate('ativa')}
                  carregando={alterarStatus.isPending}
                >
                  <Play className="size-4" />
                  Retomar
                </Botao>
              )}
              <Botao variante="perigo" onClick={encerrar}>
                <Square className="size-4" />
                Encerrar
              </Botao>
            </>
          )
        }
      />

      {sessao.status === 'pausada' && (
        <p className="mb-4 rounded-lg border border-amber-900 bg-amber-950/40 px-4 py-2 text-sm text-amber-300">
          Sessão pausada: novas compras não são copiadas, mas as vendas das posições abertas continuam sendo
          espelhadas.
        </p>
      )}

      {editando && (
        <div className="mb-6 max-w-4xl">
          <FormularioDeSessao sessao={sessao} aoConcluir={() => definirEditando(false)} />
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Patrimônio"
          valor={formatarSol(dados.patrimonioDeMercadoSol ?? dados.patrimonioContabilSol, 3)}
          detalhe={
            dados.patrimonioDeMercadoSol === null
              ? 'Valor contábil (sem preço de mercado disponível)'
              : `Caixa ${formatarSol(sessao.caixaSol, 3)} · capital inicial ${formatarSol(sessao.capitalInicialSol, 2)}`
          }
        />
        <Indicador
          rotulo="Resultado"
          valor={formatarSolComSinal(dados.resultadoTotalSol ?? dados.resultadoRealizadoSol, 3)}
          className={corDoResultado(dados.resultadoTotalSol ?? dados.resultadoRealizadoSol)}
          detalhe={`Realizado ${formatarSolComSinal(dados.resultadoRealizadoSol, 3)} · total ${formatarPercentual(dados.resultadoPercentual)}`}
        />
        <Indicador
          rotulo="Ciclos do robô"
          valor={dados.metricasDoRobo.quantidadeDeCiclos}
          detalhe={`${formatarPercentual(dados.metricasDoRobo.taxaDeAcerto, 0, false)} de acerto · ${dados.posicoesAbertas} posições abertas`}
        />
        <Indicador
          rotulo="Execução"
          valor={formatarLatencia(dados.latenciaMediaMs)}
          detalhe={`Desvio médio: compra ${formatarPercentual(dados.desvioMedioCompra, 2)} · venda ${formatarPercentual(dados.desvioMedioVenda, 2)}`}
        />
      </div>

      <Cartao titulo="Resultado realizado acumulado" className="mb-6">
        <GraficoDeResultado
          series={[{ nome: sessao.nome, cor: CORES_DAS_SERIES[0] as string, pontos: curva.data ?? [] }]}
        />
      </Cartao>

      <Cartao semEspacamento>
        <div className="px-4 pt-2">
          <Abas
            ativa={aba}
            aoMudar={definirAba}
            abas={[
              { id: 'posicoes', rotulo: 'Posições' },
              {
                id: 'ordens',
                rotulo: 'Ordens',
                contador: Object.values(dados.ordensPorStatus).reduce(
                  (total, valor) => total + (valor ?? 0),
                  0,
                ),
              },
              { id: 'carteiras', rotulo: 'Carteiras', contador: sessao.carteiras.length },
              { id: 'comparacao', rotulo: 'Trader × robô' },
              { id: 'decisoes', rotulo: 'Decisões da estratégia' },
            ]}
          />
        </div>
        {aba === 'posicoes' && <AbaDePosicoes id={id} />}
        {aba === 'ordens' && <AbaDeOrdens id={id} />}
        {aba === 'carteiras' && <AbaDeCarteiras id={id} />}
        {aba === 'comparacao' && <AbaDeComparacao id={id} />}
        {aba === 'decisoes' && <AbaDeDecisoes id={id} />}
      </Cartao>
    </>
  )
}
