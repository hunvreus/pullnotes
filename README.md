# PullNotes

Minimal Notion-style Markdown editor for GitHub repositories.

## Stack

- TanStack Start
- shadcn/ui
- Pages CMS editor (`editor.pagescms.org`)
- Better Auth (GitHub OAuth)
- GitHub App (installation + repo access model)

## Data model

Each page is one Markdown file with:

- `title`: first `# H1` in document body (required)
- `body`: remaining Markdown content
- `icon`: optional frontmatter
- `cover`: optional frontmatter

Hierarchy is folder-based only:

- `setup.md` is parent
- `setup/step-1.md` is a child

Deleting a parent page cascades to all its children.

## Auth and GitHub model

PullNotes uses a hybrid model:

- GitHub App installation controls which repos are accessible.
- GitHub OAuth user token performs write/delete operations.

This keeps repo access scoped by App install, while commits are attributed to the signed-in user.

## Local setup

1. Install deps:

```bash
pnpm install
```

2. Run setup wizard:

```bash
pnpm setup
```

This creates/configures a GitHub App from a manifest and writes `.env`.

3. Start dev:

```bash
pnpm dev
```

`pnpm dev` runs auth migrations automatically before starting.

## Required env vars

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `AUTH_DB_PROVIDER` (`sqlite` or `d1`)
- `DB_PATH` (for sqlite)
- `DB_D1_BINDING` (for d1 runtime binding name)
- `GITHUB_APP_ID`
- `GITHUB_APP_NAME`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_CLIENT_SECRET`
- `PEXELS_API_KEY` (cover image search)

## GitHub App requirements

Callbacks:

- OAuth callback URL: `https://<your-domain>/api/auth/callback/github`
- Setup URL: `https://<your-domain>/api/github-app/callback`
- Redirect on update: enabled

Permissions:

- Repository: `Contents` = Read & write
- Repository: `Metadata` = Read-only
- Account: `Email addresses` = Read-only

Without `Email addresses: Read-only`, some users can hit `?error=email_not_found`.

## Routing

- Home selector: `/`
- Repo editor: `/:owner/:repo/:branch`
- Optional query params:
  - `file`: selected file path
  - `root`: optional subfolder root

## Editor behavior

- Save state icons:
  - clean: check
  - dirty: save
  - saving: loader
- Keyboard save: `Cmd+S` / `Ctrl+S`
- Sidebar shortcut `Cmd/Ctrl+B` is disabled
- Top content header is hidden when repo has no files
- Empty repos use shadcn `Empty` state
- Cover picker uses Pexels API
- Icon picker supports emoji search

## Deploy notes

- Build: `pnpm build` (or `npm run build`)
- Start: `npm start`
- Server must run on port `8000` in hosted environments

If using sqlite in production, ensure persistent disk. For serverless/ephemeral environments, prefer `AUTH_DB_PROVIDER=d1`.
