# GitNote

Very simple Markdown editor for one GitHub repo path using:

- TanStack Start
- shadcn/ui
- Pages Editor component (`editor.pagescms.org`)
- Better Auth (GitHub login)
- GitHub App installation tokens (repo read/write)

## Data model

All content is fixed to:

```md
---
title: My title
---

Body markdown...
```

Hierarchy is filesystem-only:

- parent: `setup.md`
- children: `setup/*.md`

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Fill `.env`:

- Better Auth:
  - `BETTER_AUTH_SECRET`
  - `BETTER_AUTH_URL` (for local: `http://localhost:4000`)
  - `AUTH_DB_PATH` (for local sqlite file)
- GitHub App:
  - `GITHUB_APP_ID`
  - `GITHUB_APP_NAME`
  - `GITHUB_APP_PRIVATE_KEY` (full PEM contents)
  - `GITHUB_APP_CLIENT_ID`
  - `GITHUB_APP_CLIENT_SECRET`

Or run the setup helper to create the GitHub App and write these values for you:

```bash
pnpm setup
```

For headless/server installs (no local browser callback), use:

```bash
pnpm setup -- --mode manual
```

Wizard options:

```bash
pnpm setup -- --profile remote --mode manual
```

4. Start app:

```bash
pnpm dev
```

`pnpm dev` always runs `auth:migrate` first.

5. Optional: run migrations manually (for auth schema upgrades):

```bash
pnpm auth:migrate
```

## First-run flow

1. Sign in with GitHub.
2. First screen shows owner/org picker + repo picker.
3. If app is not installed for an owner/org, click `Install app for owner/org`.
4. After installation, click `Refresh owners`, then select repo and open it.
5. Use `Install app on another org/account` anytime to add more org access.

## GitHub App notes

1. OAuth callback URL should point to Better Auth callback:
   - `http://localhost:4000/api/auth/callback/github`
2. Install the app on the account/repo you want to edit.
3. Repo permissions should include:
   - Contents: Read and write
   - Metadata: Read-only
4. In GitHub App settings, keep `Request user authorization (OAuth) during installation` disabled.

## Target URL params

Selector is the home route (`/`).

Editor route is path-based: `/:owner/:repo/:branch`

Optional query:
- `root`
