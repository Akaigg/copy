export interface ConfiguracaoDaJupiter {
  urlBase: string
  chaveDeApi?: string | null
  tempoLimiteMs?: number
}

export interface PedidoDeCotacao {
  mintEntrada: string
  mintSaida: string
  quantidadeBruta: bigint
  slippageBps: number
}

export interface Cotacao {
  quantidadeEntradaBruta: bigint
  quantidadeSaidaBruta: bigint
  impactoDePreco: number
  rotas: string[]
}

export interface InformacoesDoToken {
  mint: string
  simbolo: string | null
  nome: string | null
  icone: string | null
  decimais: number | null
}

export class ClienteJupiter {
  constructor(private readonly configuracao: ConfiguracaoDaJupiter) {}

  private async obterJson<T>(caminho: string, parametros: Record<string, string>): Promise<T> {
    const url = new URL(caminho, this.configuracao.urlBase)
    for (const [chave, valor] of Object.entries(parametros)) url.searchParams.set(chave, valor)
    const resposta = await fetch(url, {
      headers: this.configuracao.chaveDeApi ? { 'x-api-key': this.configuracao.chaveDeApi } : {},
      signal: AbortSignal.timeout(this.configuracao.tempoLimiteMs ?? 8000),
    })
    if (!resposta.ok) throw new Error(`Jupiter respondeu ${resposta.status}: ${await resposta.text()}`)
    return (await resposta.json()) as T
  }

  async cotar(pedido: PedidoDeCotacao): Promise<Cotacao> {
    const resposta = await this.obterJson<{
      inAmount: string
      outAmount: string
      priceImpactPct: string
      routePlan: Array<{ swapInfo: { label?: string } }>
    }>('/swap/v1/quote', {
      inputMint: pedido.mintEntrada,
      outputMint: pedido.mintSaida,
      amount: pedido.quantidadeBruta.toString(),
      slippageBps: String(pedido.slippageBps),
    })
    return {
      quantidadeEntradaBruta: BigInt(resposta.inAmount),
      quantidadeSaidaBruta: BigInt(resposta.outAmount),
      impactoDePreco: Number(resposta.priceImpactPct),
      rotas: resposta.routePlan.map((rota) => rota.swapInfo.label ?? 'desconhecida'),
    }
  }

  async obterPrecosEmUsd(mints: string[]): Promise<Map<string, number>> {
    const precos = new Map<string, number>()
    for (let inicio = 0; inicio < mints.length; inicio += 50) {
      const lote = mints.slice(inicio, inicio + 50)
      const resposta = await this.obterJson<Record<string, { usdPrice?: number } | null>>('/price/v3', {
        ids: lote.join(','),
      })
      for (const [mint, dados] of Object.entries(resposta)) {
        if (dados?.usdPrice) precos.set(mint, dados.usdPrice)
      }
    }
    return precos
  }

  async obterInformacoesDoToken(mint: string): Promise<InformacoesDoToken | null> {
    const resposta = await this.obterJson<
      Array<{ id: string; name?: string; symbol?: string; icon?: string; decimals?: number }>
    >('/tokens/v2/search', { query: mint })
    const token = resposta.find((item) => item.id === mint)
    if (!token) return null
    return {
      mint,
      simbolo: token.symbol ?? null,
      nome: token.name ?? null,
      icone: token.icon ?? null,
      decimais: token.decimals ?? null,
    }
  }
}
