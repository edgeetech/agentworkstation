# Agent-First UX Implementation Status

Last updated: 2026-09-10

## Current status

The agent-window UX plan's original Definition of Done is implemented on `main`.
The current worktree extends it into a real multi-agent shell with Career Agent
and Blogger Agent, without introducing a second active-session authority.

## Completed

- Three-region desktop shell: workspace/session navigation, focused work area,
  and contextual inspector.
- Workspace-grouped persistent sessions with create, switch, rename, and delete.
- New Session Composer with visible Workspace, Agent, Intelligence preference,
  Permission policy, Isolation policy, prompt, and declarative Career Agent
  quick actions.
- Active session drives chat history, selected workspace, evidence, files,
  actions, privacy, execution mode, and resolved-intelligence presentation.
- Safe Files browsing and capped previews through `WorkspaceGateway`-backed IPC.
- Structured Evidence inspector with source-to-file navigation.
- Session-scoped PendingAction review, approval, and rejection through the
  existing application approval service.
- Truthful Privacy inspector separating Auto preference, resolved intelligence,
  Standard/Autopilot mode, and Cloud permitted/Local Only policy.
- Loading, empty, error, focus, keyboard, and minimum-window behavior.
- Regression coverage for session persistence/migration, declarative agents,
  safe Files IPC, workspace grouping, the full Career Agent desktop path, model
  visibility, context usage, policy visibility, evidence navigation, and human
  approval.
- Blogger-specific Publishing navigation with a persisted site target, explicit
  production branch, approved visual directories, and explicit LinkedIn client
  ID/API-version setup with honest connection state.
- Immutable bilingual publication bundles bind the primary article, translation,
  and visual assets to SHA-256 hashes before approval. Git delivery commits only
  the reviewed files, preserves unrelated staging, and verifies the public URL
  separately so deployment delay is retryable without a second push.

## Preserved regression constraints

- Career Agent chat, audit, profile proposal, and review changes.
- Existing workspaces, sessions, chat history, and SQLite migration behavior.
- Auto routing, Autopilot/Standard, resolved model display, and context usage.
- Intelligence Access provider/model metadata and Cloud permitted/Local Only.
- `WorkspaceGateway`, `PolicyGate`, `PendingAction`, `NetworkGateway`, credential
  vault, and intelligence abstraction boundaries.
- Human approval before application-owned writes.

## Deferred / what's left

These are not required by the current plan's Definition of Done or depend on
backend capabilities that do not exist yet:

- Drag-resizable side rails. Both rails are now collapsible and the shell adapts
  to compact desktop widths; pointer resizing remains a later enhancement.
- A detailed per-request network ledger. Privacy explicitly reports that this
  history is unavailable instead of inventing it.
- Telemetry controls or status. Telemetry is explicitly reported as not
  implemented.
- A LinkedIn Developer application and member consent are deployment setup, not
  bundled credentials. Native Authorization Code with PKCE, encrypted OS-backed
  token storage, OIDC member binding, exact-copy approval, and the versioned
  member Posts API adapter are implemented; no account or client ID is shipped.
- Editable permission/isolation policies in the composer. Current Release 0.1
  safely exposes the real fixed policies: Interactive and Read only.
- Session pinning, grouping customization, archive, multi-pane sessions, MCP UI,
  browser, terminal, plugin framework, and speculative routing/backend work.

## Completion boundary

This document records completion of the requested agent-window UX evolution,
not completion of deferred Release 0.2+ product architecture.

## Final verification

Test and check counts drift as the codebase grows; this section is a snapshot,
not a maintained ledger. For the current numbers, see the
[CI workflow](.github/workflows/ci.yml) and its
[latest run](https://github.com/edgeetech/agentworkstation/actions/workflows/ci.yml)
rather than the figures below.

- ESLint: passed with 0 warnings (including renderer TSX and React Hooks).
- Renderer and Electron TypeScript checks: passed.
- Architecture boundaries: 6/6 tests passed.
- Unit, integration, security, evaluation, and architecture suite: 294 tests
  passed across 54 files (last checked 2026-09-20).
- Electron renderer production build and Electron main/preload TypeScript build:
  passed.
- Playwright desktop regression suite: 7 tests across 2 spec files; the opt-in
  real Ollama acceptance test is skipped unless its environment flag is enabled.
- Windows NSIS package built and includes both Career and Blogger agent resources.
- Full dependency audit: 0 vulnerabilities.
