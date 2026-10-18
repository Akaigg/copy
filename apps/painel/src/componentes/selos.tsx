import { rotulo } from '../utilidades/formatacao'
import { Selo, type TomDeSelo } from './interface'

const TONS: Record<string, TomDeSelo> = {
  compra: 'sucesso',
  venda: 'perigo',
  transferencia_entrada: 'info',
  transferencia_saida: 'info',
  entrada: 'sucesso',
  compra_adicional: 'sucesso',
  venda_parcial: 'perigo',
  venda_total: 'perigo',
  pendente: 'aviso',
  executada: 'sucesso',
  falhou: 'perigo',
  nao_copiada: 'neutro',
  ativa: 'sucesso',
  pausada: 'aviso',
  encerrada: 'neutro',
  aberta: 'info',
  aberto: 'info',
  encerrado: 'neutro',
  monitorada: 'sucesso',
  candidata: 'info',
  descartada: 'neutro',
  simulado: 'destaque',
  real: 'perigo',
}

export function SeloDeStatus({ valor }: { valor: string }) {
  return <Selo tom={TONS[valor] ?? 'neutro'}>{rotulo(valor)}</Selo>
}
