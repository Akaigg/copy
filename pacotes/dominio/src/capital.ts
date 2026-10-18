import type { Endereco, PosicaoDeCopia, Sessao } from './tipos'

export function patrimonioDeReferencia(sessao: Pick<Sessao, 'caixaSol'>, posicoesAbertas: PosicaoDeCopia[]) {
  return sessao.caixaSol + posicoesAbertas.reduce((total, posicao) => total + posicao.custoBaseSol, 0)
}

export function custoAbertoDaCarteira(posicoesAbertas: PosicaoDeCopia[], carteira: Endereco) {
  return posicoesAbertas
    .filter((posicao) => posicao.carteira === carteira)
    .reduce((total, posicao) => total + posicao.custoBaseSol, 0)
}

export function custoAbertoNoToken(posicoesAbertas: PosicaoDeCopia[], token: Endereco) {
  return posicoesAbertas
    .filter((posicao) => posicao.token === token)
    .reduce((total, posicao) => total + posicao.custoBaseSol, 0)
}

export function fracaoAtivaDaCarteira(sessao: Pick<Sessao, 'carteirasAtivas'>, carteira: Endereco) {
  return sessao.carteirasAtivas.find((ativa) => ativa.endereco === carteira)?.fracaoDoCapital ?? null
}
