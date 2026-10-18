import { rotulo } from '../utilidades/formatacao'
import { Campo, Entrada, Selecao } from './interface'

interface PropriedadeDoEsquema {
  type?: string
  enum?: string[]
  description?: string
  default?: unknown
  minimum?: number
  maximum?: number
}

export function valoresPadraoDoEsquema(esquema: Record<string, unknown>) {
  const propriedades = (esquema.properties ?? {}) as Record<string, PropriedadeDoEsquema>
  return Object.fromEntries(
    Object.entries(propriedades)
      .filter(([, propriedade]) => propriedade.default !== undefined)
      .map(([nome, propriedade]) => [nome, propriedade.default]),
  )
}

export function FormularioDeConfiguracao({
  esquema,
  valor,
  aoMudar,
}: {
  esquema: Record<string, unknown>
  valor: Record<string, unknown>
  aoMudar: (valor: Record<string, unknown>) => void
}) {
  const propriedades = Object.entries((esquema.properties ?? {}) as Record<string, PropriedadeDoEsquema>)
  if (propriedades.length === 0) {
    return <p className="text-sm text-zinc-500">Esta estratégia não possui parâmetros.</p>
  }
  const alterar = (nome: string, novo: unknown) => aoMudar({ ...valor, [nome]: novo })
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {propriedades.map(([nome, propriedade]) => {
        const atual = valor[nome] ?? propriedade.default
        const titulo = propriedade.description ?? rotulo(nome)
        if (propriedade.enum) {
          return (
            <Campo key={nome} rotulo={titulo}>
              <Selecao value={String(atual ?? '')} onChange={(evento) => alterar(nome, evento.target.value)}>
                {propriedade.enum.map((opcao) => (
                  <option key={opcao} value={opcao}>
                    {rotulo(opcao)}
                  </option>
                ))}
              </Selecao>
            </Campo>
          )
        }
        if (propriedade.type === 'boolean') {
          return (
            <label key={nome} className="flex items-center gap-2 text-sm text-zinc-300 sm:col-span-2">
              <input
                type="checkbox"
                checked={Boolean(atual)}
                onChange={(evento) => alterar(nome, evento.target.checked)}
                className="size-4 accent-orange-500"
              />
              {titulo}
            </label>
          )
        }
        return (
          <Campo key={nome} rotulo={titulo}>
            <Entrada
              type="number"
              value={atual === undefined ? '' : String(atual)}
              min={propriedade.minimum}
              max={propriedade.maximum}
              step={propriedade.type === 'integer' ? 1 : 'any'}
              onChange={(evento) =>
                alterar(nome, evento.target.value === '' ? undefined : Number(evento.target.value))
              }
            />
          </Campo>
        )
      })}
    </div>
  )
}
