# Agent Rules For This Repo

Last updated: 2026-02-20

## Core Constraints

1. Always prefer the latest stable setup from official docs before installing or scaffolding.
2. Prefer `pnpm` for all package management and CLIs to avoid local permission friction.
3. Keep UI and styling minimal: use default `shadcn/ui` components and stock Tailwind utilities.
4. Avoid custom design systems, heavy abstractions, and non-essential dependencies.
5. Build only what is required for the current MVP (`Title + Body` markdown editing in a GitHub repo).

## Verify Before Scaffolding

1. TanStack Start official quick start: https://tanstack.com/start/latest/docs/framework/react/quick-start
2. shadcn/ui install docs (and TanStack Start page): https://ui.shadcn.com/docs/installation and https://ui.shadcn.com/docs/installation/tanstack
3. Tailwind CSS current install path (v4): https://tailwindcss.com/docs/installation
4. Pages CMS editor integration: https://editor.pagescms.org/

## MVP Guardrails

1. Data model is fixed: markdown frontmatter `title` + markdown `body`.
2. Hierarchy comes from folders only; no custom parent/child metadata.
3. Auth and repo access should start with one GitHub flow and one target repo/path config.
4. No plugin system, no schema builder, no media manager, no role system in v1.
