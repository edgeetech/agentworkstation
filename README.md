# Agent Workstation

Local Career Agent workstation for evidence-backed profile audits.

## Current status

**Windows MVP implementation is in progress.** The Release 0.1-0.3
domain/application foundations are present, but real desktop integration and
end-to-end acceptance remain before the product can be called complete:

- Windows-first Electron + React + TypeScript desktop shell
- Clean Architecture modular monolith (`domain`, `application`, `infrastructure`, `apps/desktop`)
- `AgentRuntime` with tool loop, execution limits, and provenance-aware tracing
- `WorkspaceGateway` security boundary for file access
- Local-only intelligence flow with:
  - deterministic Mock adapter
  - OpenAI-compatible local endpoint adapter (Ollama tested runtime)
- Multi-workspace Career Audit application service with deterministic acceptance harness
- Safe-editing flow:
  - `filesystem.proposeWrite`
  - pending-approval lifecycle
  - stale-file protection
  - atomic file apply
  - approval/reject UI
- Architecture, unit, integration, security, and evaluation coverage

The current desktop screen is a deterministic demonstration surface. It is not
yet the complete interactive MVP: workspace registration/selection, arbitrary
chat through a configured local model, model-driven edit proposals, session
persistence, and real Electron E2E verification remain. See `WHATS_LEFT.md` for
the live implementation checklist and completion gate.

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
