import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { drizzle } from 'drizzle-orm/d1'
import { createRequire } from 'node:module'

type DbProvider = 'sqlite' | 'd1'

const env = process.env
const dbProvider = (env.AUTH_DB_PROVIDER?.trim().toLowerCase() || 'sqlite') as DbProvider
const require = createRequire(import.meta.url)

const db = dbProvider === 'd1' ? createD1AuthDatabase() : createSqliteAuthDatabase()

export const auth = betterAuth({
  database: db,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  socialProviders: {
    github: {
      clientId: env.GITHUB_APP_CLIENT_ID as string,
      clientSecret: env.GITHUB_APP_CLIENT_SECRET as string,
      scopes: ['read:user', 'user:email'],
    },
  },
  plugins: [tanstackStartCookies()],
})

function createSqliteAuthDatabase() {
  const { mkdirSync } = requireNodeFs()
  const { dirname, resolve } = requireNodePath()
  const Database = requireBetterSqlite3()

  const authDbPath = resolve(process.cwd(), env.DB_PATH ?? './data/auth.db')
  mkdirSync(dirname(authDbPath), { recursive: true })
  return new Database(authDbPath)
}

function createD1AuthDatabase() {
  const bindingName = env.DB_D1_BINDING?.trim() || 'DB'
  const d1 = (globalThis as Record<string, unknown>)[bindingName]

  if (!d1) {
    throw new Error(
      `AUTH_DB_PROVIDER=d1 but D1 binding "${bindingName}" was not found on globalThis.`,
    )
  }

  return drizzleAdapter(drizzle(d1 as Parameters<typeof drizzle>[0]), {
    provider: 'sqlite',
  })
}

function requireNodeFs(): typeof import('node:fs') {
  // Keep sqlite-only Node deps out of D1 paths.
  return require('node:fs')
}

function requireNodePath(): typeof import('node:path') {
  return require('node:path')
}

function requireBetterSqlite3(): typeof import('better-sqlite3').default {
  return require('better-sqlite3')
}
