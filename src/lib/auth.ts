import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { betterAuth } from 'better-auth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

const authDbPath = resolve(process.cwd(), process.env.DB_PATH ?? './data/auth.db')
mkdirSync(dirname(authDbPath), { recursive: true })

const db = new Database(authDbPath)

export const auth = betterAuth({
  database: db,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_APP_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_APP_CLIENT_SECRET as string,
      scopes: ['read:user', 'user:email'],
    },
  },
  plugins: [tanstackStartCookies()],
})
