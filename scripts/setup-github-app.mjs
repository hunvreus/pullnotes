#!/usr/bin/env node
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  cancel,
  intro,
  isCancel,
  note,
  outro,
  select,
  spinner,
  text,
} from '@clack/prompts'

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  printHelp()
  process.exit(0)
}

async function main() {
  intro('PullNotes Setup Wizard')

  const profile = await askSelect({
    message: 'Environment profile',
    initialValue: args.profile || inferProfile(),
    options: [
      {
        value: 'local',
        label: 'Local development',
        hint: 'defaults to localhost URLs',
      },
      {
        value: 'remote',
        label: 'Remote/production',
        hint: 'headless/server friendly defaults',
      },
    ],
  })

  const defaultBaseUrl =
    args.baseUrl ||
    process.env.BETTER_AUTH_URL ||
    (profile === 'local' ? 'http://localhost:4000' : 'https://example.com')

  const defaultMode =
    args.mode ||
    (profile === 'local' && !process.env.SSH_CONNECTION ? 'local' : 'manual')

  const mode = await askSelect({
    message: 'GitHub App creation flow',
    initialValue: defaultMode,
    options: [
      {
        value: 'local',
        label: 'Auto callback capture',
        hint: 'runs local listener and captures code automatically',
      },
      {
        value: 'manual',
        label: 'Manual code paste',
        hint: 'works well on servers/headless environments',
      },
    ],
  })

  const ownerType = await askSelect({
    message: 'Create GitHub App under',
    initialValue: args.ownerType || 'personal',
    options: [
      { value: 'personal', label: 'Personal account settings' },
      { value: 'org', label: 'Organization settings' },
    ],
  })

  const orgSlug =
    ownerType === 'org'
      ? await askText('Organization slug', args.org || '', true)
      : ''

  const baseUrl = trimSlash(defaultBaseUrl)
  const appName = (args.appName || 'PullNotes').trim()

  const authCallbackUrl = `${baseUrl}/api/auth/callback/github`
  const state = randomBytes(16).toString('hex')

  const manifest = {
    name: appName,
    url: baseUrl,
    callback_urls: [authCallbackUrl],
    redirect_url: authCallbackUrl,
    description: 'Simple markdown editor powered by GitHub.',
    public: false,
    default_permissions: {
      contents: 'write',
      metadata: 'read',
    },
    // Better Auth already handles GitHub OAuth login separately.
    request_oauth_on_install: false,
    setup_on_update: false,
  }

  const appCreationUrl =
    ownerType === 'org'
      ? `https://github.com/organizations/${encodeURIComponent(orgSlug)}/settings/apps/new?state=${encodeURIComponent(state)}`
      : `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`

  const s = spinner()
  s.start('Launching GitHub App manifest flow')

  let code
  if (mode === 'local') {
    const host = '127.0.0.1'
    const port = Number(args.port || 8787)
    const setupCallbackUrl = `http://${host}:${port}/callback`

    code = await runLocalFlow({
      host,
      port,
      appCreationUrl,
      state,
      manifest: {
        ...manifest,
        // This callback is only for manifest conversion code capture in setup.
        redirect_url: setupCallbackUrl,
      },
      autoOpen: args.open,
    })
  } else {
    code = await runManualFlow({ appCreationUrl, state, manifest })
  }
  s.stop('Received temporary manifest code')

  s.start('Converting manifest code via GitHub API')
  const converted = await exchangeManifestCode(code)
  s.stop('GitHub App created')

  const envPath = resolve(process.cwd(), args.envPath || '.env')
  const envValues = {
    BETTER_AUTH_URL: baseUrl,
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET || randomBytes(32).toString('base64url'),
    AUTH_DB_PATH: process.env.AUTH_DB_PATH || './data/auth.db',
    GITHUB_APP_ID: String(converted.id),
    GITHUB_APP_NAME: converted.slug,
    GITHUB_APP_CLIENT_ID: converted.client_id,
    GITHUB_APP_CLIENT_SECRET: converted.client_secret,
    GITHUB_APP_PRIVATE_KEY: wrapQuoted(escapeNewlines(converted.pem || '')),
  }

  upsertEnv(envPath, envValues)

  note(
    [
      `App: ${converted.name} (${converted.slug})`,
      `Updated env: ${envPath}`,
      `Auth callback URL: ${authCallbackUrl}`,
      'Webhook: disabled in manifest setup (can be configured later).',
    ].join('\n'),
    'Completed',
  )

  outro('Next: install app on your repo/account, run `pnpm auth:migrate`, then `pnpm dev`.')
}

main().catch((error) => {
  cancel(`Setup failed: ${toMessage(error)}`)
  process.exit(1)
})

async function askText(message, initialValue, required) {
  const value = await text({
    message,
    initialValue,
    validate: (input) => {
      if (required && !input?.trim()) return 'Required'
      return undefined
    },
  })

  if (isCancel(value)) {
    cancel('Cancelled')
    process.exit(0)
  }

  return String(value).trim()
}

async function askSelect({ message, options, initialValue }) {
  const value = await select({
    message,
    options,
    initialValue,
  })

  if (isCancel(value)) {
    cancel('Cancelled')
    process.exit(0)
  }

  return String(value)
}

