import type { SaldoDeTokenNormalizado, SaldoDeTokenRpc, TransacaoNormalizada, TransacaoRpc } from './tipos'

function normalizarSaldos(saldos: SaldoDeTokenRpc[] | null | undefined): SaldoDeTokenNormalizado[] {
  return (saldos ?? []).map((saldo) => ({
    indiceDaConta: saldo.accountIndex,
    mint: saldo.mint,
    dono: saldo.owner ?? null,
    quantidadeBruta: BigInt(saldo.uiTokenAmount.amount),
    decimais: saldo.uiTokenAmount.decimals,
  }))
}

export function normalizarTransacao(transacao: TransacaoRpc): TransacaoNormalizada | null {
  const { meta } = transacao
  const assinatura = transacao.transaction.signatures[0]
  if (!meta || !assinatura) return null

  const chaves = transacao.transaction.message.accountKeys.map((chave) =>
    typeof chave === 'string' ? chave : chave.pubkey,
  )
  const chavesSaoObjetos = transacao.transaction.message.accountKeys.some(
    (chave) => typeof chave !== 'string',
  )
  const enderecosCarregados =
    !chavesSaoObjetos && meta.loadedAddresses
      ? [...meta.loadedAddresses.writable, ...meta.loadedAddresses.readonly]
      : []

  return {
    assinatura,
    slot: transacao.slot,
    horarioDoBloco: transacao.blockTime ? new Date(transacao.blockTime * 1000) : null,
    falhou: meta.err !== null && meta.err !== undefined,
    taxaLamports: meta.fee,
    contas: [...chaves, ...enderecosCarregados],
    saldosAntesLamports: meta.preBalances,
    saldosDepoisLamports: meta.postBalances,
    saldosDeTokenAntes: normalizarSaldos(meta.preTokenBalances),
    saldosDeTokenDepois: normalizarSaldos(meta.postTokenBalances),
  }
}
