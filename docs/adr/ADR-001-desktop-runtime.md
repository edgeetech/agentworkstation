# ADR-001 Desktop Runtime

**Date:** 2026-08-25  
**Status:** Accepted  

## Context

Agent Workstation needs a desktop shell for Windows-first delivery with a clear path to macOS. The shell must integrate with the Node.js backend used by the application layer (SQLite, filesystem, child_process for Git).

## Decision

Use Electron + React + TypeScript.

## Alternatives Considered

- **Tauri (Rust backend):** would be faster/lighter but requires Rust toolchain and adds FFI complexity for Node.js infrastructure code.
- **NW.js:** less mature, smaller community than Electron.

## Consequences

- Electron's Node.js main process hosts Application/Infrastructure layers directly.
- Renderer is sandboxed (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`).
- macOS support requires no architectural changes, only a separate CI packaging step.
- Binary size is larger than Tauri but tooling is familiar.

## Verification

- `npm run electron:build-main` compiles without error.
- `npm run electron:start` opens the window.
- CSP and navigation restrictions tested in `tests/security/electron.security.test.ts`.

