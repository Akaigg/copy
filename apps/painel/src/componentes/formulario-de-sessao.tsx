import {
  type ConfiguracaoDaSessaoEnviada,
  esquemaDeDimensionamento,
  esquemaDeLimites,
  esquemaDeRegras,
  type Serializado,
} from '@hot/compartilhado'
import type { ConfiguracaoDeDimensionamento, LimitesDaSessao, RegrasDeCopia, Sessao } from '@hot/dominio'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { useCarteiras, useCriarSessao, useEstrategias, useReconfigurarSessao } from '../api/consultas'
import { abreviarEndereco, rotulo } from '../utilidades/formatacao'
import { FormularioDeConfiguracao, valoresPadraoDoEsquema } from './formulario-de-configuracao'
import { Botao, Campo, Cartao, Entrada, MensagemDeErro, Selecao } from './interface'

interface CarteiraNoFormulario {
  endereco: string
  percentual: number
}

const ROTULOS_DOS_LIMITES: Record<keyof LimitesDaSessao, [string, string?]> = {
  valorMinimoPorOrdemSol: [
    'Valor mínimo por ordem (SOL)',
    'Ordens menores não são copiadas, pois as taxas dominariam o resultado',
  ],
  valorMaximoPorOrdemSol: ['Valor máximo por ordem (SOL)'],
  exposicaoMaximaPorTokenSol: ['Exposição máxima por token (SOL)'],
  posicoesAbertasMaximas: ['Posições abertas simultâneas'],
  volumeDiarioMaximoDeComprasSol: ['Volume de compras em 24 h (SOL)'],
  idadeMaximaParaCopiarCompraSegundos: [
    'Atraso máximo para copiar compras (s)',
    'Compras detectadas com atraso maior, como após uma reconexão, não são copiadas. Vendas são sempre copiadas.',
  ],
  slippageMaximoBps: ['Slippage máximo (bps)', '100 bps = 1%'],
}

const COM_FRACOES = new Set(['tradicional'])

