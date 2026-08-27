import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import type {
  ChatExchange,
  ChatSessionRecord,
  DemoAudit,
  EndpointConfig,
  PendingAction,
  LocalModel,
  ProviderConnection,
  WorkspaceRecord,
} from "../shared/api";
import "./styles.css";

type View =
  | "agents"
  | "home"
  | "chat"
  | "audit"
  | "changes"
  | "sources"
  | "settings";
type Busy =
  | "workspace"
  | "endpoint"
  | "chat"
  | "audit"
  | "proposal"
  | "approval"
  | null;
const careerNav: Array<{ id: View; label: string; hint: string }> = [
  { id: "home", label: "Overview", hint: "Readiness and next step" },
  { id: "chat", label: "Career chat", hint: "Explore your evidence" },
  { id: "audit", label: "Career audit", hint: "Find profile gaps" },
  { id: "changes", label: "Review changes", hint: "Approve safe edits" },
  { id: "sources", label: "Workspaces", hint: "Choose local evidence" },
];
const messageOf = (value: unknown): string =>
  value instanceof Error ? value.message : String(value);
const sourceLabel = (
  source: DemoAudit["result"]["sourceReferences"][number],
): string =>
  source.label ??
  source.relativePath ??
  source.commitSha ??
  source.workspaceId ??
  "Local evidence";

const policyLabel = (policy: EndpointConfig["routingPolicy"]): string => ({
  local_only: "Local only",
  local_first: "Local first",
  adaptive: "Adaptive",
}[policy ?? "local_only"]);

const RouteNote = ({ route }: { route?: ChatExchange["route"] }): JSX.Element | null => route ? (
  <div className="source-row route-note">
    <span>{route.location === "external" ? "Cloud route" : route.location === "simulated" ? "Simulation" : "Local route"}</span>
    <strong>{route.providerLabel} · {route.modelId}</strong>
    <small>{route.reason}</small>
  </div>
) : null;

