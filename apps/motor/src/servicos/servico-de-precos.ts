import { type ClienteJupiter, MINT_SOL_EMBRULHADO } from '@hot/solana'

interface Cache<T> {
  valor: T
  expiraEm: number
}

export interface ServicoDePrecos {
  precoSolEmUsd(): Promise<number | null>
  precosEmSol(mints: string[]): Promise<Map<string, number>>
}

export class ServicoDePrecosJupiter implements ServicoDePrecos {
  private precoSol: Cache<number> | null = null
  private readonly precosUsd = new Map<string, Cache<number>>()

  constructor(
    private readonly jupiter: ClienteJupiter,
    private readonly validadeMs = 30_000,
  ) {}

  async precoSolEmUsd() {
    if (this.precoSol && this.precoSol.expiraEm > Date.now()) return this.precoSol.valor
    try {
      const precos = await this.jupiter.obterPrecosEmUsd([MINT_SOL_EMBRULHADO])
      const valor = precos.get(MINT_SOL_EMBRULHADO)
      if (valor) this.precoSol = { valor, expiraEm: Date.now() + this.validadeMs }
    } catch {
      return this.precoSol?.valor ?? null
    }
    return this.precoSol?.valor ?? null
  }

  async precosEmSol(mints: string[]) {
    const resultado = new Map<string, number>()
    const precoSol = await this.precoSolEmUsd()
    if (!precoSol || mints.length === 0) return resultado
    const agora = Date.now()
    const ausentes = mints.filter((mint) => (this.precosUsd.get(mint)?.expiraEm ?? 0) <= agora)
    if (ausentes.length) {
      try {
        const novos = await this.jupiter.obterPrecosEmUsd(ausentes)
        for (const [mint, valor] of novos)
          this.precosUsd.set(mint, { valor, expiraEm: agora + this.validadeMs })
      } catch {}
    }
    for (const mint of mints) {
      const cache = this.precosUsd.get(mint)
      if (cache) resultado.set(mint, cache.valor / precoSol)
    }
    return resultado
  }
}

export class ServicoDePrecosIndisponivel implements ServicoDePrecos {
  async precoSolEmUsd() {
    return null
  }

  async precosEmSol() {
    return new Map<string, number>()
  }
}
