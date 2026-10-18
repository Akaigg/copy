import { Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { useSessoes } from '../api/consultas'
import { FormularioDeSessao } from '../componentes/formulario-de-sessao'
import { Botao, Cabecalho, Carregando, Cartao, MensagemDeErro, Tabela } from '../componentes/interface'
import { SeloDeStatus } from '../componentes/selos'
import {
  corDoResultado,
  formatarDataHora,
  formatarLatencia,
  formatarPercentual,
  formatarSol,
  formatarSolComSinal,
} from '../utilidades/formatacao'

export function PaginaSessoes() {
  const sessoes = useSessoes()
  const navegar = useNavigate()
  return (
    <>
      <Cabecalho
        titulo="Sessões de cópia"
        descricao="Cada sessão tem capital, carteiras, estratégia e limites próprios. Várias sessões simuladas podem rodar em paralelo sobre os mesmos eventos."
        acoes={
          <Link to="/sessoes/nova">
            <Botao variante="primario">
              <Plus className="size-4" />
              Nova sessão
            </Botao>
          </Link>
        }
      />
      <Cartao semEspacamento>
        {sessoes.isLoading && <Carregando />}
        {sessoes.error && <MensagemDeErro erro={sessoes.error} />}
        {sessoes.data && (
          <Tabela
            linhas={sessoes.data}
            chave={(s) => s.sessao.id}
            aoClicar={(s) => navegar(`/sessoes/${s.sessao.id}`)}
            vazio="Nenhuma sessão criada"
            colunas={[
              { titulo: 'Sessão', celula: (s) => <span className="font-medium">{s.sessao.nome}</span> },
              { titulo: 'Status', celula: (s) => <SeloDeStatus valor={s.sessao.status} /> },
              { titulo: 'Modo', celula: (s) => <SeloDeStatus valor={s.sessao.modo} /> },
              { titulo: 'Estratégia', celula: (s) => s.nomeDaEstrategia },
              { titulo: 'Carteiras', alinhamento: 'direita', celula: (s) => s.sessao.carteiras.length },
              {
                titulo: 'Capital inicial',
                alinhamento: 'direita',
                celula: (s) => formatarSol(s.sessao.capitalInicialSol, 2),
              },
              {
                titulo: 'Patrimônio',
                alinhamento: 'direita',
                celula: (s) => formatarSol(s.patrimonioDeMercadoSol ?? s.patrimonioContabilSol, 3),
              },
              {
                titulo: 'Realizado',
                alinhamento: 'direita',
                celula: (s) => (
                  <span className={corDoResultado(s.resultadoRealizadoSol)}>
                    {formatarSolComSinal(s.resultadoRealizadoSol, 3)}
                  </span>
                ),
              },
              {
                titulo: 'Total',
                alinhamento: 'direita',
                celula: (s) => (
                  <span className={corDoResultado(s.resultadoPercentual)}>
                    {formatarPercentual(s.resultadoPercentual)}
                  </span>
                ),
              },
              {
                titulo: 'Acerto',
                alinhamento: 'direita',
                celula: (s) => formatarPercentual(s.metricasDoRobo.taxaDeAcerto, 0, false),
              },
              {
                titulo: 'Latência',
                alinhamento: 'direita',
                celula: (s) => formatarLatencia(s.latenciaMediaMs),
              },
              { titulo: 'Criada em', celula: (s) => formatarDataHora(s.sessao.criadaEm) },
            ]}
          />
        )}
      </Cartao>
    </>
  )
}

export function PaginaNovaSessao() {
  const navegar = useNavigate()
  return (
    <>
      <Cabecalho
        titulo="Nova sessão simulada"
        descricao="Configure como o robô deve copiar as carteiras escolhidas."
      />
      <div className="max-w-4xl">
        <FormularioDeSessao aoConcluir={(id) => navegar(`/sessoes/${id}`)} />
      </div>
    </>
  )
}
