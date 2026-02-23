# GitNote MVP Plan (Very Simple)

Last reviewed: 2026-02-20

## Goal

Build a minimal web app to edit Markdown files in a GitHub repo with:

1. Left pane: entries tree (folders/files)
2. Right pane: `Title` + `Body` editor
3. Save to GitHub commits

No extra field types, no schema complexity.

## Product Rules

1. Every entry is one `.md` file.
2. Data shape is always:

```md
---
title: My title
---

Body markdown...
```

3. Hierarchy is filesystem-only.
4. Parent/child convention:
   - Parent: `setup.md`
   - Children: `setup/*.md` (example: `setup/step-1.md`)
5. No separate relation table or custom IDs.

## UX Scope (Notion-like, minimal)

1. Two-column layout:
   - Left: collapsible repo tree + search + New Page
   - Right: Title input + markdown editor + Save button
2. "New Subpage" is just creating a file inside the selected folder (or selected page stem folder).
3. Keep default shadcn styling; no custom visual system in v1.

## Tech Scope

1. TanStack Start (latest stable setup from official docs)
2. Tailwind CSS v4
3. shadcn/ui (latest, TanStack Start install path)
4. `editor.pagescms.org` as the markdown editing surface
5. GitHub API for list/read/write/commit

## Implementation Plan

1. Scaffold app
   - Create TanStack Start app with `pnpm`.
   - Install Tailwind v4 exactly via current docs.
   - Install shadcn/ui via TanStack-specific instructions.
2. Create app shell
   - Build split layout and route.
   - Add left tree and right editor panels.
3. GitHub integration (single-repo config first)
   - Inputs/env: owner, repo, branch, root path.
   - Server functions: list tree, get file, create/update file.
   - Commit writes via GitHub Contents API.
4. Markdown model
   - Parse frontmatter `title`; remainder is `body`.
   - Serialize on save in canonical format.
5. File tree behavior
   - Show folders/files.
   - Resolve child convention: `foo.md` + `foo/*.md`.
   - Add New Page and New Subpage actions.
6. MVP hardening
   - Loading/error states.
   - Basic validation (non-empty title, safe slug/path).
   - Simple unsaved changes guard.
7. QA pass
   - Manual test matrix for create/edit/nested pages/commit collisions.

## Simplifications To Keep

1. Single GitHub provider only.
2. Single content type only (`Title + Body`).
3. Single markdown extension only (`.md`).
4. Single branch target at runtime (configurable, but one active target).
5. No live preview panel in v1 unless editor gives it for free.

## Risks + Mitigations

1. Commit conflicts:
   - Use file `sha` precondition and show "remote changed, reload" message.
2. Path ambiguity (`setup.md` vs `setup/index.md`):
   - v1 rule: parent is `setup.md`; ignore `setup/index.md` or warn.
3. Token/auth complexity:
   - Start with one straightforward GitHub auth strategy; defer multi-account features.

## Self-Review: Simpler/Better/More Robust

1. Simpler:
   - Start read/write for one fixed path root and one branch, then generalize later.
2. Better:
   - Keep canonical file format stable to prevent noisy diffs.
3. More robust:
   - Guard saves with `sha`, handle 409-like conflict cases clearly.
4. Scope cut options if timeline is tight:
   - Skip search in v1.
   - Skip "New Subpage" button (users can create in current folder only).
   - Skip drag/drop ordering and any custom sort metadata.

## Definition Of Done (MVP)

1. Can browse nested markdown files from a GitHub repo path.
2. Can open any file and edit only `title` + `body`.
3. Can create new page and child page via folder placement.
4. Can save and produce a GitHub commit successfully.
5. UI remains intentionally minimal and easy to understand.
