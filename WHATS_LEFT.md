# Agent Workstation: Complete MVP Handoff

Last updated: 2026-08-27
Repository state audited at: `345c04f` on `main`
Current objective: **complete the Windows MVP end to end**

## Non-Negotiable Completion Boundary

Do not stop because a release milestone, service, test harness, commit, build,
or CI run is complete. Releases 0.1, 0.2, and 0.3 are checkpoints inside one
MVP objective.

Continue autonomously until a real user can complete this flow in Electron:

1. Launch the desktop application.
2. Select the built-in Career Agent.
3. Register and select real local workspaces.
4. Configure and use a local OpenAI-compatible model endpoint (Ollama reference).
5. Chat with arbitrary prompts and run a multi-workspace Career Audit.
6. Inspect the audit's real file/Git/memory source references.
7. Ask the agent for a concrete Markdown/profile update.
8. Inspect the exact proposed diff without changing the file.
9. Reject safely or approve and atomically apply the change.
10. Restart the app and recover workspace, session, message, and pending-action state.

The MVP is complete only when that flow passes through the real desktop boundary
with both deterministic/mock coverage and a documented local-model run. Update
this file after every completed capability or newly discovered blocker.

## Verified Current State

- Worktree is clean and synchronized with `origin/main` at `345c04f`.
- GitHub CI passes at `345c04f`: <https://github.com/edgeetech/agentworkstation/actions/runs/33021863046>.
- No pull request is open.
- Releases 0.1-0.3 have substantial foundations:
  - secure `WorkspaceGateway` and bounded filesystem/Git tools,
  - local model adapter and agent runtime,
  - SQLite workspace and pending-action persistence,
  - bounded career memory and context composition,
  - multi-workspace Career Audit service with trace collection,
  - safe proposal/approval lifecycle with stale-hash protection and atomic writes,
  - deterministic evaluation harnesses,
  - renderer views for audit output, sources, diffs, approve, and reject,
  - Windows and macOS automated CI compatibility gates.

## Why the MVP Is Not Complete Yet

- The preload exposes APIs by assigning `window.agentWorkstation` directly even
  though Electron uses `contextIsolation: true`; it does not use
  `contextBridge.exposeInMainWorld`, and there is no real IPC application host.
- The desktop calls `buildDeterministicCareerAuditScenario()` rather than the
  real Career Agent, `AgentRuntime`, tools, and local endpoint adapter.
- No workspace management UI exists. The preload silently registers
  `process.cwd()` as `agentworkstation`; users cannot add, remove, inspect, or
  select their own profile/project workspaces.
- No Career Agent selector or arbitrary chat input/history UI exists.
- No endpoint settings, connection test, model selection, or Ollama-backed
  desktop execution path exists.
- The "Propose README update" action uses hard-coded target content rather than
  a proposal produced from the audit/chat result.
- SQLite does not persist sessions or messages, despite this being an explicit
  MVP success criterion.
- Existing acceptance tests exercise application services in Vitest; they do
  not drive the packaged/dev Electron UI. Playwright scripts exist in
  `package.json`, but there is no real Windows critical-path E2E suite.
- The declarative career memory files still contain placeholder text and no UI
  exists to configure or edit the user's actual profile facts.
- A real local Ollama acceptance run is claimed as available but is not wired or
  documented as an end-to-end desktop result.

## Execution Plan — Continue Through All Items

### 1. Repair and formalize the Electron boundary

- Move application composition and privileged filesystem/database/model work to
  the Electron main process.
- Expose a typed, minimal preload API with `contextBridge.exposeInMainWorld`.
- Add explicit IPC handlers and payload validation for workspace, session, chat,
  audit, proposal, approval, and rejection operations.
- Preserve `contextIsolation`, sandboxing, CSP, navigation restrictions, and the
  local-only network policy.
- Add bridge/IPC contract and security tests.

Completion evidence: renderer receives the API under isolation; privileged Node
capabilities are not executed in the renderer/preload world.

### 2. Implement real workspace management

- Add native directory selection and user-controlled workspace registration.
- List, select, and remove persisted workspaces; never auto-register the process
  working directory as product behavior.
