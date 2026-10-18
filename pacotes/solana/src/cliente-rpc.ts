import type { TransacaoRpc } from './tipos'

export interface AssinaturaRpc {
  signature: string
  slot: number
  err: unknown
  blockTime: number | null
}

export class ErroDeRpc extends Error {}

export class ClienteRpcSolana {
  private proximoIdentificador = 1

  constructor(
    private readonly url: string,
    private readonly tempoLimiteMs = 15_000,
  ) {}

  async chamar<Resultado>(metodo: string, parametros: unknown[]): Promise<Resultado> {
    const resposta = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.proximoIdentificador++,
        method: metodo,
        params: parametros,
      }),
      signal: AbortSignal.timeout(this.tempoLimiteMs),
    })
    if (!resposta.ok) throw new ErroDeRpc(`RPC respondeu ${resposta.status} em ${metodo}`)
    const corpo = (await resposta.json()) as { result?: Resultado; error?: { message: string } }
    if (corpo.error) throw new ErroDeRpc(`${metodo}: ${corpo.error.message}`)
    return corpo.result as Resultado
  }

  obterTransacao(assinatura: string) {
    return this.chamar<TransacaoRpc | null>('getTransaction', [
      assinatura,
      { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
    ])
  }

  obterAssinaturas(
    endereco: string,
    opcoes: { ate?: string | null; antesDe?: string | null; limite: number },
  ) {
    return this.chamar<AssinaturaRpc[]>('getSignaturesForAddress', [
      endereco,
      {
        limit: opcoes.limite,
        commitment: 'confirmed',
        ...(opcoes.ate ? { until: opcoes.ate } : {}),
        ...(opcoes.antesDe ? { before: opcoes.antesDe } : {}),
      },
    ])
  }

  async obterSaldoSol(endereco: string) {
    const resultado = await this.chamar<{ value: number }>('getBalance', [
      endereco,
      { commitment: 'confirmed' },
    ])
    return resultado.value / 1_000_000_000
  }

  async obterTransacaoComRetentativas(assinatura: string, tentativas = 6, intervaloMs = 400) {
    for (let tentativa = 0; tentativa < tentativas; tentativa++) {
      const transacao = await this.obterTransacao(assinatura)
      if (transacao) return transacao
      await new Promise((resolver) => setTimeout(resolver, intervaloMs * (tentativa + 1)))
    }
    return null
  }
}
