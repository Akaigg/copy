import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ProvedorDeEventos } from './api/eventos'
import { Aplicativo } from './aplicativo'
import './estilos.css'

const cliente = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false, retry: 1 } },
})

const raiz = document.getElementById('raiz')
if (raiz) {
  createRoot(raiz).render(
    <StrictMode>
      <QueryClientProvider client={cliente}>
        <ProvedorDeEventos>
          <Aplicativo />
        </ProvedorDeEventos>
      </QueryClientProvider>
    </StrictMode>,
  )
}
