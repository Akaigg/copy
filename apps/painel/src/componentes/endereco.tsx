import { Check, Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { abreviarEndereco } from '../utilidades/formatacao'

export function Endereco({
  endereco,
  apelido,
  tipo = 'conta',
  linkInterno,
}: {
  endereco: string
  apelido?: string | null
  tipo?: 'conta' | 'token'
  linkInterno?: string
}) {
  const [copiado, definirCopiado] = useState(false)
  const copiar = async (evento: React.MouseEvent) => {
    evento.stopPropagation()
    await navigator.clipboard.writeText(endereco)
    definirCopiado(true)
    setTimeout(() => definirCopiado(false), 1200)
  }
  const texto = apelido ? (
    <span className="font-medium text-zinc-100">{apelido}</span>
  ) : (
    <span className="font-mono text-zinc-300">{abreviarEndereco(endereco)}</span>
  )
  return (
    <span className="inline-flex items-center gap-1.5" title={endereco}>
      {linkInterno ? (
        <Link to={linkInterno} onClick={(evento) => evento.stopPropagation()} className="hover:underline">
          {texto}
        </Link>
      ) : (
        texto
      )}
      <button
        type="button"
        onClick={copiar}
        className="text-zinc-600 hover:text-zinc-300"
        aria-label="Copiar endereço"
      >
        {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <a
        href={`https://solscan.io/${tipo === 'token' ? 'token' : 'account'}/${endereco}`}
        target="_blank"
        rel="noreferrer"
        onClick={(evento) => evento.stopPropagation()}
        className="text-zinc-600 hover:text-zinc-300"
        aria-label="Abrir no Solscan"
      >
        <ExternalLink className="size-3.5" />
      </a>
    </span>
  )
}

export function Token({ mint, simbolo }: { mint: string; simbolo: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {simbolo && <span className="font-semibold text-orange-300">${simbolo}</span>}
      <Endereco endereco={mint} tipo="token" />
    </span>
  )
}
