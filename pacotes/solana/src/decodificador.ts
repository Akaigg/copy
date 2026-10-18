import type { OperacaoDeOrigem, TipoDeOperacao } from '@hot/dominio'
import { LAMPORTS_POR_SOL, MINT_SOL_EMBRULHADO, MOEDAS_ESTAVEIS, PROGRAMAS_CONHECIDOS } from './constantes'
import type { SaldoDeTokenNormalizado, TransacaoNormalizada } from './tipos'

export const CONTRAPARTIDA_MINIMA_SOL = 0.000001

export interface OpcoesDeDecodificacao {
  precoSolEmUsd: number | null
  horarioDeDeteccao: Date
}

interface VariacaoDeToken {
  mint: string
  decimais: number
  antes: bigint
  depois: bigint
}

export function identificarPlataforma(contas: string[]): string | null {
  const presentes = new Set(contas)
  return PROGRAMAS_CONHECIDOS.find(([programa]) => presentes.has(programa))?.[1] ?? null
}

function paraUnidades(quantidadeBruta: bigint, decimais: number) {
  return Number(quantidadeBruta) / 10 ** decimais
}

function saldosDaCarteira(saldos: SaldoDeTokenNormalizado[], carteira: string) {
  return saldos.filter((saldo) => saldo.dono === carteira)
}

function agruparVariacoes(transacao: TransacaoNormalizada, carteira: string) {
  const variacoes = new Map<string, VariacaoDeToken>()
  const obter = (saldo: SaldoDeTokenNormalizado) => {
    const existente = variacoes.get(saldo.mint)
    if (existente) return existente
    const nova = { mint: saldo.mint, decimais: saldo.decimais, antes: 0n, depois: 0n }
    variacoes.set(saldo.mint, nova)
    return nova
  }
  for (const saldo of saldosDaCarteira(transacao.saldosDeTokenAntes, carteira))
    obter(saldo).antes += saldo.quantidadeBruta
  for (const saldo of saldosDaCarteira(transacao.saldosDeTokenDepois, carteira))
    obter(saldo).depois += saldo.quantidadeBruta
  return [...variacoes.values()]
}

function contasDeTokenDaCarteira(transacao: TransacaoNormalizada, carteira: string) {
  return new Set(
    [...transacao.saldosDeTokenAntes, ...transacao.saldosDeTokenDepois]
      .filter((saldo) => saldo.dono === carteira)
      .map((saldo) => saldo.indiceDaConta),
  )
}

function variacaoDeLamports(transacao: TransacaoNormalizada, indice: number) {
  return (transacao.saldosDepoisLamports[indice] ?? 0) - (transacao.saldosAntesLamports[indice] ?? 0)
}

function calcularContrapartidaSol(
  transacao: TransacaoNormalizada,
  carteira: string,
  indiceDaCarteira: number,
  variacoes: VariacaoDeToken[],
  precoSolEmUsd: number | null,
): number | null {
  let lamports = variacaoDeLamports(transacao, indiceDaCarteira)
  for (const indice of contasDeTokenDaCarteira(transacao, carteira))
    lamports += variacaoDeLamports(transacao, indice)
  if (indiceDaCarteira === 0) lamports += transacao.taxaLamports

  let contrapartida = lamports / LAMPORTS_POR_SOL
  for (const variacao of variacoes) {
    if (!MOEDAS_ESTAVEIS.has(variacao.mint) || variacao.antes === variacao.depois) continue
    if (!precoSolEmUsd) return null
    contrapartida += paraUnidades(variacao.depois - variacao.antes, variacao.decimais) / precoSolEmUsd
  }
  return contrapartida
}

function saldoSolAntes(
  transacao: TransacaoNormalizada,
  indiceDaCarteira: number,
  variacoes: VariacaoDeToken[],
) {
  const nativo = (transacao.saldosAntesLamports[indiceDaCarteira] ?? 0) / LAMPORTS_POR_SOL
  const embrulhado = variacoes.find((variacao) => variacao.mint === MINT_SOL_EMBRULHADO)
  return nativo + (embrulhado ? paraUnidades(embrulhado.antes, embrulhado.decimais) : 0)
}

function classificar(
  variacaoDoToken: bigint,
  contrapartidaSol: number | null,
  unicoToken: boolean,
): TipoDeOperacao {
  const contrapartidaRelevante =
    unicoToken && contrapartidaSol !== null && Math.abs(contrapartidaSol) >= CONTRAPARTIDA_MINIMA_SOL
  if (contrapartidaRelevante && variacaoDoToken > 0n && (contrapartidaSol as number) < 0) return 'compra'
  if (contrapartidaRelevante && variacaoDoToken < 0n && (contrapartidaSol as number) > 0) return 'venda'
  return variacaoDoToken > 0n ? 'transferencia_entrada' : 'transferencia_saida'
}

export function decodificarOperacoes(
  transacao: TransacaoNormalizada,
  carteira: string,
  opcoes: OpcoesDeDecodificacao,
): OperacaoDeOrigem[] {
  if (transacao.falhou) return []
  const indiceDaCarteira = transacao.contas.indexOf(carteira)
  if (indiceDaCarteira < 0) return []

  const variacoes = agruparVariacoes(transacao, carteira)
  const variacoesDeTokens = variacoes.filter(
    (variacao) =>
      variacao.antes !== variacao.depois &&
      variacao.mint !== MINT_SOL_EMBRULHADO &&
      !MOEDAS_ESTAVEIS.has(variacao.mint),
  )
  if (variacoesDeTokens.length === 0) return []

  const contrapartidaSol = calcularContrapartidaSol(
    transacao,
    carteira,
    indiceDaCarteira,
    variacoes,
    opcoes.precoSolEmUsd,
  )
  const plataforma = identificarPlataforma(transacao.contas)
  const solAntes = saldoSolAntes(transacao, indiceDaCarteira, variacoes)
  const unicoToken = variacoesDeTokens.length === 1

  return variacoesDeTokens.map((variacao) => {
    const diferenca = variacao.depois - variacao.antes
    const tipo = classificar(diferenca, contrapartidaSol, unicoToken)
    const quantidadeToken = paraUnidades(diferenca < 0n ? -diferenca : diferenca, variacao.decimais)
    const valorSol = tipo === 'compra' || tipo === 'venda' ? Math.abs(contrapartidaSol as number) : 0
    return {
      id: `${transacao.assinatura}:${carteira}:${variacao.mint}`,
      assinatura: transacao.assinatura,
      carteira,
      token: variacao.mint,
      tipo,
      quantidadeToken,
      decimais: variacao.decimais,
      valorSol,
      precoSol: valorSol > 0 && quantidadeToken > 0 ? valorSol / quantidadeToken : null,
      saldoTokenAntes: paraUnidades(variacao.antes, variacao.decimais),
      saldoTokenDepois: paraUnidades(variacao.depois, variacao.decimais),
      saldoSolAntes: solAntes,
      plataforma,
      slot: transacao.slot,
      horarioDoBloco: transacao.horarioDoBloco ?? opcoes.horarioDeDeteccao,
      horarioDeDeteccao: opcoes.horarioDeDeteccao,
    }
  })
}
