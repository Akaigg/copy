import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migrarPglite } from 'drizzle-orm/pglite/migrator'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { migrate as migrarPostgres } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as esquema from './esquema'

export type Banco = PgDatabase<PgQueryResultHKT, typeof esquema>

export interface ConexaoComBanco {
  banco: Banco
  fechar(): Promise<void>
}

const PASTA_DE_MIGRACOES = fileURLToPath(new URL('../migracoes', import.meta.url))
const PREFIXO_PGLITE = 'pglite:'

export async function conectarBanco(url: string): Promise<ConexaoComBanco> {
  if (url.startsWith(PREFIXO_PGLITE)) {
    const caminho = url.slice(PREFIXO_PGLITE.length).replace(/^\/\//, '')
    const cliente = caminho && caminho !== 'memoria' ? new PGlite(caminho) : new PGlite()
    const banco = drizzlePglite(cliente, { schema: esquema })
    await migrarPglite(banco, { migrationsFolder: PASTA_DE_MIGRACOES })
    return { banco: banco as unknown as Banco, fechar: () => cliente.close() }
  }
  const cliente = postgres(url, { max: 10, onnotice: () => {} })
  const banco = drizzlePostgres(cliente, { schema: esquema })
  await migrarPostgres(banco, { migrationsFolder: PASTA_DE_MIGRACOES })
  return { banco: banco as unknown as Banco, fechar: () => cliente.end() }
}
