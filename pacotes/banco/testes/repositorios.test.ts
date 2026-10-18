import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type ConexaoComBanco, conectarBanco, criarRepositorios, type Repositorios } from '../src'

let conexao: ConexaoComBanco
let repositorios: Repositorios

beforeAll(async () => {
  conexao = await conectarBanco('pglite://memoria')
  repositorios = criarRepositorios(conexao.banco)
})

afterAll(() => conexao.fechar())

describe('repositórios', () => {
  it('aplica as migrações e persiste carteiras', async () => {
    await repositorios.carteiras.criar({ endereco: 'Carteira1', apelido: 'Trader 1' })
    const carteira = await repositorios.carteiras.obter('Carteira1')
    expect(carteira).toMatchObject({ apelido: 'Trader 1', status: 'monitorada', etiquetas: [] })
  })

  it('garante um único ciclo aberto por carteira e token', async () => {
    const ciclo = {
      id: 'c1',
      carteira: 'Carteira1',
      token: 'Token1',
      status: 'aberto' as const,
      abertoEm: new Date(),
      encerradoEm: null,
      quantidade: 10,
      custoBaseSol: 1,
      investidoSol: 1,
      retornadoSol: 0,
      resultadoRealizadoSol: 0,
      quantidadeDeCompras: 1,
      quantidadeDeVendas: 0,
      teveTransferencias: false,
    }
    await repositorios.ciclos.salvar(ciclo)
    await expect(repositorios.ciclos.salvar({ ...ciclo, id: 'c2' })).rejects.toThrow()
    await repositorios.ciclos.salvar({ ...ciclo, status: 'encerrado', encerradoEm: new Date() })
    await repositorios.ciclos.salvar({ ...ciclo, id: 'c2' })
    expect(await repositorios.ciclos.custoAbertoDaCarteira('Carteira1')).toBe(1)
    expect((await repositorios.ciclos.obterAberto('Carteira1', 'Token1'))?.id).toBe('c2')
  })
})
