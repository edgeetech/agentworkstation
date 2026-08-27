# Agent Workstation: Complete MVP Handoff

Last updated: 2026-08-27
Current implementation commit: `cf12712` on `main`. Local verification,
including the real Ollama Electron path, is complete. GitHub Actions run
`33099497722` passed the Windows quality and macOS compatibility gates.
Current objective: **Windows MVP complete; preserve the acceptance boundary and
continue only with documented post-MVP work**

## Non-Negotiable Completion Boundary

Do not stop because a release milestone, service, test harness, commit, build,
or CI run is complete. Releases 0.1, 0.2, and 0.3 are checkpoints inside one
MVP objective.

Continue autonomously until a real user can complete this flow in Electron:

1. Launch the desktop application.
2. Select the built-in Career Agent.
3. Register and select real local workspaces.
4. Allow local intelligence (including compatible free Ollama models installed
   on the computer), connected cloud providers, or both.
5. Detect and connect supported delegated providers, beginning with existing
   Codex and GitHub Copilot CLI sign-ins.
6. Classify every prompt and choose an eligible model automatically. Never ask
   the user to select an execution mode, model, or provider per request, and
   never send context to cloud unless cloud providers are allowed.
7. Chat with arbitrary prompts and run a multi-workspace Career Audit.
8. Inspect the audit's real file/Git/memory source references.
9. Ask the agent for a concrete Markdown/profile update.
10. Inspect the exact proposed diff without changing the file.
11. Reject safely or approve and atomically apply the change.
12. Restart the app and recover workspace, session, message, pending-action,
    connection, and intelligence-permission state.

The MVP is complete only when that flow passes through the real desktop boundary
with both deterministic/mock coverage and a documented local-model run. Update
this file after every completed capability or newly discovered blocker.

## Verified Current State

- The takeover started from synchronized `HEAD`/`origin/main` commit `235bd25`
  and preserved the full Copilot implementation before correcting and extending it.
- Local review verification of the resulting implementation passes: lint; 94 tests across
  26 files; 6 architecture tests; renderer/Electron builds; the visible mock
  Electron E2E; a real Ollama chat/audit/proposal run with `qwen2.5:3b`; and a
  production audit with 0 vulnerabilities.
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

## Windows MVP Completion Status

- ✅ The August 27 UX simplification is implemented in the current worktree.
  Users grant only `Local models`, `Ollama Cloud models`, and/or `Connected cloud providers`; the
  renderer no longer exposes Local only/Local first/Adaptive controls or model
  selectors. Compatible Ollama and authenticated provider candidates are chosen
  automatically.
- ✅ Adaptive routing now inspects the latest prompt as well as the workflow.
  Routine chat prefers allowed local intelligence; complex review, analysis,
  debugging, architecture, and planning prompts prefer an allowed cloud
  provider. Audit and Improve continue to prefer stronger eligible reasoning.
  Route records remain persisted internally; normal conversation UI shows only
  a compact per-response model label while keeping routing automatic.
- ✅ Career chat now uses the primary viewport in a ChatGPT-style layout. Saved
  chats, new-chat, rename, and confirmed delete actions live in the app sidebar.
  Enter sends and Shift+Enter composes multiline prompts.
- ✅ Each saved conversation persists a Standard or Autopilot behavior mode.
  Autopilot proceeds with safe routine assumptions and asks only for material
  decisions, while authorization boundaries and write approval remain mandatory.
- ✅ Every completed assistant turn shows the model actually selected by the
  automatic router; pending turns show a compact choosing-model state.
- ✅ Intelligence Access now summarizes available on-device models, Ollama Cloud
  models, and connected provider CLIs. A dedicated Intelligence Status page
  lists every discovered candidate with compatibility and current availability.
- ✅ Ollama cloud-tagged models (`-cloud` or `:cloud`) are classified as external even through the local
  daemon. An observed `HTTP 429` marks the candidate usage-limited for a bounded
  cooldown; prompt routing falls back to a fully local compatible model before
  trying another allowed cloud provider. Failed candidates and successful
  fallback health become visible when status is refreshed.
- ✅ Automatic on-device ordering is reliability-first: the smallest practical
  tool-capable model is tried before heavier compatible models. Connection
  checks also continue to the next allowed local candidate after a timeout.

