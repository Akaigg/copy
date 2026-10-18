import { EventEmitter } from 'node:events'
import type { EventoDoSistema } from '@hot/compartilhado'

export class BarramentoDeEventos {
  private readonly emissor = new EventEmitter().setMaxListeners(100)

  publicar(evento: EventoDoSistema) {
    this.emissor.emit('evento', evento)
  }

  assinar(ouvinte: (evento: EventoDoSistema) => void) {
    this.emissor.on('evento', ouvinte)
    return () => this.emissor.off('evento', ouvinte)
  }
}
