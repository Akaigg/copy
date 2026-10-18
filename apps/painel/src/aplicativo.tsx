import { clsx } from 'clsx'
import { Activity, Flame, GitCompare, KeyRound, Layers, LayoutDashboard, Server, Wallet } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router'
import { definirToken, EVENTO_NAO_AUTORIZADO } from './api/cliente'
import { useConexaoEmTempoReal } from './api/eventos'
import { Botao, Entrada } from './componentes/interface'
import { PaginaCarteiras } from './paginas/carteiras'
import { PaginaCompararSessoes } from './paginas/comparar-sessoes'
import { PaginaDetalheDaCarteira } from './paginas/detalhe-da-carteira'
import { PaginaDetalheDaSessao } from './paginas/detalhe-da-sessao'
import { PaginaOperacoes } from './paginas/operacoes'
import { PaginaNovaSessao, PaginaSessoes } from './paginas/sessoes'
import { PaginaSistema } from './paginas/sistema'
import { PaginaVisaoGeral } from './paginas/visao-geral'

const NAVEGACAO = [
  { para: '/', rotulo: 'Visão geral', icone: LayoutDashboard },
  { para: '/carteiras', rotulo: 'Carteiras', icone: Wallet },
  { para: '/operacoes', rotulo: 'Operações', icone: Activity },
  { para: '/sessoes', rotulo: 'Sessões', icone: Layers },
  { para: '/comparar', rotulo: 'Comparar', icone: GitCompare },
  { para: '/sistema', rotulo: 'Sistema', icone: Server },
]

function SolicitacaoDeToken() {
  const [visivel, definirVisivel] = useState(false)
  const [token, definirValor] = useState('')
  useEffect(() => {
    const mostrar = () => definirVisivel(true)
    window.addEventListener(EVENTO_NAO_AUTORIZADO, mostrar)
    return () => window.removeEventListener(EVENTO_NAO_AUTORIZADO, mostrar)
  }, [])
  if (!visivel) return null
  const salvar = (evento: FormEvent) => {
    evento.preventDefault()
    definirToken(token.trim())
    window.location.reload()
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <form
        onSubmit={salvar}
        className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6"
      >
        <div className="flex items-center gap-2 text-lg font-semibold">
          <KeyRound className="size-5 text-orange-400" />
          Acesso ao painel
        </div>
        <p className="text-sm text-zinc-400">Informe o valor de PAINEL_TOKEN configurado no motor.</p>
        <Entrada type="password" autoFocus value={token} onChange={(e) => definirValor(e.target.value)} />
        <Botao type="submit" variante="primario" className="w-full">
          Entrar
        </Botao>
      </form>
    </div>
  )
}

function BarraLateral() {
  const { conectado } = useConexaoEmTempoReal()
  return (
    <aside className="sticky top-0 z-10 flex min-w-0 shrink-0 flex-col border-b border-zinc-800 bg-zinc-950 md:h-screen md:w-60 md:border-r md:border-b-0">
      <div className="flex items-center gap-2 px-5 py-5">
        <Flame className="size-6 text-orange-500" />
        <div>
          <p className="text-sm font-bold tracking-wide">HOT CRYPTO AI</p>
          <p className="text-xs text-zinc-500">Copy trading fiel</p>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
        {NAVEGACAO.map(({ para, rotulo, icone: Icone }) => (
          <NavLink
            key={para}
            to={para}
            end={para === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200',
              )
            }
          >
            <Icone className="size-4" />
            {rotulo}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto hidden items-center gap-2 px-5 py-4 text-xs text-zinc-500 md:flex">
        <span
          className={clsx('size-2 rounded-full', conectado ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse')}
        />
        {conectado ? 'Atualizando ao vivo' : 'Reconectando ao motor'}
      </div>
    </aside>
  )
}

export function Aplicativo() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen flex-col md:flex-row">
        <BarraLateral />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          <Routes>
            <Route path="/" element={<PaginaVisaoGeral />} />
            <Route path="/carteiras" element={<PaginaCarteiras />} />
            <Route path="/carteiras/:endereco" element={<PaginaDetalheDaCarteira />} />
            <Route path="/operacoes" element={<PaginaOperacoes />} />
            <Route path="/sessoes" element={<PaginaSessoes />} />
            <Route path="/sessoes/nova" element={<PaginaNovaSessao />} />
            <Route path="/sessoes/:id" element={<PaginaDetalheDaSessao />} />
            <Route path="/comparar" element={<PaginaCompararSessoes />} />
            <Route path="/sistema" element={<PaginaSistema />} />
          </Routes>
        </main>
      </div>
      <SolicitacaoDeToken />
    </BrowserRouter>
  )
}
