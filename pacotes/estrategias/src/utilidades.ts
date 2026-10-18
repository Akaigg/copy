import type { CarteiraDaSessao, Endereco, ResumoDeCiclo } from '@hot/dominio'

export function abreviarEndereco(endereco: Endereco) {
  return `${endereco.slice(0, 4)}…${endereco.slice(-4)}`
}

export function ordenarPelaFila(carteiras: CarteiraDaSessao[]) {
  return [...carteiras].sort((a, b) => a.ordem - b.ordem)
}

export function ciclosDaCarteira(ciclos: ResumoDeCiclo[], carteira: Endereco, desde: Date) {
  return ciclos.filter((ciclo) => ciclo.carteira === carteira && ciclo.encerradoEm >= desde)
}

export function descreverAtivas(enderecos: Endereco[]) {
  return enderecos.length ? `Ativas: ${enderecos.map(abreviarEndereco).join(', ')}` : 'Nenhuma carteira ativa'
}
