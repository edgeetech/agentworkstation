# Agent Workstation

Local Career Agent workstation for evidence-backed profile audits.

## Current status

**The Windows MVP is complete.** The Electron product and its real desktop
acceptance path include:

- Windows-first Electron + React + TypeScript desktop shell
- Clean Architecture modular monolith (`domain`, `application`, `infrastructure`, `apps/desktop`)
- `AgentRuntime` with tool loop, execution limits, and provenance-aware tracing
- `WorkspaceGateway` security boundary for file access
- Permission-bounded, prompt-aware intelligence routing with:
  - deterministic Mock adapter
  - OpenAI-compatible local endpoint adapter (Ollama tested runtime)
  - detected Codex, GitHub Copilot, and Claude CLI connections
  - automatic candidate selection after the user allows local models, connected
    cloud providers, or both
  - distinct on-device Ollama and Ollama Cloud permissions, model availability
    status, and automatic `429` fallback with cooldown
- Multi-workspace Career Audit application service with deterministic acceptance harness
- Safe-editing flow:
  - `filesystem.proposeWrite`
  - pending-approval lifecycle
  - stale-file protection
  - atomic file apply
  - approval/reject UI
- Architecture, unit, integration, security, and evaluation coverage

The desktop provides workspace registration, arbitrary Career Agent chat,
evidence-backed audit, structured edit proposals, explicit approval, persisted
conversations, and restart recovery. Chat uses a full-height conversation view
with session management in the main sidebar; users never choose execution modes
or per-request models. See `WHATS_LEFT.md` for verified evidence and deferred
post-MVP work.

macOS-specific manual runtime/package validation is intentionally deferred for now.

## Prerequisites

- Node.js 20+ (Node.js 22 recommended)
- npm 10+
- Git
- Windows 11 target environment for MVP runtime
- (Optional for local model run) Ollama installed and running locally

## Quick start

```powershell
git clone https://github.com/edgeetech/agentworkstation.git
cd agentworkstation
npm install
```

## Run in browser (renderer dev)

```powershell
npm run dev
```

Open: `http://localhost:5173`

## Run Electron desktop app (dev)

```powershell
npm run electron:dev
```

This starts Vite and Electron together.

## Run Electron desktop app (main process only)

```powershell
npm run electron:start
```

Use this when the Vite dev server is already running.

## Build

```powershell
npm run build
npm run electron:build-main
```

Or run:

```powershell
npm run electron:pack
```

## Test

```powershell
npm test
```

Architecture-only checks:

```powershell
npm run check:architecture
```

## Project structure

```text
apps/desktop/           Electron host + renderer UI
src/domain/             Domain models and contracts
src/application/        Use-case/runtime orchestration
src/infrastructure/     Adapters (filesystem, git, intelligence, persistence)
src/agents/career/      Declarative Career Agent config/workflows/memory
tests/                  architecture, unit, integration, security, evaluation
docs/adr/               Architecture Decision Records
```
