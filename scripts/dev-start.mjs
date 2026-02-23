#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const npmCache = resolve(process.cwd(), '.npm-cache')
const port = process.env.PORT || '4000'

console.log('[dev] Ensuring native dependencies are built...')
const rebuild = run('pnpm', ['rebuild', 'better-sqlite3', 'esbuild'])
if (rebuild.status !== 0) process.exit(rebuild.status ?? 1)

console.log('[dev] Running auth migrations...')
const migrate = run('pnpm', ['auth:migrate'])
if (migrate.status !== 0) process.exit(migrate.status ?? 1)

const dev = run('pnpm', ['vite', 'dev', '--port', port])
process.exit(dev.status ?? 0)

function run(command, args) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_cache: npmCache,
    },
    shell: process.platform === 'win32',
  })
}
