import { Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { useEstadoDoSistema, useSessoes } from '../api/consultas'
import { useConexaoEmTempoReal } from '../api/eventos'
import {
  Botao,
  Cabecalho,
  Carregando,
  Cartao,
  Indicador,
  MensagemDeErro,
  Tabela,
  Vazio,
} from '../componentes/interface'
import { SeloDeStatus } from '../componentes/selos'
import {
  corDoResultado,
  formatarPercentual,
  formatarSol,
  formatarSolComSinal,
  formatarTempoRelativo,
  rotulo,
} from '../utilidades/formatacao'
import { TabelaDeOperacoes } from './operacoes'

export function PaginaVisaoGeral() {
  const estado = useEstadoDoSistema()
  const sessoes = useSessoes()
  const { conectado } = useConexaoEmTempoReal()
  const navegar = useNavigate()

  return (
    <>
      <Cabecalho
        titulo="Visão geral"
        descricao="Situação do robô, das sessões e das carteiras monitoradas."
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Monitor on-chain"
          valor={estado.data?.monitor.conectada ? 'Conectado' : 'Desconectado'}
          className={estado.data?.monitor.conectada ? 'text-emerald-400' : 'text-rose-400'}
          detalhe={`${rotulo(estado.data?.monitor.fonte)} · ${estado.data?.monitor.carteiras ?? 0} carteiras`}
        />
        <Indicador
          rotulo="Sessões ativas"
          valor={estado.data?.sessoesAtivas ?? '—'}
          detalhe={`Execução simulada: ${rotulo(estado.data?.executorSimulado)}`}
        />
        <Indicador
          rotulo="Operações detectadas"
          valor={estado.data?.operacoesProcessadas ?? '—'}
          detalhe={`Última ${formatarTempoRelativo(estado.data?.ultimaOperacaoEm)}`}
        />
        <Indicador
          rotulo="Painel em tempo real"
          valor={conectado ? 'Ao vivo' : 'Reconectando'}
          className={conectado ? 'text-emerald-400' : 'text-amber-400'}
          detalhe={`Motor iniciado ${formatarTempoRelativo(estado.data?.iniciadoEm)}`}
        />
      </div>

      <div className="grid gap-6 2xl:grid-cols-2">
        <Cartao
          titulo="Sessões"
          acoes={
            <Link to="/sessoes/nova">
              <Botao variante="primario">
                <Plus className="size-4" />
                Nova sessão
              </Botao>
            </Link>
          }
          semEspacamento
        >
          {sessoes.isLoading && <Carregando />}
          {sessoes.error && <MensagemDeErro erro={sessoes.error} />}
          {sessoes.data && sessoes.data.length === 0 && (
            <Vazio
              titulo="Nenhuma sessão criada"
              descricao="Cadastre carteiras e crie uma sessão simulada para começar a copiar."
            />
          )}
          {sessoes.data && sessoes.data.length > 0 && (
            <Tabela
              linhas={sessoes.data.filter((s) => s.sessao.status !== 'encerrada')}
              chave={(s) => s.sessao.id}
              aoClicar={(s) => navegar(`/sessoes/${s.sessao.id}`)}
              vazio="Nenhuma sessão em andamento"
              colunas={[
                {
                  titulo: 'Sessão',
                  celula: (s) => (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.sessao.nome}</span>
                      <SeloDeStatus valor={s.sessao.status} />
                    </div>
                  ),
                },
                {
                  titulo: 'Patrimônio',
                  alinhamento: 'direita',
                  celula: (s) => formatarSol(s.patrimonioDeMercadoSol ?? s.patrimonioContabilSol, 3),
                },
                {
                  titulo: 'Resultado',
                  alinhamento: 'direita',
                  celula: (s) => (
                    <span className={corDoResultado(s.resultadoTotalSol ?? s.resultadoRealizadoSol)}>
                      {formatarSolComSinal(s.resultadoTotalSol ?? s.resultadoRealizadoSol, 3)}{' '}
                      <span className="text-xs">{formatarPercentual(s.resultadoPercentual)}</span>
                    </span>
                  ),
                },
              ]}
            />
          )}
        </Cartao>

        <Cartao titulo="Operações recentes dos traders" semEspacamento>
          <TabelaDeOperacoes limite={15} compacta />
        </Cartao>
      </div>
    </>
  )
}
