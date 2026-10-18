import type { Repositorios } from '@hot/banco'
import type {
  AtualizacaoDeCarteira,
  ConfiguracaoDaSessaoEnviada,
  EstadoDoSistema,
  NovaCarteira,
  NovaSessao,
} from '@hot/compartilhado'
import type { Sessao } from '@hot/dominio'
import type { BarramentoDeEventos } from '../barramento'
import type { Configuracao } from '../configuracao'
import type { Registro } from '../registro'
import type { Consultas } from '../servicos/consultas'
import type { MotorDeCopia } from '../servicos/motor-de-copia'

export interface ContextoDaApi {
  configuracao: Configuracao
  repositorios: Repositorios
  consultas: Consultas
  motor: MotorDeCopia
  barramento: BarramentoDeEventos
  registro: Registro
  pastaDoPainel: string | null
  estadoDoSistema(): EstadoDoSistema
  adicionarCarteira(dados: NovaCarteira): Promise<unknown>
  atualizarCarteira(endereco: string, dados: AtualizacaoDeCarteira): Promise<unknown>
  criarSessao(dados: NovaSessao): Promise<Sessao>
  reconfigurarSessao(id: string, configuracao: ConfiguracaoDaSessaoEnviada): Promise<Sessao>
  sincronizarMonitor(): Promise<void>
}