- ✅ The complete Windows MVP acceptance flow is implemented. The hands-on gaps
  that reopened MVP—mock readiness, model discovery/capability gating, provider
  connections, adaptive routing, workspace-path discoverability, and final
  desktop interaction polish—are now closed.
- ✅ Ordinary chat now receives a trusted, bounded mapping of the registered
  workspace ID to its root path and structured role. A user can name a
  registered Windows path and the model can translate it to the exact ID needed
  by filesystem/Git tools; the gateway still rejects unknown IDs, absolute tool
  paths, traversal, and symlink escape.
- ✅ Chat shows the pending user turn plus an accessible in-conversation Career
  Agent thinking indicator. The Send message label stays stable and the button
  remains disabled until the response finishes.
- ✅ Saved conversations now live in a dedicated chat sidebar, with an actions
  menu for renaming or safely deleting a chat, instead of a control strip above
  the transcript. The chat workspace is viewport-bounded,
  the composer stays in place, and the transcript is the single visible primary
  scroll region.
- ✅ Provider failures remain in conversational context. Electron-wrapped HTTP
  errors are normalized, and quota failures such as `HTTP 429: you (asozyurt)
  have reached your session usage limit` render as an accessible Career Agent
  error response with the original prompt preserved; they no longer appear only
  as a detached global toast.
- ✅ Intelligence Access presents only permission boundaries. Model selection
  and execution policy are automatic; endpoint/discovery and detected-provider
  details remain collapsed. Workspace role remains structured because it controls
  audit evidence and Improve targeting; Project evidence is the safe default.
- ✅ Electron disables the native application menu, removing the redundant
  File/Edit/View/Window toolbar.
- ✅ Final regression verification passes: 94 tests across 26 files, 6
  architecture tests, renderer/Electron builds, mock Electron E2E (including
  conversation modes, Enter/Shift+Enter, model status, rename/delete, in-chat
  thinking, no native menu, and HTTP 429
  presentation), real `qwen2.5:3b` Electron E2E (including in-chat thinking
  state and disabled Send), and a production audit with 0 vulnerabilities. The
  environment-gated real Ollama Playwright case remains skipped by default.
- ✅ The desktop now has a neutral, agent-first shell with an agent library,
  Career Agent-scoped navigation, first-run readiness, and clear task flows.
- ✅ Local inference is the default; mock mode is an explicitly labelled demo.
- ✅ Mock mode no longer counts as real-model readiness and must be explicitly
  enabled for each app session. Ollama models are automatically discovered from
  the local `/api/tags` endpoint, capability-checked, and selected internally;
  technical endpoint details remain available under progressive disclosure.
- ⚠️ At `cc43794`, delegated provider connections and adaptive routing were not
  implemented; the runtime still selected one persisted OpenAI-compatible
  endpoint. The worktree status below supersedes that baseline.
- ✅ Provider connection implementation is complete in the current main
  increment: a provider-neutral delegated CLI registry covers Codex, GitHub
  Copilot, and Claude; the desktop detects installations/authentication, allows
  explicit provider selection, keeps credentials provider-managed, blocks
  delegated execution under `local_only`, disables provider-native tools, and
  displays why bounded context may leave the machine. Delegated inference has
  bounded, provider-appropriate timeouts and Codex ignores user configuration
  and rules so Agent Workstation remains the only tool boundary. Codex and Copilot
  non-interactive smoke calls succeeded. Claude is installed and reports an
  authenticated `claude.ai` session, but two isolated non-interactive smoke calls
  timed out after 60 seconds without output. The app now reports delegated
  timeouts cleanly and can fall back according to the selected policy; Claude
  inference remains an external CLI/account-specific verification gap, not a
  blocker for the Codex/Copilot provider MVP.
- ✅ Adaptive v2 is complete. Permission flags are the hard boundary: disabled
  local/cloud candidates cannot be invoked. Within those boundaries, routine
  chat prefers local while prompt complexity, Career Audit, and Improve prefer
  an eligible connected provider. Failover remains bounded. Provider, model,
  location, fallback state, and reason persist for diagnostics across restart.
  Only the selected model is exposed as compact response metadata, never as a
  per-prompt control or routing decision burden.
