# Collaboration Plan (Realtime Editing)

## Goal

Enable multiple users to edit the same markdown document simultaneously with realtime cursors, while keeping GitHub as the long-term source of history.

## Scope For V1 Collaboration

- Shared text editing in one document.
- Realtime cursors/presence (name + cursor/selection).
- Session awareness (who is online).
- Save/publish from current shared state into one GitHub commit.

## Non-Goals For V1

- Comments/threads.
- Granular permissions beyond existing GitHub auth model.
- Branch-level merge UI for concurrent commits.
- Media manager or plugin system.

## Architecture Recommendation

- Editor sync model: CRDT (Yjs).
- Realtime transport/provider: managed websocket provider (for speed to ship).
- GitHub persistence:
  - Load file content from GitHub (with local cache as fast path).
  - Start collaborative session from that content.
  - Persist to GitHub on explicit save/publish or periodic checkpoint.

## Data Flow

1. User opens document.
2. Client loads cached content instantly (if valid), then revalidates with GitHub.
3. Collaboration layer initializes Yjs doc from latest canonical markdown.
4. Users edit concurrently; provider syncs CRDT updates.
5. On save/publish, app serializes current CRDT state to markdown and writes one GitHub commit.
6. File list/sha is refreshed after commit.

## Conflict Semantics

- In-session concurrent typing conflicts are resolved by CRDT convergence.
- GitHub-level conflicts are handled at save time using file `sha` checks.
- If upstream `sha` changed outside session, prompt for rebase/reload workflow before next commit.

## Commit Policy

- Default: single app-generated commit per save/publish action.
- Commit message format:
  - `chore(pullnotes): update <path> (collab)`
- Optional metadata:
  - include session participants in commit message body.
- Avoid per-keystroke commits to keep history readable.

## Security + Access

- Reuse existing GitHub sign-in/session checks.
- Authorize collaboration room access using repo/path membership checks.
- Do not trust client-only room IDs; verify on server before issuing realtime tokens.

## Incremental Rollout

1. Behind feature flag:
  - Hidden toggle for collaborative mode per file.
2. Internal alpha:
  - Cursor sync + shared text for small team only.
3. Beta:
  - Save/publish stability, reconnect behavior, and presence polish.
4. GA:
  - Enable by default for supported repos.

## Technical TODO

- [ ] Pick provider and implement room auth endpoint.
- [ ] Add Yjs binding to existing editor component.
- [ ] Add awareness UI for cursor/presence.
- [ ] Define save/publish checkpoint intervals and UX.
- [ ] Add recovery flow when GitHub `sha` diverges.
- [ ] Add telemetry for session join latency, sync lag, and save conflicts.
- [ ] Add e2e tests for two-user concurrent edit + publish.