function App(): JSX.Element {
  const api = window.agentWorkstation;
  const [view, setView] = useState<View>("home");
  const [audit, setAudit] = useState<DemoAudit | null>(null);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceKind, setWorkspaceKind] = useState<
    "profile" | "project" | "cv"
  >("project");
  const [endpoint, setEndpoint] = useState<EndpointConfig>({
    mode: "local",
    baseUrl: "http://localhost:11434",
    modelId: "llama3.1",
    routingPolicy: "local_only",
    configured: false,
  });
  const [history, setHistory] = useState<ChatExchange[]>([]);
  const [sessions, setSessions] = useState<ChatSessionRecord[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [pendingChatInput, setPendingChatInput] = useState<string | null>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const [sessionName, setSessionName] = useState("Career Agent Session");
  const [proposalWorkspace, setProposalWorkspace] = useState("");
  const [targetPath, setTargetPath] = useState("README.md");
  const [recommendation, setRecommendation] = useState(
    "Highlight the strongest recent project outcome with supporting evidence.",
  );
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [providerConnections, setProviderConnections] = useState<ProviderConnection[]>([]);
  const [modelDiscoveryBusy, setModelDiscoveryBusy] = useState(false);
  const [modelDiscoveryError, setModelDiscoveryError] = useState<string | null>(null);
  const [demoSessionEnabled, setDemoSessionEnabled] = useState(false);
  const selectedLocalModel = localModels.find((model) => model.id === endpoint.modelId);
  const localModelIncompatible = selectedLocalModel?.toolCalling === false;
  const localEndpointReady =
    endpoint.configured === true && endpoint.mode === "local" && !localModelIncompatible;
  const delegatedConnection = providerConnections.find((provider) => provider.id === endpoint.providerId);
  const routingNeedsProvider = endpoint.mode === "local" && endpoint.routingPolicy !== undefined && endpoint.routingPolicy !== "local_only";
  const routingProviderReady = delegatedConnection?.installed === true && delegatedConnection.authenticated !== false;
  const delegatedEndpointReady = endpoint.configured === true && endpoint.mode === "delegated" &&
    delegatedConnection?.installed === true && delegatedConnection.authenticated !== false;
  const realEndpointReady = (localEndpointReady && (!routingNeedsProvider || routingProviderReady)) || delegatedEndpointReady;
  const demoConfigured =
    endpoint.configured === true && endpoint.mode === "mock";
  const endpointReady = realEndpointReady || demoSessionEnabled;
  const workspaceReady = workspaces.length > 0;
  const ready = endpointReady && workspaceReady;
  const realReady = realEndpointReady && workspaceReady;
  const profileWorkspaces = useMemo(
    () => workspaces.filter((w) => w.kind !== "project"),
    [workspaces],
  );

  const task = async (
    name: Exclude<Busy, null>,
    work: () => Promise<void>,
  ): Promise<void> => {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (value) {
      setError(messageOf(value));
    } finally {
      setBusy(null);
    }
  };
  const chooseProposalWorkspace = (
    records: WorkspaceRecord[],
    current = "",
  ): string =>
    records.find((w) => w.id === current)?.id ??
    records.find((w) => w.kind !== "project")?.id ??
    records.find((w) => w.selected)?.id ??
    records[0]?.id ??
    "";
  const loadWorkspaces = async (): Promise<void> => {
    const records = await api.listWorkspaces();
    setWorkspaces(records);
    setProposalWorkspace((current) =>
      chooseProposalWorkspace(records, current),
    );
  };
  const loadActions = async (): Promise<void> =>
    setActions(await api.listPendingActions());
  const loadChat = async (): Promise<void> => {
    const [nextSessions, nextHistory] = await Promise.all([
      api.listChatSessions(),
      api.getChatHistory(),
    ]);
    setSessions(nextSessions);
    setHistory(nextHistory);
  };
  const loadLocalModels = async (baseUrl = endpoint.baseUrl): Promise<void> => {
    setModelDiscoveryBusy(true);
    setModelDiscoveryError(null);
    try {
      const models = await api.discoverLocalModels(baseUrl);
      setLocalModels(models);
      if (models.length === 0) setModelDiscoveryError('Ollama is running but has no installed models.');
    } catch (value) {
      setLocalModels([]);
      setModelDiscoveryError(`Could not discover Ollama models: ${messageOf(value)}`);
    } finally {
      setModelDiscoveryBusy(false);
    }
  };
  useEffect(() => {
    void Promise.all([
      api.getEndpointConfig(),
      api.listWorkspaces(),
      api.listPendingActions(),
      api.listChatSessions(),
      api.getChatHistory(),
    ])
      .then(([config, records, pending, nextSessions, nextHistory]) => {
        setEndpoint(config);
        setWorkspaces(records);
        setActions(pending);
        setSessions(nextSessions);
        setHistory(nextHistory);
        setProposalWorkspace(chooseProposalWorkspace(records));
        if (config.mode === "local") void loadLocalModels(config.baseUrl);
      })
      .catch((value: unknown) => setError(messageOf(value)));
    void api.listProviderConnections()
      .then(setProviderConnections)
      .catch(() => setProviderConnections([]));
  }, [api]);
  useEffect(() => {
    if (pendingChatInput) conversationEnd.current?.scrollIntoView({ block: "nearest" });
  }, [pendingChatInput]);
  const go = (next: View): void => {
    setView(next);
    setError(null);
    setNotice(null);
  };

  const Home = (): JSX.Element => (
    <div className="page-stack">
      <section className="hero">
        <div>
          <p className="eyebrow">Career Agent · local-first</p>
          <h1>
            Turn real project work into an evidence-backed professional profile.
          </h1>
          <p className="hero-copy">
            Connect local folders and a local model, inspect gaps, then review
            every proposed edit before anything changes.
          </p>
        </div>
        <div className={`readiness ${realReady ? "ready" : ""}`}>
          <span>
            {realReady
              ? "Ready"
              : demoSessionEnabled
                ? "Simulated demo"
                : "Setup needed"}
          </span>
          <strong>
            {realReady
              ? endpoint.mode === "delegated"
                ? `Using ${delegatedConnection?.label ?? endpoint.providerId} with explicit cloud permission`
                : `${policyLabel(endpoint.routingPolicy)} · ${endpoint.modelId}`
              : demoSessionEnabled
                ? "No AI model is being used"
                : `${Number(workspaceReady) + Number(realEndpointReady)} of 2 steps complete`}
          </strong>
        </div>
      </section>
      {!realReady ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">First run</p>
              <h2>Finish setup</h2>
            </div>
            <p>
              Your files stay local. The agent reads only folders you register.
            </p>
          </div>
          <div className="step-grid">
            <button
              className={`step-card ${workspaceReady ? "complete" : ""}`}
              type="button"
              onClick={() => go("sources")}
            >
              <span>{workspaceReady ? "✓" : "1"}</span>
              <strong>Add workspaces</strong>
              <small>Register your profile and recent projects.</small>
            </button>
            <button
              className={`step-card ${realEndpointReady ? "complete" : ""}`}
              type="button"
              onClick={() => go("settings")}
            >
              <span>{realEndpointReady ? "✓" : "2"}</span>
              <strong>Connect intelligence</strong>
              <small>Use Ollama locally or a delegated provider CLI.</small>
            </button>
          </div>
        </section>
      ) : null}
      <section className="workflow-grid">
        <article>
          <span>01</span>
          <h2>Ask</h2>
          <p>Discuss your positioning with the Career Agent.</p>
          <button type="button" disabled={!ready} onClick={() => go("chat")}>
            Open career chat
          </button>
        </article>
        <article>
          <span>02</span>
          <h2>Audit</h2>
          <p>Compare repository activity with profile sources.</p>
          <button type="button" disabled={!ready} onClick={() => go("audit")}>
            Run career audit
          </button>
        </article>
        <article>
          <span>03</span>
          <h2>Improve</h2>
          <p>Create an edit and inspect the exact diff.</p>
          <button type="button" disabled={!ready} onClick={() => go("changes")}>
            Review changes
          </button>
        </article>
      </section>
    </div>
  );

  const Chat = (): JSX.Element => (
    <div className="page-stack">
      <Heading
        eyebrow="Explore"
        title="Career Agent chat"
        description="Ask questions grounded in your registered workspaces and agent memory."
      />
      {!ready ? <Setup onGo={go} /> : null}
      <section className="panel">
        <div className="session-bar">
          <label>
            <span>Conversation</span>
            <select
              value={sessions.find((s) => s.selected)?.id ?? ""}
              onChange={(e) =>
                void task("chat", async () => {
                  await api.selectChatSession(e.target.value);
                  await loadChat();
                })
              }
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>New conversation</span>
            <div className="inline">
              <input
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
              />
              <button
                type="button"
                onClick={() =>
                  void task("chat", async () => {
                    if (!sessionName.trim()) return;
                    await api.createChatSession(sessionName.trim());
                    await loadChat();
                    setNotice("New conversation created.");
                  })
                }
              >
                Create
              </button>
            </div>
          </label>
        </div>
        <div className="conversation" aria-live="polite">
          {history.length === 0 && !pendingChatInput ? (
            <Empty
              title="Start with a concrete question"
              text="Try asking what important outcomes are missing from your profile."
            />
          ) : (
            history.map((exchange, i) => (
              <div className="exchange" key={`${exchange.userMessage}-${i}`}>
                <div className="message user">
                  <span>You</span>
                  <p>{exchange.userMessage}</p>
                </div>
                <div className="message assistant">
                  <span>Career Agent</span>
                  <p>{exchange.assistantMessage}</p>
                  <RouteNote route={exchange.route} />
                  {exchange.sourceReferences.length ? (
                    <div className="chips">
                      {exchange.sourceReferences.map((s, j) => (
                        <span key={`${s.type}-${j}`}>{sourceLabel(s)}</span>
                      ))}
                    </div>
                  ) : (
                    <small>No source references returned.</small>
                  )}
                </div>
              </div>
            ))
          )}
          {pendingChatInput ? (
            <div className="exchange pending-exchange">
              <div className="message user">
                <span>You</span>
                <p>{pendingChatInput}</p>
              </div>
              <div
                className="message assistant thinking-message"
                role="status"
                aria-label="Career Agent is thinking"
              >
                <span>Career Agent</span>
                <div className="thinking-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <small>Thinking…</small>
              </div>
            </div>
          ) : null}
          <div ref={conversationEnd} aria-hidden="true" />
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            const prompt = chatInput.trim();
            if (!prompt || !ready) return;
            setChatInput("");
            setPendingChatInput(prompt);
            void task("chat", async () => {
              try {
                const result = await api.sendChatMessage(prompt);
                setHistory((old) => [...old, result]);
                await loadChat();
              } finally {
                setPendingChatInput(null);
              }
            });
          }}
        >
          <textarea
            aria-label="Message Career Agent"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ask the Career Agent about your profile…"
          />
          <button className="primary" disabled={!ready || busy === "chat"}>
            Send message
          </button>
        </form>
      </section>
    </div>
  );

  const Audit = (): JSX.Element => (
    <div className="page-stack">
      <Heading
        eyebrow="Evidence check"
        title="Career audit"
        description="Compare your current profile with recent work. The audit runs only when you ask."
        action={
          <button
            className="primary"
            data-testid="run-audit"
            type="button"
            disabled={!ready || busy === "audit"}
            onClick={() =>
              void task("audit", async () => {
                setAudit(await api.getDemoAudit());
                setNotice("Career audit completed.");
              })
            }
          >
            {busy === "audit"
              ? "Auditing…"
              : audit
                ? "Run again"
                : "Run career audit"}
          </button>
        }
      />
      {!ready ? <Setup onGo={go} /> : null}
      {!audit ? (
        <section className="panel">
          <Empty
            title="No audit has run yet"
            text="Run the audit to inspect evidence and identify profile gaps."
          />
        </section>
      ) : (
        <>
          <section className="panel result">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Result</p>
                <h2>{audit.title}</h2>
              </div>
              <span className="pill">
                {audit.result.sourceReferences.length} sources
              </span>
            </div>
            <p>{audit.summary}</p>
            <div className="agent-output">{audit.result.content}</div>
            <RouteNote route={audit.result.route} />
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>Evidence used</h2>
              <button
                className="text"
                type="button"
                onClick={() => go("sources")}
              >
                Manage workspaces
              </button>
            </div>
            <div className="source-list">
              {audit.result.sourceReferences.map((s, i) => (
                <div className="source-row" key={`${s.type}-${i}`}>
                  <span>{s.type}</span>
                  <strong>{sourceLabel(s)}</strong>
                  <small>{s.workspaceId ?? "agent memory"}</small>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );

  const Changes = (): JSX.Element => (
    <div className="page-stack">
      <Heading
        eyebrow="Human approval"
        title="Review changes"
        description="The agent proposes edits, but only you can write them to disk."
        action={<span className="pill">{actions.length} pending</span>}
      />
      {!ready ? <Setup onGo={go} /> : null}
      <section className="panel form">
        <div className="section-heading">
          <div>
            <h2>Create a profile proposal</h2>
            <p>Choose the exact file and describe the improvement.</p>
          </div>
        </div>
        <div className="form-grid">
          <label>
            <span>Profile workspace</span>
            <select
              value={proposalWorkspace}
              onChange={(e) => setProposalWorkspace(e.target.value)}
            >
              {(profileWorkspaces.length ? profileWorkspaces : workspaces).map(
                (w) => (
                  <option key={w.id} value={w.id}>
                    {w.id} · {w.kind}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            <span>Target file</span>
            <input
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
            />
          </label>
        </div>
        <label>
          <span>Requested improvement</span>
          <textarea
            value={recommendation}
            onChange={(e) => setRecommendation(e.target.value)}
          />
        </label>
        <div className="actions">
          <button
            className="primary"
            data-testid="create-proposal"
            type="button"
            disabled={
              !ready ||
              !proposalWorkspace ||
              !targetPath.trim() ||
              !recommendation.trim() ||
              busy === "proposal"
            }
            onClick={() =>
              void task("proposal", async () => {
                await api.proposeProfileUpdate({
                  workspaceId: proposalWorkspace,
                  targetPath: targetPath.trim(),
                  recommendation: recommendation.trim(),
                });
                await loadActions();
                setNotice(
                  "Proposal created. Review the diff before approving.",
                );
              })
            }
          >
            {busy === "proposal" ? "Creating…" : "Create proposal"}
          </button>
        </div>
      </section>
      {actions.length === 0 ? (
        <section className="panel">
          <Empty
            title="No changes waiting"
            text="New proposals appear here with an exact diff and approval controls."
          />
        </section>
      ) : (
        actions.map((action) => (
          <article className="panel change" key={action.id}>
            <span className="pill">{action.status}</span>
            <h2>{action.targetPath}</h2>
            <p>{action.workspaceId}</p>
            <pre>{action.diff}</pre>
            <RouteNote route={action.route} />
            <div className="actions">
              <button
                className="primary"
                type="button"
                disabled={busy === "approval"}
                onClick={() =>
                  void task("approval", async () => {
                    await api.approvePendingAction(action.id);
                    await loadActions();
                    setNotice(`Applied ${action.targetPath}.`);
                  })
                }
              >
                Approve and write
              </button>
              <button
                className="danger"
                type="button"
                disabled={busy === "approval"}
                onClick={() =>
                  void task("approval", async () => {
                    await api.rejectPendingAction(
                      action.id,
                      "Rejected from desktop review",
                    );
                    await loadActions();
                    setNotice("Proposal rejected.");
                  })
                }
              >
                Reject
              </button>
            </div>
          </article>
        ))
      )}
    </div>
  );

  const Sources = (): JSX.Element => (
    <div className="page-stack">
      <Heading
        eyebrow="Local evidence"
        title="Workspaces"
        description="Register only the folders the Career Agent may inspect."
      />
      <section className="panel form">
        <div className="form-grid">
          <label>
            <span>Workspace name</span>
            <input
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              placeholder="portfolio-site"
            />
          </label>
          <label>
            <span>Workspace role</span>
            <select
              aria-label="Purpose"
              value={workspaceKind}
              onChange={(e) =>
                setWorkspaceKind(e.target.value as typeof workspaceKind)
              }
            >
              <option value="project">Project evidence (default)</option>
              <option value="profile">Professional profile</option>
              <option value="cv">CV or résumé</option>
            </select>
            <small>This role helps the Career Agent choose profile content or project activity as evidence.</small>
          </label>
        </div>
        <div className="actions">
          <button
            className="primary"
            data-testid="add-workspace"
            type="button"
            disabled={!workspaceId.trim() || busy === "workspace"}
            onClick={() =>
              void task("workspace", async () => {
                const directory = await api.pickWorkspaceDirectory();
                if (!directory) return;
                await api.registerWorkspace({
                  id: workspaceId.trim(),
                  rootPath: directory,
                  kind: workspaceKind,
                });
                setWorkspaceId("");
                await loadWorkspaces();
                setNotice("Workspace registered.");
              })
            }
          >
            Choose folder and add
          </button>
        </div>
      </section>
      {workspaces.length === 0 ? (
        <section className="panel">
          <Empty
            title="No workspaces registered"
            text="Add your profile folder, then projects containing supporting evidence."
          />
        </section>
      ) : (
        workspaces.map((w) => (
          <article className="panel workspace" key={w.id}>
            <div>
              <span className="pill">{w.kind}</span>
              <h2>{w.id}</h2>
              <p>{w.rootPath}</p>
            </div>
            <div className="actions">
              {!w.selected ? (
                <button
                  type="button"
                  onClick={() =>
                    void task("workspace", async () => {
                      await api.selectWorkspace(w.id);
                      await loadWorkspaces();
                    })
                  }
                >
                  Use by default
                </button>
              ) : (
                <strong className="selected">● Default</strong>
              )}
              <button
                className="danger text"
                type="button"
                onClick={() =>
                  void task("workspace", async () => {
                    await api.removeWorkspace(w.id);
                    await loadWorkspaces();
                    setNotice("Workspace removed. Files were not deleted.");
                  })
                }
              >
                Remove
              </button>
            </div>
          </article>
        ))
      )}
    </div>
  );

  const Settings = (): JSX.Element => (
    <div className="page-stack">
      <Heading
        eyebrow="Private intelligence"
        title="Model settings"
        description="Choose local inference or reuse a provider CLI connection. Credentials remain provider-managed."
      />
      {endpoint.mode === "mock" ? (
        <div className="demo">
          <strong>Simulated demo is not AI.</strong>
          <span>
            Ask, Audit, and Improve stay locked until you explicitly enable the
            demo for this app session. Choose Local model for real Career Agent
            work.
          </span>
          <button
            type="button"
            data-testid="enable-demo-session"
            disabled={!demoConfigured || demoSessionEnabled}
            onClick={() => {
              setDemoSessionEnabled(true);
              setNotice(
                "Simulated demo enabled for this session. No AI model will be used.",
              );
            }}
          >
            {demoSessionEnabled
              ? "Simulated demo enabled"
              : "Enable simulated demo for this session"}
          </button>
        </div>
      ) : null}
      <section className="panel form settings">
        {endpoint.mode === "local" ? (
          <label>
            <span>Execution policy</span>
            <select
              aria-label="Routing policy"
              value={endpoint.routingPolicy ?? "local_only"}
              onChange={(e) => setEndpoint((old) => ({
                ...old,
                routingPolicy: e.target.value as NonNullable<EndpointConfig["routingPolicy"]>,
                configured: false,
              }))}
            >
              <option value="local_only">Local only · never use cloud</option>
              <option value="local_first">Local first · cloud only after local failure</option>
              <option value="adaptive">Adaptive · choose by Career Agent task</option>
            </select>
            <small>
              {endpoint.routingPolicy === "adaptive"
                ? "Routine chat stays local; audit and improvement prefer the connected provider."
                : endpoint.routingPolicy === "local_first"
                  ? "Every request starts locally and may use the connected provider only if local inference fails."
                  : "All model requests stay on this device. Provider fallback is blocked."}
            </small>
          </label>
        ) : null}
        <label>
          <span>Mode</span>
          <select
            aria-label="Execution mode"
            value={endpoint.mode === "delegated" ? `delegated:${endpoint.providerId ?? ""}` : endpoint.mode}
            onChange={(e) => {
              const value = e.target.value;
              if (value.startsWith("delegated:")) {
                const providerId = value.slice("delegated:".length);
                const provider = providerConnections.find((item) => item.id === providerId);
                setEndpoint((old) => ({
                  ...old,
                  mode: "delegated",
                  providerId,
                  modelId: provider?.defaultModel ?? "default",
                  providerModelId: provider?.defaultModel ?? "default",
                  routingPolicy: "adaptive",
                  configured: false,
                }));
              } else {
                setEndpoint((old) => ({
                  ...old,
                  mode: value as "mock" | "local",
                  ...(value === "local" ? { routingPolicy: old.routingPolicy ?? "local_only" } : {
                    providerId: undefined,
                    providerModelId: undefined,
                    routingPolicy: "local_only" as const,
                  }),
                  configured: false,
                }));
              }
              setDemoSessionEnabled(false);
            }}
          >
            <option value="local">Local model</option>
            {providerConnections.map((provider) => (
              <option key={provider.id} value={`delegated:${provider.id}`} disabled={!provider.installed}>
                {provider.label} · {provider.installed ? "delegated CLI" : "not installed"}
              </option>
            ))}
            <option value="mock">Demo mode (simulated)</option>
          </select>
        </label>
        {endpoint.mode !== "mock" ? <label>
          <span>{endpoint.mode === "local" ? "Installed Ollama model" : "Provider model"}</span>
          {endpoint.mode === "local" && localModels.length > 0 ? (
            <select
              aria-label="Installed Ollama model"
              value={localModels.some((model) => model.id === endpoint.modelId) ? endpoint.modelId : ""}
              onChange={(e) =>
                setEndpoint((old) => ({
                  ...old,
                  modelId: e.target.value,
                  configured: false,
                }))
              }
            >
              <option value="" disabled>Select an installed model</option>
              {localModels.map((model) => (
                <option key={model.id} value={model.id} disabled={!model.toolCalling}>
                  {model.id} · {(model.size / 1024 / 1024 / 1024).toFixed(1)} GB · {model.toolCalling ? "Career Agent ready" : "chat only — no tools"}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label="Model ID"
              value={endpoint.modelId}
              onChange={(e) =>
                setEndpoint((old) => ({
                  ...old,
                  modelId: e.target.value,
                  configured: false,
                }))
              }
            />
          )}
        </label> : null}
        {routingNeedsProvider ? (
          <div className="form-grid">
            <label>
              <span>Permitted cloud provider</span>
              <select
                aria-label="Permitted cloud provider"
                value={endpoint.providerId ?? ""}
                onChange={(e) => {
                  const provider = providerConnections.find((item) => item.id === e.target.value);
                  setEndpoint((old) => ({
                    ...old,
                    providerId: e.target.value || undefined,
                    providerModelId: provider?.defaultModel ?? "default",
                    configured: false,
                  }));
                }}
              >
                <option value="" disabled>Select a connected provider</option>
                {providerConnections.map((provider) => (
                  <option key={provider.id} value={provider.id} disabled={!provider.installed || provider.authenticated === false}>
                    {provider.label} · {provider.installed ? "detected" : "not installed"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Provider model</span>
              <input
                aria-label="Provider model ID"
                value={endpoint.providerModelId ?? delegatedConnection?.defaultModel ?? "default"}
                onChange={(e) => setEndpoint((old) => ({ ...old, providerModelId: e.target.value, configured: false }))}
              />
            </label>
          </div>
        ) : null}
        {localModelIncompatible ? (
          <div className="demo">
            <strong>{endpoint.modelId} cannot run Career Agent workflows.</strong>
            <span>
              This model supports text completion but not tool calling. Choose a
              model marked Career Agent ready; on this computer, qwen2.5:3b is
              compatible.
            </span>
          </div>
        ) : null}
        {endpoint.mode === "local" ? (
          <details className="settings-details">
            <summary>Ollama connection details</summary>
            <div className="details-content">
              <label>
                <span>Endpoint URL</span>
                <input
                  value={endpoint.baseUrl}
                  onChange={(e) =>
                    setEndpoint((old) => ({
                      ...old,
                      baseUrl: e.target.value,
                      configured: false,
                    }))
                  }
                />
              </label>
              <div className="actions model-discovery">
                <button
                  type="button"
                  disabled={modelDiscoveryBusy}
                  onClick={() => void loadLocalModels()}
                >
                  {modelDiscoveryBusy ? "Finding models…" : "Refresh installed models"}
                </button>
                {modelDiscoveryError ? <small>{modelDiscoveryError}</small> : null}
                {localModels.length > 0 ? (
                  <small>{localModels.length} installed model{localModels.length === 1 ? "" : "s"} found.</small>
                ) : null}
              </div>
              <small>Default endpoint: http://localhost:11434</small>
            </div>
          </details>
        ) : null}
        {endpoint.mode === "delegated" || routingNeedsProvider ? (
          <div className="demo">
            <strong>{delegatedConnection?.label ?? "Provider"} sends bounded Career Agent context to the cloud.</strong>
            <span>
              You explicitly selected {policyLabel(endpoint.routingPolicy)}. The actual provider, model,
              fallback state, and routing reason are shown with every result. Its CLI manages authentication;
              Agent Workstation stores only connection and model IDs.
            </span>
          </div>
        ) : null}
        <div className="provider-list">
          {providerConnections.map((provider) => (
            <div className="source-row" key={provider.id}>
              <span>{provider.installed ? "Detected" : "Unavailable"}</span>
              <strong>{provider.label}</strong>
              <small>{provider.detail}</small>
            </div>
          ))}
        </div>
        <div className="actions">
          <button
            type="button"
            disabled={busy === "endpoint" || (routingNeedsProvider && !routingProviderReady)}
            onClick={() =>
              void task("endpoint", async () => {
                const result = await api.testEndpointConnection(endpoint);
                setNotice(result.message);
              })
            }
          >
            Test connection
          </button>
          <button
            className="primary"
            data-testid="save-endpoint"
            type="button"
            disabled={busy === "endpoint" || (routingNeedsProvider && !routingProviderReady)}
            onClick={() =>
              void task("endpoint", async () => {
                await api.saveEndpointConfig(endpoint);
                setEndpoint((old) => ({ ...old, configured: true }));
                setDemoSessionEnabled(false);
                setNotice(
                  endpoint.mode === "mock"
                    ? "Simulated demo configured but inactive. Enable it explicitly to run without AI."
                    : endpoint.mode === "delegated"
                      ? `${delegatedConnection?.label ?? "Provider"} connection saved.`
                      : `${policyLabel(endpoint.routingPolicy)} settings saved.`,
                );
              })
            }
          >
            {busy === "endpoint" ? "Working…" : "Save model settings"}
          </button>
        </div>
      </section>
    </div>
  );

  const Agents = (): JSX.Element => (
    <div className="page-stack">
      <Heading
        eyebrow="Agent library"
        title="Choose an agent"
        description="Each agent has its own conversations, tools, workspaces, and workflows."
      />
      <section className="agent-grid">
        <article className="panel agent-card active-agent">
          <div className="agent-icon">CA</div>
          <div>
            <span className="pill">Available now</span>
            <h2>Career Agent</h2>
            <p>
              Turns local project evidence into career guidance, audits, and
              reviewable profile changes.
            </p>
          </div>
          <button className="primary" type="button" onClick={() => go("home")}>
            Open Career Agent
          </button>
        </article>
        <article className="panel agent-card future-agent">
          <div className="agent-icon">+</div>
          <div>
            <span className="pill">Future</span>
            <h2>More agents</h2>
            <p>
              New specialists will appear here without changing the Career Agent
              workspace.
            </p>
          </div>
        </article>
      </section>
    </div>
  );

  const pages: Record<View, () => JSX.Element> = {
    agents: Agents,
    home: Home,
    chat: Chat,
    audit: Audit,
    changes: Changes,
    sources: Sources,
    settings: Settings,
  };
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span>AW</span>
          <div>
            <strong>Agent Workstation</strong>
            <small>Local agent desktop</small>
          </div>
        </div>
        <button
          className={`agent-picker ${view === "agents" ? "active" : ""}`}
          type="button"
          onClick={() => go("agents")}
        >
          <span className="agent-avatar">CA</span>
          <span>
            <small>Active agent</small>
            <strong>Career Agent</strong>
          </span>
          <b>⌄</b>
        </button>
        <span className="sidebar-label">Career Agent</span>
        <nav>
          {careerNav.map((item) => (
            <button
              className={view === item.id ? "active" : ""}
              type="button"
              key={item.id}
              onClick={() => go(item.id)}
            >
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
              {item.id === "changes" && actions.length ? (
                <b>{actions.length}</b>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            className="settings-link"
            type="button"
            onClick={() => go("settings")}
          >
            <span>Model settings</span>
            <small>
              {realEndpointReady
                ? endpoint.mode === "delegated"
                  ? `${delegatedConnection?.label ?? endpoint.providerId} · cloud allowed`
                  : `${endpoint.modelId} · real local AI`
                : demoSessionEnabled
                  ? "Simulated demo · no AI"
                  : "Real model required"}
            </small>
          </button>
          <div className="privacy">
            <strong>{endpoint.mode === "delegated" ? "● Provider allowed" : "● Local only"}</strong>
            <small>{endpoint.mode === "delegated" ? "Bounded context is sent through the selected CLI." : "Registered folders stay on this computer."}</small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <i className={realEndpointReady ? "connected" : ""} />
            {realEndpointReady
              ? endpoint.mode === "delegated"
                ? `${delegatedConnection?.label ?? endpoint.providerId} · provider allowed`
                : `${endpoint.modelId} · real local AI`
              : demoSessionEnabled
                ? "Simulated demo · no AI model"
                : "Real local model required"}
          </div>
          <button type="button" onClick={() => go("settings")}>
            Configure
          </button>
        </header>
        {demoConfigured && view !== "settings" ? (
          <div className="demo top">
            <strong>
              {demoSessionEnabled
                ? "Simulated demo active — no AI model"
                : "Simulated demo is configured but inactive"}
            </strong>
            <span>
              {demoSessionEnabled
                ? "Ask, Audit, and Improve return deterministic test responses."
                : "Connect a local model to use Career Agent, or explicitly enable the demo in Model settings."}
            </span>
          </div>
        ) : null}
        {delegatedEndpointReady && view !== "settings" ? (
          <div className="demo top">
            <strong>{delegatedConnection?.label ?? "Cloud provider"} selected</strong>
            <span>
              Routing reason: explicit provider selection. Bounded Career Agent
              context may leave this computer through the provider-managed CLI.
            </span>
          </div>
        ) : null}
        {error ? (
          <Toast kind="error" text={error} close={() => setError(null)} />
        ) : null}
        {notice ? (
          <Toast kind="success" text={notice} close={() => setNotice(null)} />
        ) : null}
        <div className="page">{pages[view]()}</div>
      </main>
    </div>
  );
}

function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Setup({ onGo }: { onGo: (view: View) => void }): JSX.Element {
  return (
    <div className="setup">
      <div>
        <strong>Finish setup to use this feature</strong>
        <span>Add workspaces and save local model settings first.</span>
      </div>
      <div>
        <button type="button" onClick={() => onGo("sources")}>
          Workspaces
        </button>
        <button type="button" onClick={() => onGo("settings")}>
          Model settings
        </button>
      </div>
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }): JSX.Element {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
function Toast({
  kind,
  text,
  close,
}: {
  kind: string;
  text: string;
  close: () => void;
}): JSX.Element {
  return (
    <div
      className={`toast ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <span>{text}</span>
      <button type="button" onClick={close}>
        ×
      </button>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