- Clearly distinguish profile/CV source workspaces from project repositories, or
  add the smallest metadata needed for Career Audit to do so.
- Rebuild the gateway from persisted registrations after changes and verify
  security checks for every workspace-aware operation.

Completion evidence: register at least a profile repository and two project
repositories in the desktop, restart, and recover them deterministically.

### 3. Add endpoint settings and real local chat

- Persist a local OpenAI-compatible endpoint configuration (base URL, model ID,
  optional non-secret display metadata).
- Add connection/model validation and actionable offline/error states.
- Wire `CareerAgentLoader`, `ContextBuilder`, `AgentRuntime`, `ToolRegistry`,
  `LocalOnlyStrategy`, `DefaultNetworkGateway`, and
  `OpenAICompatibleLocalAdapter` in the main-process composition root.
- Add arbitrary chat input, cancellation, busy/error state, and conversation
  display with the Career Agent visibly selected.
- Keep the deterministic mock endpoint selectable for tests and offline demos.

Completion evidence: a desktop prompt reaches mock and Ollama paths through the
same application contract and returns a visible response.

### 4. Persist sessions and messages

- Add SQLite migrations and application ports/services for sessions and ordered
  messages, including tool-call/result metadata needed to restore a conversation.
- Create/select sessions in the UI and restore them after app restart.
- Keep curated career memory separate from conversation history.
- Enforce context budgeting when rebuilding a request from persisted history.

Completion evidence: restart Electron and resume the same conversation without
losing workspace selection, messages, sources, or pending actions.

### 5. Run the real multi-workspace Career Audit

- Replace `getDemoAudit()` with an operation that runs `CareerAuditService`
  against registered workspaces and the selected endpoint.
- Populate or configure real career memory/profile sources; remove placeholder
  memory from the product acceptance path.
- Support the plan's three representative questions and render the required
  audit sections.
- Render source references with enough workspace/path/commit detail for a user
  to verify each important finding.

Completion evidence: the desktop compares actual recent project activity with
the current professional profile and identifies evidence-backed gaps.

### 6. Connect model-driven proposals to safe editing

- Let the agent create `filesystem.proposeWrite` actions from a selected audit
  recommendation; remove the hard-coded README body.
- Bind each pending action to its workspace as persisted data so approval cannot
  accidentally execute against whichever workspace is currently selected.
- Show target workspace/path, exact diff, sources/reason, and stale state.
- Keep approval explicit; verify reject, approve, duplicate execution, stale
  content, and restart recovery.

Completion evidence: request a profile update, inspect its diff, reject one
proposal, then approve another and verify the intended file changed atomically.

### 7. Add real desktop acceptance coverage

- Add Playwright Electron E2E for the complete Windows critical path using the
  deterministic mock endpoint.
- Add contract coverage for both mock and OpenAI-compatible adapters.
- Perform and document a real Ollama desktop run for repository evidence,
  Career Audit, and proposal generation.
- Run lint, full tests, architecture checks, security tests, renderer build,
  Electron compile/package, and production dependency audit.
- Keep Windows as the MVP runtime gate. macOS automated compatibility may remain;
  manual macOS packaging/runtime validation is Release 0.4 post-MVP work.

Completion evidence: automated Windows critical-path E2E passes, local Ollama
evidence is documented, all CI gates are green, and no acceptance item above is
represented only by a static demo or hard-coded response.

## Out of MVP Scope

- Manual macOS package/runtime validation (Release 0.4 compatibility release).
- SaaS providers and encrypted SaaS credential workflows.
- MCP/ACP and plugin ecosystem work.
- Browser/computer use, adaptive routing, model management, scheduling, and RAG.

## Resume Instructions for Any Agent

- Start by reading `PROJECT_PLAN.md`, this file, and `AGENTS.md`.
- Inspect `git status --porcelain=v2 --branch` before edits and preserve all user
  changes.
- Work on the first unfinished execution-plan item; commit and push bounded
  changes only after verification.
- After each capability, update this file, then continue to the next item. Do not
  stop merely to report a milestone.
- Do not use the `ui-quality-check` skill; it belongs to another workspace.
- If quota or an external/manual dependency prevents continuation, leave the
  exact failing command, error, current commit, and next safe action here.