- ✅ The inherited Improve path now uses the same provider-neutral router as Chat
  and Career Audit; selecting a delegated provider no longer falls through to
  the local OpenAI-compatible adapter.
- ✅ Provider/Ollama fixes were pushed in `ee31a0a`; GitHub Actions run
  `33061294526` passed both the Windows quality gate (including Electron E2E and
  installer packaging) and the macOS compatibility gate.
- ✅ Ollama capability inspection now uses `/api/show`. Models without the
  `tools` capability are labelled and disabled for Career Agent, and stale
  incompatible selections fail with an actionable explanation. On this PC,
  `deepseek-coder:6.7b` reports completion only while `qwen2.5:3b` reports
  completion plus tools.
- ℹ️ Recommended model path for this PC (32 GB RAM, RTX 3070 Laptop 8 GB):
  install `qwen3:8b` as the primary local Career Agent model and keep
  `qwen2.5:3b` as the fast fallback. `qwen3:14b` exceeds the available VRAM
  before runtime overhead and is not the default recommendation. An Ollama
  subscription is optional for local models; cloud models can be added later as
  explicitly permitted delegated routes.
- ✅ Mock E2E uses visible controls for agent selection, setup, chat, audit,
  proposal review, restart recovery, and approval (only the native picker result
  is stubbed).
- ✅ Proposals are bound to the selected workspace/path, require a structured tool
  call, fail closed, and use an order-aware diff with duplicate/reorder coverage.
- ✅ A real Ollama UI acceptance test passes chat, audit, and structured proposal
  generation through the Electron boundary with `qwen2.5:3b`.
- ✅ GitHub Actions produced the Windows NSIS installer; the downloaded artifact
  was extracted and its packaged application passed a launch/SQLite IPC/Career
  Agent resource smoke test on this PC.
- ⚠️ macOS runtime/package validation remains explicitly out of MVP scope.

## Product/UX Recovery Plan — Must Complete Before MVP Acceptance

### A. Fix correctness and safety blockers first

Status: ✅ Completed. Installer artifact verification later succeeded through
the packaged application smoke described above.

- Remove the arbitrary model-response-to-full-file fallback.
- Stop overriding structured model proposals with a forced `README.md` body.
- Replace the line-membership pseudo-diff with a trustworthy order-aware unified
  diff implementation and regression tests for duplicates and reordered lines.
- Add a real packaging pipeline and load declarative agent resources from a
  packaged resource location rather than `process.cwd()`.

### B. Replace the flat page with a task-oriented product shell

Status: ✅ Completed, including the later agent-first navigation and restrained
near-monochrome palette requirement.

- Add first-run onboarding: explain the Career Agent, choose a profile source,
  add project repositories, configure/test Ollama, and show readiness.
- Use clear destinations: `Chat`, `Career Audit`, `Changes`, `Sources`, and
  `Settings`; keep administrative configuration out of the main task flow.
- Give the user one obvious primary action per state and use progressive
  disclosure for secondary/advanced settings.
- Add labelled fields, concise help text, busy/disabled states, success/error
  feedback, confirmation for destructive actions, and accessible focus behavior.
- Present source references as readable evidence cards rather than raw technical
  strings.

### C. Make real local intelligence the honest product path

Status: ✅ Completed and verified through the optional real-Ollama Playwright
acceptance test.

- Default the product journey to endpoint onboarding and a tested local model.
- Keep mock mode explicitly labelled `Demo mode — responses are simulated` and
  visually distinct from real inference.
- Always show the active endpoint/model in Chat and Career Audit.
- Add a `Test connection` action with actionable offline/model-not-found errors.
- Never count a mock response as proof of real chat or audit behavior.

### D. Make Career Audit an explicit workflow

Status: ✅ MVP path completed: audit is explicit, readiness-gated, rerunnable,
and rendered with its evidence list. Per-finding interactive drill-down remains
a post-MVP refinement.

- Do not auto-run an audit before setup is complete.
- Add a visible `Run Career Audit` action, prerequisite/readiness state, progress,
  cancellation, and rerun behavior after workspace/model changes.
- Structure results into findings and recommendations with evidence attached to
  each item.
