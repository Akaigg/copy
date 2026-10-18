export class FilaSerial {
  private readonly cadeias = new Map<string, Promise<unknown>>()

  executar<Resultado>(chave: string, tarefa: () => Promise<Resultado>): Promise<Resultado> {
    const anterior = this.cadeias.get(chave) ?? Promise.resolve()
    const atual = anterior.catch(() => undefined).then(tarefa)
    this.cadeias.set(chave, atual)
    atual
      .catch(() => undefined)
      .finally(() => {
        if (this.cadeias.get(chave) === atual) this.cadeias.delete(chave)
      })
    return atual
  }

  async aguardarTudo() {
    while (this.cadeias.size > 0) await Promise.allSettled([...this.cadeias.values()])
  }
}
