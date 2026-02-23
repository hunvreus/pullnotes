#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const npmCache = resolve(process.cwd(), '.npm-cache')

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
