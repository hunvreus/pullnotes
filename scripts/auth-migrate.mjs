#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const provider = (process.env.AUTH_DB_PROVIDER || 'sqlite').trim().toLowerCase()

if (provider === 'd1') {
  console.log('[auth:migrate] Skipping local Better Auth migration for AUTH_DB_PROVIDER=d1.')
  process.exit(0)
}

const child = spawnSync('pnpm', ['exec', 'better-auth', 'migrate', '--config', 'src/lib/auth.ts', '--yes'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
})

process.exit(child.status ?? 1)
