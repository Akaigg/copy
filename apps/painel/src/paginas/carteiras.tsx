import { Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAdicionarCarteira, useCarteiras } from '../api/consultas'
import { Endereco } from '../componentes/endereco'
import {
  Botao,
  Cabecalho,
  Campo,
  Carregando,
  Cartao,
  Entrada,
  MensagemDeErro,
  Tabela,
} from '../componentes/interface'
import { SeloDeStatus } from '../componentes/selos'
import {
  corDoResultado,
  formatarNumero,
  formatarPercentual,
  formatarSolComSinal,
  formatarTempoRelativo,
} from '../utilidades/formatacao'

function FormularioDeNovaCarteira({ aoConcluir }: { aoConcluir: () => void }) {
  const adicionar = useAdicionarCarteira()
  const [endereco, definirEndereco] = useState('')
  const [apelido, definirApelido] = useState('')
  const [historico, definirHistorico] = useState('100')

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    await adicionar.mutateAsync({
      endereco: endereco.trim(),
      apelido: apelido.trim() || undefined,
      importarHistorico: Number(historico) || 0,
    })
    aoConcluir()
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[2fr_1fr_1fr]">
        <Campo rotulo="Endereço da carteira">
          <Entrada
            required
            className="font-mono"
            value={endereco}
            onChange={(e) => definirEndereco(e.target.value)}
            placeholder="Endereço Solana"
          />
        </Campo>
        <Campo rotulo="Apelido">
          <Entrada value={apelido} onChange={(e) => definirApelido(e.target.value)} placeholder="Opcional" />
        </Campo>
        <Campo rotulo="Importar histórico" ajuda="Últimas transações a analisar (0 a 1000)">
          <Entrada
            type="number"
            min="0"
            max="1000"
            value={historico}
            onChange={(e) => definirHistorico(e.target.value)}
          />
        </Campo>
      </div>
      {adicionar.error && <MensagemDeErro erro={adicionar.error} />}
      <div className="flex justify-end gap-2">
        <Botao onClick={aoConcluir}>Cancelar</Botao>
        <Botao type="submit" variante="primario" carregando={adicionar.isPending}>
          Monitorar carteira
        </Botao>
      </div>
    </form>
  )
}

export function PaginaCarteiras() {
  const carteiras = useCarteiras()
  const navegar = useNavigate()
  const [adicionando, definirAdicionando] = useState(false)

  return (
    <>
      <Cabecalho
        titulo="Carteiras"
        descricao="Traders monitorados e seus resultados por ciclo (da primeira compra até zerar a posição)."
        acoes={
          !adicionando && (
            <Botao variante="primario" onClick={() => definirAdicionando(true)}>
              <Plus className="size-4" />
              Adicionar carteira
            </Botao>
          )
        }
      />
      {adicionando && (
        <Cartao titulo="Nova carteira" className="mb-6">
          <FormularioDeNovaCarteira aoConcluir={() => definirAdicionando(false)} />
        </Cartao>
      )}
      <Cartao semEspacamento>
        {carteiras.isLoading && <Carregando />}
        {carteiras.error && <MensagemDeErro erro={carteiras.error} />}
        {carteiras.data && (
          <Tabela
            linhas={carteiras.data}
            chave={(c) => c.endereco}
            aoClicar={(c) => navegar(`/carteiras/${c.endereco}`)}
            vazio="Nenhuma carteira cadastrada"
            colunas={[
              { titulo: 'Carteira', celula: (c) => <Endereco endereco={c.endereco} apelido={c.apelido} /> },
              { titulo: 'Status', celula: (c) => <SeloDeStatus valor={c.status} /> },
              { titulo: 'Ciclos', alinhamento: 'direita', celula: (c) => c.metricas.quantidadeDeCiclos },
              { titulo: 'Abertos', alinhamento: 'direita', celula: (c) => c.ciclosAbertos },
              {
                titulo: 'Acerto',
                alinhamento: 'direita',
                celula: (c) =>
                  c.metricas.quantidadeDeCiclos ? formatarPercentual(c.metricas.taxaDeAcerto, 0, false) : '—',
              },
              {
                titulo: 'Resultado',
                alinhamento: 'direita',
                celula: (c) => (
                  <span className={corDoResultado(c.metricas.resultadoSol)}>
                    {formatarSolComSinal(c.metricas.resultadoSol, 3)}
                  </span>
                ),
              },
              {
                titulo: 'Média por ciclo',
                alinhamento: 'direita',
                celula: (c) => (
                  <span className={corDoResultado(c.metricas.resultadoPercentualMedio)}>
                    {formatarPercentual(c.metricas.resultadoPercentualMedio)}
                  </span>
                ),
              },
              {
                titulo: 'Fator de lucro',
                alinhamento: 'direita',
                celula: (c) => formatarNumero(c.metricas.fatorDeLucro),
              },
              {
                titulo: 'Última operação',
                alinhamento: 'direita',
                celula: (c) => (
                  <span className="text-zinc-400">{formatarTempoRelativo(c.ultimaOperacaoEm)}</span>
                ),
              },
            ]}
          />
        )}
      </Cartao>
    </>
  )
}
