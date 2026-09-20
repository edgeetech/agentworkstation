# What's Left

Last updated: 2026-09-20. This file is a short, current punch list, not a
changelog — history lives in `git log`, not here.

## CI is currently red (Windows quality gate)

`tests/e2e/windows-mvp.e2e.spec.ts` asserts that "Allow connected cloud
providers" becomes clickable and that "Cognition Devin" appears as a detected
provider. Both require at least one delegated CLI (Codex/Copilot/Claude/Devin)
to be installed and on `PATH`, which is true on a developer machine but never
true on a clean `windows-latest` GitHub-hosted runner — CI installs no CLI.
This has been broken since `bd173f6` (Blogger Agent commit) and was masked by
an unrelated `npm ci` failure (fixed 2026-09-20) until now. Fixing it requires
either a CI-installed stub CLI or a test-mode provider-detection override, and
verifying the fix means launching Electron, which this pass didn't do. All
other CI steps (lint, typecheck, unit/integration/security tests, architecture
boundaries, renderer/Electron build, dependency audit) are green.

## Known gaps (honest, not blocking personal use)

- **Blogger publication bundle** — the bilingual draft → visual → publication
  bundle → Git delivery path is implemented and unit/evaluation-tested but has
  never been exercised end to end against a real target site.
- **LinkedIn posting** — Authorization Code + PKCE, OS-backed credential
  storage, and the Posts API adapter are implemented, but no LinkedIn
  Developer application or client ID ships with the app. Each user must
  register their own.
- **Copilot Agent SDK adapter** — `src/infrastructure/intelligence/copilotAgentSdkAdapter.ts`
  is implemented and unit-tested but not wired into the app. The installed
  `copilot` CLI reports an older JSON-RPC protocol version than the SDK
  expects ("SDK supports versions 3-3, but server reports version 2"). The
  Copilot provider currently runs through the plain CLI adapter instead.
  `@github/copilot-sdk` lives in `devDependencies` so it does not ship in the
  installer.
- **Windows installer** — ~118 MB, unsigned, no auto-update. Built via
  `npm run electron:pack`; users must click through the unsigned-publisher
  warning.
- **macOS** — CI only builds the renderer/Electron main process on macOS; there
  is no packaged macOS installer or manual runtime validation.
- **No drag-resizable side rails, per-request network ledger, or telemetry** —
  intentionally not implemented; the Privacy inspector reports this plainly
  instead of inventing data.

## Not planned for this project

Terminal, browser, MCP management UI, plugin marketplace, worktree engine,
billing system, or a SaaS routing service.

## Resume instructions for any agent

- Read `PROJECT_PLAN.md` and `AGENTS.md` first.
- Check `.github/workflows/ci.yml`'s latest run for the actual test/build
  status; do not trust stale counts in prose docs.
- Run `npm test`, `npm run lint`, and `npm run typecheck` before pushing.
- Keep architecture boundaries (`tests/architecture/boundaries.test.ts`) green:
  `src/domain` and `src/application` must stay free of Node/Electron/provider
  SDK imports.
