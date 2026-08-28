# Agent-First UX Implementation Status

Last updated: 2026-08-28

## Current status

The agent-window UX plan's Definition of Done is implemented on `main`.
The existing Career Agent vertical slice remains the product focus; the shell
now supports many workspace-bound persistent sessions without introducing a
second active-session authority.

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

- Resizable/collapsible side rails. The current shell uses tested fixed desktop
  widths and an enforced minimum window size.
- A detailed per-request network ledger. Privacy explicitly reports that this
  history is unavailable instead of inventing it.
- Telemetry controls or status. Telemetry is explicitly reported as not
  implemented.
- Additional agent definitions and their specialized views. The shell and
  declarative quick-action contract are ready for them; only Career Agent is
  currently implemented.
- Editable permission/isolation policies in the composer. Current Release 0.1
  safely exposes the real fixed policies: Interactive and Read only.
- Session pinning, grouping customization, archive, multi-pane sessions, MCP UI,
  browser, terminal, plugin framework, and speculative routing/backend work.

## Completion boundary

This document records completion of the requested agent-window UX evolution,
not completion of deferred Release 0.2+ product architecture.
