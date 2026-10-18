import { useAuditoria, useEstadoDoSistema } from '../api/consultas'
import { Cabecalho, Carregando, Cartao, Indicador, Tabela } from '../componentes/interface'
import { formatarDataHora, formatarTempoRelativo, rotulo } from '../utilidades/formatacao'

export function PaginaSistema() {
  const estado = useEstadoDoSistema()
  const auditoria = useAuditoria()
  return (
    <>
      <Cabecalho titulo="Sistema" descricao="Estado do motor e registro de auditoria das ações relevantes." />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Fonte de transações"
          valor={rotulo(estado.data?.monitor.fonte)}
          detalhe={estado.data?.monitor.conectada ? 'Conectada' : 'Desconectada'}
        />
        <Indicador rotulo="Execução simulada" valor={rotulo(estado.data?.executorSimulado)} />
        <Indicador rotulo="Carteiras observadas" valor={estado.data?.monitor.carteiras ?? '—'} />
        <Indicador
          rotulo="Motor em execução"
          valor={formatarTempoRelativo(estado.data?.iniciadoEm).replace('há ', '')}
        />
      </div>
      <Cartao titulo="Auditoria" semEspacamento>
        {auditoria.isLoading ? (
          <Carregando />
        ) : (
          <Tabela
            linhas={auditoria.data ?? []}
            chave={(evento) => String(evento.id)}
            vazio="Nenhum evento registrado"
            colunas={[
              { titulo: 'Momento', celula: (evento) => formatarDataHora(evento.momento) },
              {
                titulo: 'Tipo',
                celula: (evento) => <span className="font-mono text-xs">{evento.tipo}</span>,
              },
              { titulo: 'Descrição', celula: (evento) => evento.descricao },
            ]}
          />
        )}
      </Cartao>
    </>
  )
}