- Allow `Propose change` from a selected recommendation and carry its target,
  rationale, and sources into the review screen.

### E. Strengthen desktop acceptance around the user experience

Status: ✅ Completed for functional acceptance and packaged installer smoke.

- Rewrite the Electron E2E so workspace registration, endpoint configuration,
  audit execution, chat, proposal review, reject, approve, and restart recovery
  happen through visible UI controls; use direct API calls only for fixture setup
  that a user could not perform.
- Add assertions for first-run guidance, active model/mode, readiness, loading,
  errors, source presentation, exact diff, and safe confirmation.
- Keep deterministic mock E2E, then run/document the same essential flow through
  Ollama without exposing mock output as product behavior.

## Execution Plan — Continue Through All Items

### 1. Repair and formalize the Electron boundary ✅ Completed

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

Status update (2026-08-27):
- privileged composition for audit/pending-action flows moved into Electron main
  process with `ipcMain.handle(...)`,
- preload replaced with typed `contextBridge.exposeInMainWorld` proxy using
  `ipcRenderer.invoke(...)`,
- IPC payload validation added via `apps/desktop/main/ipcContract.ts`,
- contract coverage added in `tests/unit/ipcContract.test.ts`.

### 2. Implement real workspace management ✅ Completed

- Add native directory selection and user-controlled workspace registration.
- List, select, and remove persisted workspaces; never auto-register the process
  working directory as product behavior.
- Clearly distinguish profile/CV source workspaces from project repositories, or
  add the smallest metadata needed for Career Audit to do so.
- Rebuild the gateway from persisted registrations after changes and verify
  security checks for every workspace-aware operation.

Completion evidence: register at least a profile repository and two project
repositories in the desktop, restart, and recover them deterministically.

Status update (2026-08-27):
- native directory picker is wired via main-process `dialog.showOpenDialog`,
- typed workspace IPC added (`pick/register/list/select/remove`),
- desktop workspace panel added (kinded workspace registration, list, selection,
  removal),
- persistence now stores workspace `kind` metadata and deterministic reselection
  after selected-workspace removal,
- auto-registration of `process.cwd()` was removed from product behavior.

Completion evidence (2026-08-27):
- validated by Playwright Electron E2E (`tests/e2e/windows-mvp.e2e.spec.ts`)
  with restart: recovers `profile` + 2 `project` workspaces and preserves
  selected workspace.

### 3. Add endpoint settings and real local chat ✅ Completed

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

Status update (2026-08-27):
- endpoint configuration API is now implemented in the main process and persisted
  in SQLite (`mode`, `baseUrl`, `modelId`),
- renderer has endpoint settings controls plus arbitrary chat input/history,
- chat requests now cross the typed IPC boundary into main-process runtime
  composition and return visible assistant output + source references,
- mock and local modes are wired through a shared contract.

Status update (2026-08-27, live local check):
- pulled tool-capable Ollama model `qwen2.5:3b`,
- validated local-mode desktop chat through IPC/runtime,
- validated proposal creation + approval path in local mode with persisted
  endpoint/workspace configuration.
- local mode is now the unconfigured default, demo mode is visibly labelled,
  and Model Settings includes a real connection test action.

### 4. Persist sessions and messages ✅ Completed

- Add SQLite migrations and application ports/services for sessions and ordered
  messages, including tool-call/result metadata needed to restore a conversation.
- Create/select sessions in the UI and restore them after app restart.
- Keep curated career memory separate from conversation history.
- Enforce context budgeting when rebuilding a request from persisted history.

Completion evidence: restart Electron and resume the same conversation without
losing workspace selection, messages, sources, or pending actions.

Status update (2026-08-27):
- SQLite chat session and ordered message persistence is implemented
  (`chat_sessions`, `chat_messages`),
- endpoint settings persistence is implemented (`app_settings`),
- desktop UI can create/select chat sessions and reload history through IPC,
- main-process chat path now rebuilds request context from persisted messages.

Completion evidence (2026-08-27):
- validated by restart-aware Playwright E2E: selected chat session + persisted
  history are recovered after relaunch before approving a pending action.

### 5. Run the real multi-workspace Career Audit ✅ Completed

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

