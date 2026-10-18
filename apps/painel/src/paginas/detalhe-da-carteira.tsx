import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { useAtualizarCarteira, useCarteira } from '../api/consultas'
import { Endereco, Token } from '../componentes/endereco'
import {
  Abas,
  Botao,
  Cabecalho,
  Carregando,
  Cartao,
  Entrada,
  Indicador,
  MensagemDeErro,
  Selecao,
  Tabela,
} from '../componentes/interface'
import { SeloDeStatus } from '../componentes/selos'
import {
  corDoResultado,
  formatarDataHora,
  formatarNumero,
  formatarPercentual,
  formatarSol,
  formatarSolComSinal,
} from '../utilidades/formatacao'
import { TabelaDeOperacoes } from './operacoes'

export function PaginaDetalheDaCarteira() {
  const { endereco = '' } = useParams()
  const detalhe = useCarteira(endereco)
  const atualizar = useAtualizarCarteira(endereco)
  const [aba, definirAba] = useState<'ciclos' | 'operacoes'>('ciclos')
  const [editando, definirEditando] = useState(false)
  const [apelido, definirApelido] = useState('')

  if (detalhe.isLoading) return <Carregando />
  if (detalhe.error || !detalhe.data) return <MensagemDeErro erro={detalhe.error} />
  const { carteira, ciclos } = detalhe.data
  const { metricas } = carteira

  return (
    <>
      <Cabecalho
        titulo={
          editando ? (
            <form
              className="flex items-center gap-2"
              onSubmit={async (evento) => {
                evento.preventDefault()
                await atualizar.mutateAsync({ apelido: apelido.trim() || null })
                definirEditando(false)
              }}
            >
              <Entrada
                autoFocus
                value={apelido}
                onChange={(e) => definirApelido(e.target.value)}
                className="text-lg"
              />
              <Botao type="submit" variante="primario" carregando={atualizar.isPending}>
                Salvar
              </Botao>
            </form>
          ) : (
            <span className="flex items-center gap-2">
              {carteira.apelido ?? 'Carteira sem apelido'}
              <Botao
                variante="fantasma"
                onClick={() => {
                  definirApelido(carteira.apelido ?? '')
                  definirEditando(true)
                }}
                aria-label="Editar apelido"
              >
                <Pencil className="size-4" />
              </Botao>
            </span>
          )
        }
        descricao={<Endereco endereco={carteira.endereco} />}
        acoes={
          <Selecao
            value={carteira.status}
            onChange={(e) => atualizar.mutate({ status: e.target.value })}
            className="w-44"
          >
            <option value="monitorada">Monitorada</option>
            <option value="candidata">Candidata</option>
            <option value="descartada">Descartada</option>
          </Selecao>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Indicador
          rotulo="Ciclos encerrados"
          valor={metricas.quantidadeDeCiclos}
          detalhe={`${carteira.ciclosAbertos} abertos`}
        />
        <Indicador
          rotulo="Taxa de acerto"
          valor={formatarPercentual(metricas.taxaDeAcerto, 0, false)}
          detalhe={`${metricas.acertos} ganhos · ${metricas.perdas} perdas`}
        />
        <Indicador
          rotulo="Resultado"
          valor={formatarSolComSinal(metricas.resultadoSol, 3)}
          className={corDoResultado(metricas.resultadoSol)}
        />
        <Indicador
          rotulo="Média por ciclo"
          valor={formatarPercentual(metricas.resultadoPercentualMedio)}
          className={corDoResultado(metricas.resultadoPercentualMedio)}
        />
        <Indicador rotulo="Fator de lucro" valor={formatarNumero(metricas.fatorDeLucro)} />
        <Indicador
          rotulo="Pior sequência"
          valor={`${metricas.maiorSequenciaDePerdas} perdas`}
          detalhe={`Atual: ${metricas.perdasConsecutivasAtuais}`}
        />
      </div>

      <Cartao semEspacamento>
        <div className="px-4 pt-2">
          <Abas
            ativa={aba}
            aoMudar={definirAba}
            abas={[
              { id: 'ciclos', rotulo: 'Ciclos', contador: ciclos.length },
              { id: 'operacoes', rotulo: 'Operações' },
            ]}
          />
        </div>
        {aba === 'ciclos' ? (
          <Tabela
            linhas={ciclos}
            chave={(c) => c.id}
            vazio="Nenhum ciclo registrado"
            colunas={[
              { titulo: 'Token', celula: (c) => <Token mint={c.token} simbolo={c.simboloDoToken} /> },
              { titulo: 'Status', celula: (c) => <SeloDeStatus valor={c.status} /> },
              { titulo: 'Aberto em', celula: (c) => formatarDataHora(c.abertoEm) },
              { titulo: 'Encerrado em', celula: (c) => formatarDataHora(c.encerradoEm) },
              { titulo: 'Compras', alinhamento: 'direita', celula: (c) => c.quantidadeDeCompras },
              { titulo: 'Vendas', alinhamento: 'direita', celula: (c) => c.quantidadeDeVendas },
              { titulo: 'Investido', alinhamento: 'direita', celula: (c) => formatarSol(c.investidoSol, 3) },
              { titulo: 'Retornado', alinhamento: 'direita', celula: (c) => formatarSol(c.retornadoSol, 3) },
              {
                titulo: 'Resultado',
                alinhamento: 'direita',
                celula: (c) => (
                  <span className={corDoResultado(c.resultadoRealizadoSol)}>
                    {formatarSolComSinal(c.resultadoRealizadoSol, 3)} (
                    {formatarPercentual(c.resultadoPercentual)})
                  </span>
                ),
              },
              {
                titulo: '',
                celula: (c) =>
                  c.teveTransferencias ? <span title="Ciclo com transferências">⇄</span> : null,
              },
            ]}
          />
        ) : (
          <TabelaDeOperacoes limite={300} carteira={carteira.endereco} />
        )}
      </Cartao>
    </>
  )
}
