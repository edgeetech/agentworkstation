# Agent Workstation

Local Career Agent workstation for evidence-backed profile audits.

## Release 0.1 scope

- Windows-first Electron + React + TypeScript desktop shell
- Clean Architecture modular monolith (`domain`, `application`, `infrastructure`, `apps/desktop`)
- Owned minimal `AgentRuntime` with tool loop and execution limits
- `WorkspaceGateway` security boundary for file access
- Local-only intelligence flow with:
  - deterministic Mock adapter
  - OpenAI-compatible local endpoint adapter (Ollama tested runtime)
- SQLite operational persistence foundation
- Architecture, unit, security, and integration test foundations

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
git checkout asozyurt-release-0-1-bootstrap
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
