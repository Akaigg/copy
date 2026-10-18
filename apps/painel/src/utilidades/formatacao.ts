const formatadores = new Map<string, Intl.NumberFormat>()

function formatador(minimo: number, maximo: number, compacto = false) {
  const chave = `${minimo}:${maximo}:${compacto}`
  let existente = formatadores.get(chave)
  if (!existente) {
    existente = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: minimo,
      maximumFractionDigits: maximo,
      ...(compacto ? { notation: 'compact' as const } : {}),
    })
    formatadores.set(chave, existente)
  }
  return existente
}

type Numero = number | null | undefined

export function formatarSol(valor: Numero, casas = 4) {
  if (valor === null || valor === undefined) return '—'
  return `${formatador(casas, casas).format(valor)} SOL`
}

export function formatarSolComSinal(valor: Numero, casas = 4) {
  if (valor === null || valor === undefined) return '—'
  return `${valor > 0 ? '+' : ''}${formatarSol(valor, casas)}`
}

export function formatarPercentual(fracao: Numero, casas = 1, comSinal = true) {
  if (fracao === null || fracao === undefined || !Number.isFinite(fracao)) return '—'
  const sinal = comSinal && fracao > 0 ? '+' : ''
  return `${sinal}${formatador(casas, casas).format(fracao * 100)}%`
}

export function formatarNumero(valor: Numero, casas = 2) {
  if (valor === null || valor === undefined) return '—'
  return Math.abs(valor) >= 100_000
    ? formatador(0, 2, true).format(valor)
    : formatador(0, casas).format(valor)
}

export function formatarPreco(valor: Numero) {
  if (valor === null || valor === undefined) return '—'
  if (valor === 0) return '0'
  const casas = Math.min(14, Math.max(2, 3 - Math.floor(Math.log10(Math.abs(valor)))))
  return formatador(0, casas).format(valor)
}

export function formatarDataHora(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatarTempoRelativo(iso: string | null | undefined) {
  if (!iso) return '—'
  const segundos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (segundos < 60) return `há ${segundos} s`
  if (segundos < 3600) return `há ${Math.floor(segundos / 60)} min`
  if (segundos < 86_400) return `há ${Math.floor(segundos / 3600)} h`
  return `há ${Math.floor(segundos / 86_400)} d`
}

export function formatarLatencia(milissegundos: Numero) {
  if (milissegundos === null || milissegundos === undefined) return '—'
  const positivo = Math.max(0, milissegundos)
  return positivo < 1000 ? `${Math.round(positivo)} ms` : `${formatador(1, 1).format(positivo / 1000)} s`
}

export function abreviarEndereco(endereco: string, tamanho = 4) {
  return `${endereco.slice(0, tamanho)}…${endereco.slice(-tamanho)}`
}

export function corDoResultado(valor: Numero) {
  if (!valor) return 'text-zinc-400'
  return valor > 0 ? 'text-emerald-400' : 'text-rose-400'
}

const ROTULOS: Record<string, string> = {
  compra: 'Compra',
  venda: 'Venda',
  transferencia_entrada: 'Transferência recebida',
  transferencia_saida: 'Transferência enviada',
  entrada: 'Entrada',
  compra_adicional: 'Compra adicional',
  venda_parcial: 'Venda parcial',
  venda_total: 'Venda total',
  pendente: 'Pendente',
  executada: 'Executada',
  falhou: 'Falhou',
  nao_copiada: 'Não copiada',
  ativa: 'Ativa',
  pausada: 'Pausada',
  encerrada: 'Encerrada',
  aberta: 'Aberta',
  aberto: 'Aberto',
  encerrado: 'Encerrado',
  simulado: 'Simulado',
  real: 'Real',
  candidata: 'Candidata',
  monitorada: 'Monitorada',
  descartada: 'Descartada',
  cotacao: 'Cotação Jupiter',
  preco_do_trader: 'Preço do trader',
  transacao: 'Transação',
  proporcional_ao_patrimonio: 'Proporcional ao patrimônio do trader',
  multiplicador_fixo: 'Multiplicador fixo',
  valor_fixo: 'Valor fixo por entrada',
  reduzir: 'Reduzir a ordem até o limite',
  nao_copiar: 'Não copiar a operação',
  ignorar: 'Ignorar',
  espelhar_como_venda: 'Espelhar como venda',
  trader: 'Resultado do trader',
  robo: 'Resultado do robô',
  nunca: 'Nunca',
  apos_ciclo_lucrativo_do_trader: 'Após um ciclo lucrativo do trader',
  resultado_sol: 'Resultado em SOL',
  resultado_percentual_medio: 'Resultado percentual médio',
  taxa_de_acerto: 'Taxa de acerto',
  fator_de_lucro: 'Fator de lucro',
  igual: 'Igual entre as carteiras',
  proporcional_ao_desempenho: 'Proporcional ao desempenho',
  abriu: 'Abriu ciclo',
  atualizou: 'Atualizou ciclo',
  encerrou: 'Encerrou ciclo',
  sem_ciclo: 'Sem ciclo',
  logs: 'WebSocket padrão',
  helius: 'Helius',
  desativada: 'Desativada',
  jupiter: 'Cotação Jupiter',
  referencia: 'Preço do trader',
}

export function rotulo(valor: string | null | undefined) {
  if (!valor) return '—'
  return ROTULOS[valor] ?? valor.replaceAll('_', ' ').replace(/^./, (letra) => letra.toUpperCase())
}
