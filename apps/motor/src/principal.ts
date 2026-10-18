import { mkdirSync } from 'node:fs'
import { criarAplicacao } from './aplicacao'
import { lerConfiguracao } from './configuracao'
import { criarRegistro } from './registro'

const configuracao = lerConfiguracao()
const registro = criarRegistro(configuracao.NIVEL_DE_LOG)

if (configuracao.BANCO_URL.startsWith('pglite://./')) mkdirSync('./dados', { recursive: true })
if (!configuracao.PAINEL_TOKEN)
  registro.warn('PAINEL_TOKEN não definido: a API está aberta para quem acessar o endereço')

const aplicacao = await criarAplicacao(configuracao, registro)
await aplicacao.iniciar()
registro.info(`HOT CRYPTO AI em execução em http://${configuracao.HOST}:${configuracao.PORTA}`)

let encerrando = false
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, async () => {
    if (encerrando) return
    encerrando = true
    registro.info('Encerrando o motor')
    await aplicacao.parar()
    process.exit(0)
  })
}
