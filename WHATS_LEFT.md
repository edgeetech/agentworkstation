# Agent Workstation: What's Left

Last updated: 2026-08-27  
Current target: **Windows MVP complete (Release 0.1 + 0.2 + 0.3)**

## Completed (Windows MVP)

- Release 0.1 foundation completed and merged (desktop shell, runtime, workspace security boundary, SQLite persistence, local model adapter path, test foundation).
- Release 0.2 completed:
  - multi-workspace Career Audit workflow,
  - bounded `git.status` and `git.diff` with provenance,
  - deterministic context budgeting,
  - source references surfaced to desktop UI,
  - deterministic Career Audit acceptance evaluation.
- Release 0.3 completed:
  - `filesystem.proposeWrite` proposal flow,
  - `PendingAction` lifecycle (`PROPOSED`, `APPROVED`, `EXECUTED`, `REJECTED`, `STALE`),
  - stale-file hash protection before apply,
  - atomic write execution,
  - desktop approval/reject controls,
  - safe-editing acceptance evaluation.
- Full quality gates pass locally on Windows:
  - lint,
  - architecture checks,
  - full test suite,
  - renderer build,
  - Electron main compile,
  - electron pack build,
  - production dependency audit.

## Explicitly Skipped / Deferred (per product-owner direction)

- **macOS compatibility release tasks are deferred** for now:
  - explicit macOS desktop package run,
  - manual runtime verification on macOS host.
- Note: CI now includes and passes a macOS compatibility gate (unit/integration/security checks, architecture, renderer build, Electron main compile), but manual host validation remains intentionally deferred.

## Future (not part of current Windows MVP finish)

- SaaS providers and encrypted credential storage.
- MCP/ACP and plugin ecosystem.
- Browser/computer use, adaptive routing, model management, RAG.

## Resume Notes

- Repository: `C:\Workspace\EDGEETECH\ai\agentworkstation`
- Plan source: `PROJECT_PLAN.md`
- Current state is intentionally Windows-MVP complete with macOS-specific manual validation deferred by request.
