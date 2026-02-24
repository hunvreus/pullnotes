#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const npmCache = resolve(process.cwd(), '.npm-cache')
const provider = (process.env.AUTH_DB_PROVIDER || 'sqlite').trim().toLowerCase()

if (provider === 'd1') {
  console.log('[auth:migrate] Skipping local Better Auth migration for AUTH_DB_PROVIDER=d1.')
  process.exit(0)
}

const child = spawnSync(
  'pnpm',
  ['dlx', '@better-auth/cli@latest', 'migrate', '--config', 'src/lib/auth.ts', '--yes'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_cache: npmCache,
    },
    shell: process.platform === 'win32',
  },
)

process.exit(child.status ?? 1)