async function runLocalFlow({ host, port, appCreationUrl, state, manifest, autoOpen }) {
  let resolveCode
  let rejectCode

  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const startPath = '/start'
  const callbackPath = '/api/github-app/callback'

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${host}:${port}`)

    if (url.pathname === startPath) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(renderAutoPostPage({ appCreationUrl, manifest }))
      return
    }

    if (url.pathname === callbackPath) {
      const incomingState = url.searchParams.get('state') || ''
      const code = url.searchParams.get('code') || url.searchParams.get('temporary_code') || ''
      const error = url.searchParams.get('error') || ''

      if (error) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`Error from GitHub: ${error}`)
        rejectCode(new Error(`GitHub returned error: ${error}`))
        return
      }

      if (incomingState !== state) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Invalid state. Return to terminal.')
        rejectCode(new Error('OAuth state mismatch while creating GitHub App.'))
        return
      }

      if (!code) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('No temporary code received.')
        rejectCode(new Error('Missing temporary code in callback URL.'))
        return
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<h1>GitHub App created.</h1><p>Return to terminal.</p>')
      resolveCode(code)
      return
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })

  const launchUrl = `http://${host}:${port}${startPath}`
  note(launchUrl, 'Open this URL if browser does not open automatically')

  if (autoOpen) {
    tryOpenBrowser(launchUrl)
  }

  const timeoutMs = 10 * 60 * 1000
  const timeoutId = setTimeout(() => {
    rejectCode(new Error('Timed out waiting for browser callback.'))
  }, timeoutMs)

  try {
    return await codePromise
  } finally {
    clearTimeout(timeoutId)
    server.close()
  }
}

async function runManualFlow({ appCreationUrl, state, manifest }) {
  const launcherPath = resolve(process.cwd(), 'github-app-manifest-launcher.html')
  writeFileSync(launcherPath, renderAutoPostPage({ appCreationUrl, manifest }), 'utf8')

  note(
    [
      `Open this file in a browser: ${launcherPath}`,
      'Complete GitHub App creation and copy `code` (or `temporary_code`) from callback URL.',
      `Expected state: ${state}`,
    ].join('\n'),
    'Manual flow',
  )

  return askText('Paste temporary code', '', true)
}

function renderAutoPostPage({ appCreationUrl, manifest }) {
  const escapedAction = escapeHtml(appCreationUrl)
  const escapedManifest = escapeHtml(JSON.stringify(manifest))

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub App Setup</title>
  </head>
  <body>
    <form id="manifest-form" method="post" action="${escapedAction}">
      <input type="hidden" name="manifest" value="${escapedManifest}" />
      <noscript>
        <p>JavaScript is disabled. Click continue.</p>
        <button type="submit">Continue</button>
      </noscript>
    </form>
    <script>
      document.getElementById('manifest-form').submit();
    </script>
  </body>
</html>`
}

async function exchangeManifestCode(code) {
  const response = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`GitHub manifest conversion failed (${response.status}): ${body}`)
  }

  return response.json()
}

function upsertEnv(filePath, values) {
  const lines = existsSync(filePath)
    ? readFileSync(filePath, 'utf8').split(/\r?\n/)
    : []

  const nextLines = [...lines]

  for (const [key, rawValue] of Object.entries(values)) {
    const value = rawValue == null ? '' : String(rawValue)
    const line = `${key}=${value}`
    const index = nextLines.findIndex((existing) => existing.startsWith(`${key}=`))

    if (index >= 0) nextLines[index] = line
    else nextLines.push(line)
  }

  writeFileSync(filePath, `${nextLines.join('\n').replace(/\n+$/g, '')}\n`, 'utf8')
}

function tryOpenBrowser(url) {
  const platform = process.platform

  if (platform === 'darwin') {
    execFile('open', [url], () => {})
    return
  }

  if (platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], () => {})
    return
  }

  execFile('xdg-open', [url], () => {})
}

function inferProfile() {
  if (process.env.SSH_CONNECTION || process.env.CI) return 'remote'
  return 'local'
}

function parseArgs(argv) {
  const result = {
    help: false,
    mode: '',
    profile: '',
    port: '',
    envPath: '',
    baseUrl: '',
    appName: '',
    ownerType: '',
    org: '',
    open: true,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') result.help = true
    else if (arg === '--mode') result.mode = argv[++i] || ''
    else if (arg === '--profile') result.profile = argv[++i] || ''
    else if (arg === '--port') result.port = argv[++i] || ''
    else if (arg === '--env') result.envPath = argv[++i] || ''
    else if (arg === '--base-url') result.baseUrl = argv[++i] || ''
    else if (arg === '--app-name') result.appName = argv[++i] || ''
    else if (arg === '--owner-type') result.ownerType = argv[++i] || ''
    else if (arg === '--org') result.org = argv[++i] || ''
    else if (arg === '--no-open') result.open = false
  }

  return result
}

function printHelp() {
  console.log(`GitHub App setup helper\n\nUsage:\n  node scripts/setup-github-app.mjs [options]\n\nOptions:\n  --profile <local|remote> Environment profile preset\n  --mode <local|manual>    Manifest flow mode\n  --port <number>          Local callback port (default: 8787)\n  --env <path>             Env file path (default: .env)\n  --base-url <url>         App base URL\n  --app-name <name>        GitHub App display name\n  --owner-type <type>      personal or org\n  --org <slug>             Organization slug when owner-type=org\n  --no-open                Do not try to open browser automatically\n  -h, --help               Show help\n`)
}

function trimSlash(value) {
  return value.replace(/\/+$/g, '')
}

function escapeNewlines(value) {
  return value.replace(/\r\n/g, '\n').replace(/\n/g, '\\n')
}

function wrapQuoted(value) {
  return `"${value.replace(/"/g, '\\"')}"`
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function toMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
