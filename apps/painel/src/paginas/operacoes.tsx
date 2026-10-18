import type { OperacaoResposta, Serializado } from '@hot/compartilhado'
import { useState } from 'react'
import { useCarteiras, useOperacoes } from '../api/consultas'
import { Endereco, Token } from '../componentes/endereco'
import {
  Cabecalho,
  Carregando,
  Cartao,
  type Coluna,
  MensagemDeErro,
  Selecao,
  Selo,
  Tabela,
} from '../componentes/interface'
import { SeloDeStatus } from '../componentes/selos'
import {
  formatarDataHora,
  formatarLatencia,
  formatarNumero,
  formatarPreco,
  formatarSol,
  formatarTempoRelativo,
} from '../utilidades/formatacao'

type Operacao = Serializado<OperacaoResposta>

const COLUNA_DE_CARTEIRA: Coluna<Operacao> = {
  titulo: 'Carteira',
  celula: (o) => (
    <Endereco endereco={o.carteira} apelido={o.apelidoDaCarteira} linkInterno={`/carteiras/${o.carteira}`} />
  ),
}

const COLUNAS_DETALHADAS: Coluna<Operacao>[] = [
  { titulo: 'Quantidade', alinhamento: 'direita', celula: (o) => formatarNumero(o.quantidadeToken) },
  { titulo: 'Preço (SOL)', alinhamento: 'direita', celula: (o) => formatarPreco(o.precoSol) },
  {
    titulo: 'Posição vendida',
    alinhamento: 'direita',
    celula: (o) =>
      o.tipo === 'venda' && o.saldoTokenAntes > 0
        ? `${Math.round((o.quantidadeToken / o.saldoTokenAntes) * 100)}%`
        : '—',
  },
  { titulo: 'Plataforma', celula: (o) => o.plataforma ?? '—' },
  {
    titulo: 'Detecção',
    alinhamento: 'direita',
    celula: (o) =>
      o.historica ? (
        <Selo>Histórico</Selo>
      ) : (
        formatarLatencia(new Date(o.horarioDeDeteccao).getTime() - new Date(o.horarioDoBloco).getTime())
      ),
  },
]

export function TabelaDeOperacoes({
  limite,
  carteira,
  compacta = false,
}: {
  limite: number
  carteira?: string
  compacta?: boolean
}) {
  const operacoes = useOperacoes(limite, carteira)
  if (operacoes.isLoading) return <Carregando />
  if (operacoes.error) return <MensagemDeErro erro={operacoes.error} />
  const colunas: Coluna<Operacao>[] = [
    {
      titulo: 'Quando',
      celula: (o) => (
        <span title={formatarDataHora(o.horarioDoBloco)} className="text-zinc-400">
          {compacta ? formatarTempoRelativo(o.horarioDoBloco) : formatarDataHora(o.horarioDoBloco)}
        </span>
      ),
    },
    ...(carteira ? [] : [COLUNA_DE_CARTEIRA]),
    { titulo: 'Tipo', celula: (o) => <SeloDeStatus valor={o.tipo} /> },
    { titulo: 'Token', celula: (o) => <Token mint={o.token} simbolo={o.simboloDoToken} /> },
    {
      titulo: 'Valor',
      alinhamento: 'direita',
      celula: (o) => (o.valorSol ? formatarSol(o.valorSol, 3) : '—'),
    },
    ...(compacta ? [] : COLUNAS_DETALHADAS),
  ]
  return (
    <Tabela
      linhas={operacoes.data ?? []}
      chave={(o) => o.id}
      vazio="Nenhuma operação detectada ainda"
      colunas={colunas}
    />
  )
}

export function PaginaOperacoes() {
  const carteiras = useCarteiras()
  const [carteira, definirCarteira] = useState('')
  return (
    <>
      <Cabecalho
        titulo="Operações dos traders"
        descricao="Compras, vendas e transferências detectadas nas carteiras monitoradas, em tempo real."
        acoes={
          <Selecao value={carteira} onChange={(e) => definirCarteira(e.target.value)} className="w-64">
            <option value="">Todas as carteiras</option>
            {carteiras.data?.map((c) => (
              <option key={c.endereco} value={c.endereco}>
                {c.apelido ?? c.endereco}
              </option>
            ))}
          </Selecao>
        }
      />
      <Cartao semEspacamento>
        <TabelaDeOperacoes limite={300} carteira={carteira || undefined} />
      </Cartao>
    </>
  )
}
