# PullNotes

Minimal Notion-style Markdown editor for GitHub repositories.

## Install (local)

1. Install dependencies:

```bash
pnpm install
```

2. Run setup:

```bash
pnpm setup
```

This configures the GitHub App and writes your local `.env`.

3. Start development:

```bash
pnpm dev
```

## Environment variables

Set these variables in your deployment environment (and local `.env` when needed):

| Variable | Required | Description |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Yes | Better Auth signing secret. |
| `BETTER_AUTH_URL` | Yes | Public base URL of your app (for auth callbacks). |
| `AUTH_DB_PROVIDER` | Yes | Auth DB provider: `sqlite` or `d1`. |
| `DB_PATH` | If `AUTH_DB_PROVIDER=sqlite` | SQLite file path. |
| `DB_D1_BINDING` | If `AUTH_DB_PROVIDER=d1` | D1 binding name. |
| `GITHUB_APP_ID` | Yes | GitHub App ID. |
| `GITHUB_APP_NAME` | Yes | GitHub App name. |
| `GITHUB_APP_PRIVATE_KEY` | Yes | GitHub App private key (PEM). |
| `GITHUB_APP_CLIENT_ID` | Yes | GitHub App OAuth client ID. |
| `GITHUB_APP_CLIENT_SECRET` | Yes | GitHub App OAuth client secret. |
| `PEXELS_API_KEY` | Optional | Enables cover image search in Pexels. |

## GitHub App settings

Configure your GitHub App with:

- OAuth callback URL: `https://<your-domain>/api/auth/callback/github`
- Setup URL: `https://<your-domain>/api/github-app/callback`
- Redirect on update: enabled

Permissions:

- Repository permissions:
  - `Contents`: Read and write
  - `Metadata`: Read-only
- Account permissions:
  - `Email addresses`: Read-only

## Deploy

1. Set environment variables (see table above).
2. Install dependencies:

```bash
pnpm install --frozen-lockfile
```

3. Build:

```bash
pnpm build
```

4. Start:

```bash
pnpm start
```

`pnpm start` runs auth migrations and starts the server.
