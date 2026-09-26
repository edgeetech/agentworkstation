# What's Left

Last updated: 2026-09-26. This file is a short, current punch list, not a
changelog — history lives in `git log`, not here.

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
- **Windows installer** — ~118 MB, unsigned. Built via `npm run electron:pack`;
  users must click through the unsigned-publisher warning on first install.
  Installed copies then update themselves from GitHub Releases automatically
  (`electron-updater`, wired in `apps/desktop/main/main.ts`); a maintainer cuts
  a release with `npm version <x>` and `git push --follow-tags`.
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