export function FormularioDeSessao({
  sessao,
  aoConcluir,
}: {
  sessao?: Serializado<Sessao>
  aoConcluir: (id: string) => void
}) {
  const estrategias = useEstrategias()
  const carteirasCadastradas = useCarteiras()
  const criar = useCriarSessao()
  const reconfigurar = useReconfigurarSessao(sessao?.id ?? '')
  const mutacao = sessao ? reconfigurar : criar

  const [nome, definirNome] = useState(sessao?.nome ?? '')
  const [capital, definirCapital] = useState(sessao ? String(sessao.capitalInicialSol) : '1')
  const [carteiras, definirCarteiras] = useState<CarteiraNoFormulario[]>(
    sessao?.carteiras.map((c) => ({ endereco: c.endereco, percentual: c.fracaoDoCapital * 100 })) ?? [],
  )
  const [novaCarteira, definirNovaCarteira] = useState('')
  const [estrategiaIdentificador, definirEstrategia] = useState(
    sessao?.estrategiaIdentificador ?? 'tradicional',
  )
  const [estrategiaConfiguracao, definirConfiguracao] = useState<Record<string, unknown>>(
    (sessao?.estrategiaConfiguracao as Record<string, unknown>) ?? {},
  )
  const [dimensionamento, definirDimensionamento] = useState<ConfiguracaoDeDimensionamento>(
    sessao?.dimensionamento ?? esquemaDeDimensionamento.parse({}),
  )
  const [limites, definirLimites] = useState<LimitesDaSessao>(sessao?.limites ?? esquemaDeLimites.parse({}))
  const [regras, definirRegras] = useState<RegrasDeCopia>(sessao?.regras ?? esquemaDeRegras.parse({}))

  const estrategiaSelecionada = estrategias.data?.find((e) => e.identificador === estrategiaIdentificador)
  const apelidos = useMemo(
    () => new Map((carteirasCadastradas.data ?? []).map((c) => [c.endereco, c.apelido])),
    [carteirasCadastradas.data],
  )
  const disponiveis = (carteirasCadastradas.data ?? []).filter(
    (c) => c.status !== 'descartada' && !carteiras.some((selecionada) => selecionada.endereco === c.endereco),
  )
  const somaPercentual = carteiras.reduce((total, c) => total + c.percentual, 0)
  const usaFracoes = COM_FRACOES.has(estrategiaIdentificador)

  const adicionarCarteira = (endereco: string) => {
    const limpo = endereco.trim()
    if (!limpo || carteiras.some((c) => c.endereco === limpo)) return
    const restante = Math.max(0, 100 - somaPercentual)
    definirCarteiras([...carteiras, { endereco: limpo, percentual: restante }])
    definirNovaCarteira('')
  }

  const mover = (indice: number, direcao: -1 | 1) => {
    const destino = indice + direcao
    if (destino < 0 || destino >= carteiras.length) return
    const copia = [...carteiras]
    const [item] = copia.splice(indice, 1)
    if (item) copia.splice(destino, 0, item)
    definirCarteiras(copia)
  }

  const distribuirIgualmente = () =>
    definirCarteiras(
      carteiras.map((c) => ({ ...c, percentual: Math.floor(10_000 / carteiras.length) / 100 })),
    )

  const trocarEstrategia = (identificador: string) => {
    definirEstrategia(identificador)
    const esquema = estrategias.data?.find((e) => e.identificador === identificador)?.esquemaDeConfiguracao
    definirConfiguracao(esquema ? valoresPadraoDoEsquema(esquema) : {})
  }

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    const configuracao: ConfiguracaoDaSessaoEnviada = {
      carteiras: carteiras.map((c) => ({
        endereco: c.endereco,
        fracaoDoCapital: usaFracoes ? c.percentual / 100 : 1 / carteiras.length,
      })),
      estrategiaIdentificador,
      estrategiaConfiguracao,
      dimensionamento,
      limites,
      regras,
    }
    const resultado = sessao
      ? await reconfigurar.mutateAsync(configuracao)
      : await criar.mutateAsync({ nome, capitalInicialSol: Number(capital), modo: 'simulado', configuracao })
    aoConcluir(resultado.id)
  }

  return (
    <form onSubmit={enviar} className="space-y-6">
      {!sessao && (
        <Cartao titulo="Sessão" descricao="Sessões simuladas usam cotações reais, sem movimentar capital.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Nome">
              <Entrada
                required
                value={nome}
                onChange={(e) => definirNome(e.target.value)}
                placeholder="Ex.: Top 3 memecoins"
              />
            </Campo>
            <Campo rotulo="Capital inicial (SOL)">
              <Entrada
                required
                type="number"
                min="0.0001"
                step="any"
                value={capital}
                onChange={(e) => definirCapital(e.target.value)}
              />
            </Campo>
          </div>
        </Cartao>
      )}

      <Cartao
        titulo="Estratégia de cópia"
        descricao="Define quais carteiras ficam ativas e como o capital é distribuído."
      >
        <div className="space-y-4">
          <Campo rotulo="Estratégia" ajuda={estrategiaSelecionada?.descricao}>
            <Selecao value={estrategiaIdentificador} onChange={(e) => trocarEstrategia(e.target.value)}>
              {estrategias.data?.map((estrategia) => (
                <option key={estrategia.identificador} value={estrategia.identificador}>
                  {estrategia.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
          {estrategiaSelecionada && (
            <FormularioDeConfiguracao
              esquema={estrategiaSelecionada.esquemaDeConfiguracao}
              valor={estrategiaConfiguracao}
              aoMudar={definirConfiguracao}
            />
          )}
        </div>
      </Cartao>

      <Cartao
        titulo="Carteiras copiadas"
        descricao={
          usaFracoes
            ? 'Defina a fração do capital de cada carteira. A soma não pode passar de 100%.'
            : 'A ordem da lista é a fila usada pela estratégia. O capital é distribuído pela própria estratégia.'
        }
        acoes={
          usaFracoes &&
          carteiras.length > 1 && (
            <Botao variante="fantasma" onClick={distribuirIgualmente}>
              Distribuir igualmente
            </Botao>
          )
        }
      >
        <div className="space-y-3">
          {carteiras.map((carteira, indice) => (
            <div
              key={carteira.endereco}
              className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
            >
              <span className="w-6 text-xs text-zinc-500">{indice + 1}º</span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {apelidos.get(carteira.endereco) ?? (
                  <span className="font-mono">{abreviarEndereco(carteira.endereco, 6)}</span>
                )}
              </span>
              {usaFracoes && (
                <div className="flex items-center gap-1">
                  <Entrada
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    className="w-24 text-right"
                    value={carteira.percentual}
                    onChange={(e) =>
                      definirCarteiras(
                        carteiras.map((c, i) =>
                          i === indice ? { ...c, percentual: Number(e.target.value) } : c,
                        ),
                      )
                    }
                  />
                  <span className="text-sm text-zinc-500">%</span>
                </div>
              )}
              <Botao variante="fantasma" onClick={() => mover(indice, -1)} aria-label="Subir">
                <ArrowUp className="size-4" />
              </Botao>
              <Botao variante="fantasma" onClick={() => mover(indice, 1)} aria-label="Descer">
                <ArrowDown className="size-4" />
              </Botao>
              <Botao
                variante="fantasma"
                onClick={() => definirCarteiras(carteiras.filter((_, i) => i !== indice))}
                aria-label="Remover"
              >
                <Trash2 className="size-4" />
              </Botao>
            </div>
          ))}
          {usaFracoes && carteiras.length > 0 && (
            <p className={somaPercentual > 100.01 ? 'text-sm text-rose-400' : 'text-sm text-zinc-500'}>
              Total alocado: {somaPercentual.toFixed(2)}%
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Selecao className="max-w-xs" value="" onChange={(e) => adicionarCarteira(e.target.value)}>
              <option value="">Adicionar carteira cadastrada…</option>
              {disponiveis.map((c) => (
                <option key={c.endereco} value={c.endereco}>
                  {c.apelido ?? abreviarEndereco(c.endereco, 6)}
                </option>
              ))}
            </Selecao>
            <Entrada
              className="max-w-sm flex-1 font-mono"
              placeholder="Ou cole um endereço"
              value={novaCarteira}
              onChange={(e) => definirNovaCarteira(e.target.value)}
            />
            <Botao onClick={() => adicionarCarteira(novaCarteira)} disabled={!novaCarteira.trim()}>
              <Plus className="size-4" />
              Adicionar
            </Botao>
          </div>
        </div>
      </Cartao>

      <Cartao
        titulo="Dimensionamento"
        descricao="Traduz o tamanho das compras do trader para o capital do robô. Vendas são sempre percentuais."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Modo">
            <Selecao
              value={dimensionamento.modo}
              onChange={(e) =>
                definirDimensionamento({
                  ...dimensionamento,
                  modo: e.target.value as ConfiguracaoDeDimensionamento['modo'],
                })
              }
            >
              {(['proporcional_ao_patrimonio', 'multiplicador_fixo', 'valor_fixo'] as const).map((modo) => (
                <option key={modo} value={modo}>
                  {rotulo(modo)}
                </option>
              ))}
            </Selecao>
          </Campo>
          {dimensionamento.modo === 'multiplicador_fixo' && (
            <Campo rotulo="Multiplicador" ajuda="0,1 copia cada compra com 10% do valor do trader">
              <Entrada
                type="number"
                min="0"
                step="any"
                value={dimensionamento.multiplicador}
                onChange={(e) =>
                  definirDimensionamento({ ...dimensionamento, multiplicador: Number(e.target.value) })
                }
              />
            </Campo>
          )}
          {dimensionamento.modo === 'valor_fixo' && (
            <Campo
              rotulo="Valor por entrada (SOL)"
              ajuda="Compras adicionais mantêm a proporção da entrada do trader"
            >
              <Entrada
                type="number"
                min="0"
                step="any"
                value={dimensionamento.valorFixoSol}
                onChange={(e) =>
                  definirDimensionamento({ ...dimensionamento, valorFixoSol: Number(e.target.value) })
                }
              />
            </Campo>
          )}
          <Campo rotulo="Quando faltar capital ou o limite for atingido">
            <Selecao
              value={dimensionamento.aoFaltarCapital}
              onChange={(e) =>
                definirDimensionamento({
                  ...dimensionamento,
                  aoFaltarCapital: e.target.value as ConfiguracaoDeDimensionamento['aoFaltarCapital'],
                })
              }
            >
              <option value="reduzir">{rotulo('reduzir')}</option>
              <option value="nao_copiar">{rotulo('nao_copiar')}</option>
            </Selecao>
          </Campo>
          <Campo rotulo="Transferências de tokens para outra carteira">
            <Selecao
              value={regras.transferenciaDeSaida}
              onChange={(e) =>
                definirRegras({
                  transferenciaDeSaida: e.target.value as RegrasDeCopia['transferenciaDeSaida'],
                })
              }
            >
              <option value="ignorar">{rotulo('ignorar')}</option>
              <option value="espelhar_como_venda">{rotulo('espelhar_como_venda')}</option>
            </Selecao>
          </Campo>
        </div>
      </Cartao>

      <Cartao
        titulo="Limites de segurança"
        descricao="Proteções técnicas. Compras acima dos limites são reduzidas ou não copiadas; vendas nunca são bloqueadas."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(ROTULOS_DOS_LIMITES) as Array<keyof LimitesDaSessao>).map((chave) => {
            const [titulo, ajuda] = ROTULOS_DOS_LIMITES[chave]
            return (
              <Campo key={chave} rotulo={titulo} ajuda={ajuda}>
                <Entrada
                  type="number"
                  min="0"
                  step="any"
                  value={limites[chave]}
                  onChange={(e) => definirLimites({ ...limites, [chave]: Number(e.target.value) })}
                />
              </Campo>
            )
          })}
        </div>
      </Cartao>

      {mutacao.error && <MensagemDeErro erro={mutacao.error} />}
      <div className="flex justify-end">
        <Botao
          type="submit"
          variante="primario"
          carregando={mutacao.isPending}
          disabled={carteiras.length === 0}
        >
          {sessao ? 'Salvar configuração' : 'Criar sessão simulada'}
        </Botao>
      </div>
    </form>
  )
}
