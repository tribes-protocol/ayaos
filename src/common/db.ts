import { PostgresDatabaseAdapter } from '@elizaos/adapter-postgres'
import { IDatabaseAdapter, IDatabaseCacheAdapter } from '@elizaos/core'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

export const drizzleDB = drizzle(
  postgres(process.env.POSTGRES_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10
  })
)

export async function initializeDatabase(): Promise<IDatabaseAdapter & IDatabaseCacheAdapter> {
  const db = new PostgresDatabaseAdapter({
    connectionString: process.env.POSTGRES_URL
  })
  await db.init()
  return db
}
