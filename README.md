# PullNotes

Very simple Markdown editor for GitHub repos, built with:

- TanStack Start
- shadcn/ui
- Pages Editor component (`editor.pagescms.org`)
- Better Auth (GitHub login)
- GitHub App installation tokens (repo read/write)

## Content model

Markdown files are stored as:

```md
---
icon: 🚀
cover: https://images.unsplash.com/...
---

# My title

Body markdown
```

- `title`: first H1 in the document body.
- `icon`: optional frontmatter field.
- `cover`: optional frontmatter field.
- hierarchy: filesystem-only (folders).

Example:
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
  - `BETTER_AUTH_URL` (for local: `http://localhost:4000` by default)
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

4. Start app:

```bash
pnpm dev
```

`pnpm dev` always runs `auth:migrate` first.

5. Optional: run migrations manually (for auth schema upgrades):

```bash
pnpm auth:migrate
```

## App flow

1. Sign in with GitHub.
2. Home page is a repo selector (account + repo search).
3. Open a repo and branch via route: `/:owner/:repo/:branch` (optional `?root=...`).
4. Edit content in a Notion-like layout (sidebar tree + editor pane).

## Editor behavior

- Save button states:
  - check = clean
  - save icon = unsaved changes
  - spinner = saving
- Keyboard save: `Cmd+S` / `Ctrl+S`
- Title is required to save/create.
- `ArrowDown` in title focuses body editor.
- `ArrowUp` at start of body focuses title.
- Cover:
  - top, full-width image
  - currently validated to Unsplash URLs
- Icon:
  - emoji picker with search
  - sidebar and breadcrumb show emoji + title

## Loading / empty states

- Skeletons for repo and file loading.
- Empty state component when repo has no markdown entries.

## GitHub App notes

1. OAuth callback URL should be Better Auth callback:
   - `http://localhost:4000/api/auth/callback/github`
2. Install the app on the account/repo you want to edit.
3. Required permissions:
   - Contents: Read and write
   - Metadata: Read-only