Status update (2026-08-27):
- `getDemoAudit` no longer returns the static deterministic scenario,
- desktop audit now executes the real `CareerAuditService` path in the
  main-process composition root with registered tools and selected endpoint
  config, and returns runtime source references to the renderer.

Completion evidence (2026-08-27):
- mock Playwright E2E executes the explicit visible audit flow after setup,
- real Ollama Playwright acceptance executes non-mock audit through Electron
  using `qwen2.5:3b`.

### 6. Connect model-driven proposals to safe editing ✅ Completed

- Let the agent create `filesystem.proposeWrite` actions from a selected audit
  recommendation; remove the hard-coded README body.
- Bind each pending action to its workspace as persisted data so approval cannot
  accidentally execute against whichever workspace is currently selected.
- Show target workspace/path, exact diff, sources/reason, and stale state.
- Keep approval explicit; verify reject, approve, duplicate execution, stale
  content, and restart recovery.

Completion evidence: request a profile update, inspect its diff, reject one
proposal, then approve another and verify the intended file changed atomically.

Status update (2026-08-27):
- proposal flow now executes through runtime/tool-calling with
  `filesystem.proposeWrite` (mock path deterministically emits the tool call,
  local path uses the OpenAI-compatible adapter),
- hard-coded one-click README write body was removed from the product path;
  the user chooses the target workspace/path and the model must return a valid
  structured proposal for that exact target,
- free-form model output now fails closed instead of becoming replacement file
  content, and the LCS-based diff preserves ordering and duplicate lines,
- pending actions continue to show exact diffs and approve/reject controls.

Completion evidence (2026-08-27):
- restart path verified in Electron E2E (proposal created pre-restart,
  recovered post-restart, approved and applied atomically),
- stale/duplicate execution behaviors remain covered by unit/evaluation suites
  (`tests/unit/approvals.test.ts`, `tests/evaluation/safeEditing.acceptance.test.ts`).

### 7. Add real desktop acceptance coverage ✅ Completed

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

Status update (2026-08-27):
- Windows Electron critical-path E2E now uses visible UI controls and passes,
  including first-run setup, agent selection, restart recovery, diff review, and
  approved atomic write. Only the native directory dialog response is stubbed.
- Optional `tests/e2e/ollama.acceptance.e2e.spec.ts` passes model connection,
  non-mock chat, audit, and structured proposal generation with `qwen2.5:3b`.
- lint, architecture, 85-test Vitest suite, renderer/Electron compile, mock E2E,
  Ollama acceptance, and production audit pass locally.
- `electron:pack` now invokes `electron-builder`, includes Career Agent files via
  `extraResources`, and no longer depends on `process.cwd()` when packaged.
- GitHub Actions successfully built the NSIS executable and blockmap; its first
  attempt then failed because electron-builder implicitly tried to publish
  without a GitHub token. `electron:pack` now passes `--publish never`, leaving
  publication to the explicit artifact-upload step.
- Corrected CI run `33056427909` passed Windows and macOS gates and uploaded
  `agent-workstation-windows-installer` (113,639,760-byte artifact archive).
- Downloaded `Agent-Workstation-0.1.0-Setup.exe` is 113,640,646 bytes with SHA-256
  `1E2FBE37B8401166A985B9516FC8AF28395677FB0AD09A093A5789CE4AAA0F93`.
- Extracted installer contents include `resources/agents/career/agent.yaml`; the
  packaged executable launched and completed SQLite IPC plus Career Agent chat.
- Local `electron:pack` still hits an environment-specific `EPERM` during the
  extraction rename, but the clean CI packaging and downloaded artifact smoke
  test are authoritative and passing.

## Out of MVP Scope

- Manual macOS package/runtime validation (Release 0.4 compatibility release).
- Raw long-lived SaaS API-key storage. Prefer delegated CLI/app-server/ACP
  connections that reuse provider-managed sign-in and operating-system credential
  storage. Any future raw-key path requires an encrypted credential store.
- MCP/ACP and plugin ecosystem work.
- Browser/computer use, dynamic benchmarking, scheduling, and RAG. Minimal model
  discovery, provider connections, capability metadata, and policy-visible
  adaptive routing are now inside the MVP boundary.

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
