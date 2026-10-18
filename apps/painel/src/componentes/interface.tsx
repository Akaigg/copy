import { clsx } from 'clsx'
import { CircleAlert, LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

export function Cartao({
  titulo,
  descricao,
  acoes,
  children,
  className,
  semEspacamento = false,
}: {
  titulo?: ReactNode
  descricao?: ReactNode
  acoes?: ReactNode
  children: ReactNode
  className?: string
  semEspacamento?: boolean
}) {
  return (
    <section className={clsx('min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/60', className)}>
      {(titulo || acoes) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div>
            {titulo && <h2 className="text-sm font-semibold text-zinc-100">{titulo}</h2>}
            {descricao && <p className="mt-0.5 text-xs text-zinc-500">{descricao}</p>}
          </div>
          {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
        </header>
      )}
      <div className={semEspacamento ? '' : 'p-5'}>{children}</div>
    </section>
  )
}

export function Indicador({
  rotulo,
  valor,
  detalhe,
  className,
}: {
  rotulo: string
  valor: ReactNode
  detalhe?: ReactNode
  className?: string
}) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{rotulo}</p>
      <p className={clsx('mt-1 text-xl font-semibold tabular-nums', className)}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-zinc-500">{detalhe}</p>}
    </div>
  )
}

const VARIANTES_DE_BOTAO = {
  primario: 'bg-orange-500 text-zinc-950 hover:bg-orange-400 disabled:bg-orange-500/40',
  secundario: 'border border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700',
  perigo: 'border border-rose-900 bg-rose-950/60 text-rose-300 hover:bg-rose-900/60',
  fantasma: 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
}

export function Botao({
  variante = 'secundario',
  className,
  carregando,
  children,
  ...propriedades
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: keyof typeof VARIANTES_DE_BOTAO
  carregando?: boolean
}) {
  return (
    <button
      type="button"
      {...propriedades}
      disabled={propriedades.disabled || carregando}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTES_DE_BOTAO[variante],
        className,
      )}
    >
      {carregando && <LoaderCircle className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

const TONS_DE_SELO = {
  neutro: 'bg-zinc-800 text-zinc-300 ring-zinc-700',
  sucesso: 'bg-emerald-950 text-emerald-300 ring-emerald-800',
  perigo: 'bg-rose-950 text-rose-300 ring-rose-800',
  aviso: 'bg-amber-950 text-amber-300 ring-amber-800',
  info: 'bg-sky-950 text-sky-300 ring-sky-800',
  destaque: 'bg-orange-950 text-orange-300 ring-orange-800',
}

export type TomDeSelo = keyof typeof TONS_DE_SELO

export function Selo({ tom = 'neutro', children }: { tom?: TomDeSelo; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONS_DE_SELO[tom],
      )}
    >
      {children}
    </span>
  )
}

export function Campo({
  rotulo,
  ajuda,
  children,
}: {
  rotulo: string
  ajuda?: ReactNode
  children: ReactNode
}) {
  return (
    <fieldset className="block min-w-0">
      <legend className="text-xs font-medium text-zinc-400">{rotulo}</legend>
      <div className="mt-1">{children}</div>
      {ajuda && <span className="mt-1 block text-xs text-zinc-500">{ajuda}</span>}
    </fieldset>
  )
}

const ESTILO_DE_ENTRADA =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500'

export function Entrada({ className, ...propriedades }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...propriedades} className={clsx(ESTILO_DE_ENTRADA, className)} />
}

export function Selecao({ className, children, ...propriedades }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...propriedades} className={clsx(ESTILO_DE_ENTRADA, className)}>
      {children}
    </select>
  )
}

export function Abas<T extends string>({
  abas,
  ativa,
  aoMudar,
}: {
  abas: Array<{ id: T; rotulo: string; contador?: number }>
  ativa: T
  aoMudar: (aba: T) => void
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-zinc-800">
      {abas.map((aba) => (
        <button
          key={aba.id}
          type="button"
          onClick={() => aoMudar(aba.id)}
          className={clsx(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition',
            aba.id === ativa
              ? 'border-orange-500 text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-300',
          )}
        >
          {aba.rotulo}
          {aba.contador !== undefined && <span className="ml-1.5 text-xs text-zinc-500">{aba.contador}</span>}
        </button>
      ))}
    </div>
  )
}

export function Vazio({
  titulo,
  descricao,
  acao,
}: {
  titulo: string
  descricao?: ReactNode
  acao?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium text-zinc-300">{titulo}</p>
      {descricao && <p className="max-w-md text-sm text-zinc-500">{descricao}</p>}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  )
}

export function Carregando() {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500">
      <LoaderCircle className="size-4 animate-spin" />
      Carregando…
    </div>
  )
}

export function MensagemDeErro({ erro }: { erro: unknown }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      {erro instanceof Error ? erro.message : 'Erro inesperado'}
    </div>
  )
}

export interface Coluna<Linha> {
  titulo: string
  celula: (linha: Linha) => ReactNode
  alinhamento?: 'esquerda' | 'direita'
  className?: string
}

export function Tabela<Linha>({
  colunas,
  linhas,
  chave,
  vazio = 'Nenhum registro',
  aoClicar,
}: {
  colunas: Coluna<Linha>[]
  linhas: Linha[]
  chave: (linha: Linha) => string
  vazio?: string
  aoClicar?: (linha: Linha) => void
}) {
  if (linhas.length === 0) return <Vazio titulo={vazio} />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            {colunas.map((coluna) => (
              <th
                key={coluna.titulo}
                className={clsx(
                  'whitespace-nowrap px-4 py-2 font-medium',
                  coluna.alinhamento === 'direita' ? 'text-right' : 'text-left',
                )}
              >
                {coluna.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/70">
          {linhas.map((linha) => (
            <tr
              key={chave(linha)}
              onClick={aoClicar ? () => aoClicar(linha) : undefined}
              className={clsx('transition', aoClicar && 'cursor-pointer hover:bg-zinc-800/40')}
            >
              {colunas.map((coluna) => (
                <td
                  key={coluna.titulo}
                  className={clsx(
                    'whitespace-nowrap px-4 py-2.5 tabular-nums',
                    coluna.alinhamento === 'direita' ? 'text-right' : 'text-left',
                    coluna.className,
                  )}
                >
                  {coluna.celula(linha)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Cabecalho({
  titulo,
  descricao,
  acoes,
}: {
  titulo: ReactNode
  descricao?: ReactNode
  acoes?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-zinc-500">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </div>
  )
}
