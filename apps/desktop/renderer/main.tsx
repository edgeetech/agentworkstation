import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import type {
  ChatExchange,
  ChatMode,
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
  | "status"
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
const chatErrorMessage = (value: unknown): string => {
  const message = messageOf(value);
  const httpError = message.match(/HTTP\s+\d{3}\b[\s\S]*/i);
  if (httpError) return httpError[0];
  return message.replace(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i,
    "",
  );
};
const sourceLabel = (
  source: DemoAudit["result"]["sourceReferences"][number],
): string =>
  source.label ??
  source.relativePath ??
  source.commitSha ??
  source.workspaceId ??
  "Local evidence";

const chooseAutomaticLocalModel = (models: LocalModel[]): LocalModel | undefined => {
  const ready = models.filter((model) => model.toolCalling && model.location === "local");
  const practical = ready.filter((model) => model.size <= 8 * 1024 * 1024 * 1024);
  return [...(practical.length > 0 ? practical : ready)].sort((left, right) =>
    left.size - right.size,
  )[0];
};

const chooseAutomaticCloudModel = (models: LocalModel[]): LocalModel | undefined =>
  models.find((model) => model.toolCalling && model.location === "cloud"
    && model.availability !== "limited" && model.availability !== "unavailable");

const orderedAutomaticModelIds = (models: LocalModel[]): string[] => {
  const local = models.filter((model) => model.toolCalling && model.location === "local");
  const practical = local.filter((model) => model.size <= 8 * 1024 * 1024 * 1024)
    .sort((left, right) => left.size - right.size);
  const oversized = local.filter((model) => model.size > 8 * 1024 * 1024 * 1024)
    .sort((left, right) => left.size - right.size);
  const cloud = models.filter((model) => model.toolCalling && model.location === "cloud")
    .sort((left, right) => Number(left.availability === "limited" || left.availability === "unavailable")
      - Number(right.availability === "limited" || right.availability === "unavailable"));
  return [...practical, ...oversized, ...cloud].map((model) => model.id);
};

const providerReady = (provider: ProviderConnection): boolean =>
  provider.installed && provider.authenticated !== false;
const providerAvailable = (provider: ProviderConnection): boolean =>
  providerReady(provider) && provider.availability !== "limited" && provider.availability !== "unavailable";

const availabilityLabel = (value: LocalModel["availability"] | ProviderConnection["availability"]): string => {
  if (value === "limited") return "Usage limited";
  if (value === "unavailable") return "Unavailable";
  if (value === "available") return "Available";
  return "Discovered";
};

const modelSize = (bytes: number): string => bytes > 0 ? `${(bytes / (1024 ** 3)).toFixed(1)} GB` : "Cloud managed";

const PromptModeIcon = ({ mode }: { mode: ChatMode }): JSX.Element => (
  <span
    className={`prompt-mode-icon ${mode}`}
    aria-label={`${mode === "autopilot" ? "Autopilot" : "Standard"} mode`}
    title={`${mode === "autopilot" ? "Autopilot" : "Standard"} mode`}
  >
    <span aria-hidden="true">{mode === "autopilot" ? "⚙" : "?"}</span>
  </span>
);

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
    allowedPaths: { localModels: true, ollamaCloudModels: false, cloudProviders: false },
    ollamaModelIds: [],
    providerIds: [],
    configured: false,
  });
  const [history, setHistory] = useState<ChatExchange[]>([]);
  const [sessions, setSessions] = useState<ChatSessionRecord[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [pendingChatInput, setPendingChatInput] = useState<{ prompt: string; mode: ChatMode } | null>(null);
  const [chatFailure, setChatFailure] = useState<{
    prompt: string;
    message: string;
    mode: ChatMode;
  } | null>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameSessionName, setRenameSessionName] = useState("");
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
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
  const automaticLocalModel = chooseAutomaticLocalModel(localModels);
  const automaticCloudModel = chooseAutomaticCloudModel(localModels);
  const localPathAllowed = endpoint.mode !== "mock" && (endpoint.allowedPaths?.localModels ?? endpoint.mode === "local");
  const cloudPathAllowed = endpoint.mode !== "mock" && (endpoint.allowedPaths?.cloudProviders
    ?? (endpoint.mode === "delegated" || endpoint.routingPolicy !== "local_only"));
  const ollamaCloudPathAllowed = endpoint.mode !== "mock" && (endpoint.allowedPaths?.ollamaCloudModels ?? false);
  const localEndpointReady = endpoint.configured === true && localPathAllowed && automaticLocalModel !== undefined;
  const delegatedConnection = providerConnections.find((provider) => provider.id === endpoint.providerId);
  const automaticProvider = (delegatedConnection && providerReady(delegatedConnection)
    ? delegatedConnection
    : providerConnections.find(providerReady));
  const cloudEndpointReady = endpoint.configured === true && cloudPathAllowed
    && providerConnections.some(providerAvailable);
  const ollamaCloudEndpointReady = endpoint.configured === true && ollamaCloudPathAllowed && automaticCloudModel !== undefined;
  const realEndpointReady = localEndpointReady || ollamaCloudEndpointReady || cloudEndpointReady;
  const demoConfigured =
    endpoint.configured === true && endpoint.mode === "mock";
  const endpointReady = realEndpointReady || demoSessionEnabled;
  const workspaceReady = workspaces.length > 0;
  const ready = endpointReady && workspaceReady;
  const realReady = realEndpointReady && workspaceReady;
  const selectedChatSession = sessions.find((session) => session.selected);
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
      const modelIds = orderedAutomaticModelIds(models);
      const chosen = chooseAutomaticLocalModel(models) ?? chooseAutomaticCloudModel(models);
      setEndpoint((old) => {
        const unchangedIds = JSON.stringify(old.ollamaModelIds ?? []) === JSON.stringify(modelIds);
        if (!chosen || (old.modelId === chosen.id && unchangedIds)) return old;
        return {
          ...old,
          modelId: chosen.id,
          ollamaModelIds: modelIds,
          configured: false,
        };
      });
      if (models.length === 0) setModelDiscoveryError('Ollama is running but has no installed models.');
    } catch (value) {
      setLocalModels([]);
      setModelDiscoveryError(`Could not discover Ollama models: ${messageOf(value)}`);
    } finally {
      setModelDiscoveryBusy(false);
    }
  };
  const loadProviderConnections = async (): Promise<void> => {
    const providers = await api.listProviderConnections();
    setProviderConnections(providers);
    const readyProviders = providers.filter(providerReady);
    const preferred = readyProviders[0];
    if (!preferred) return;
    const providerIds = readyProviders.map((provider) => provider.id);
    setEndpoint((old) => {
      const unchangedIds = JSON.stringify(old.providerIds ?? []) === JSON.stringify(providerIds);
      if (!(old.allowedPaths?.cloudProviders ?? old.mode === "delegated")) return old;
      if (old.providerId && unchangedIds) return old;
      return {
        ...old,
        providerId: old.providerId ?? preferred.id,
        providerModelId: old.providerModelId ?? preferred.defaultModel,
        providerIds,
        configured: false,
      };
    });
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
        if ((config.allowedPaths?.localModels ?? config.mode === "local") || config.allowedPaths?.ollamaCloudModels) {
          void loadLocalModels(config.baseUrl);
        }
      })
      .catch((value: unknown) => setError(messageOf(value)));
    void loadProviderConnections()
      .catch(() => setProviderConnections([]));
  }, [api]);
  useEffect(() => {
    if (view !== "chat") return undefined;
    const frame = window.requestAnimationFrame(() => {
      const transcript = conversation.current;
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view, history, pendingChatInput, chatFailure]);
  const go = (next: View): void => {
    setView(next);
    setError(null);
    setNotice(null);
  };

  const createNewChat = (): void => {
    void task("chat", async () => {
      await api.createChatSession("New chat");
      await loadChat();
      setChatFailure(null);
      setView("chat");
    });
  };

  const saveChatName = (sessionId: string): void => {
    const name = renameSessionName.trim();
    if (!name) return;
    void task("chat", async () => {
      await api.renameChatSession(sessionId, name);
      await loadChat();
      setRenamingSessionId(null);
      setRenameSessionName("");
    });
  };

  const deleteChat = (sessionId: string): void => {
    void task("chat", async () => {
      await api.deleteChatSession(sessionId);
      await loadChat();
      setDeletingSessionId(null);
      setSessionMenuId(null);
      setChatFailure(null);
    });
  };

  const changeChatMode = (mode: ChatMode): void => {
    if (!selectedChatSession || selectedChatSession.mode === mode) return;
    if (typeof api.setChatSessionMode !== "function") {
      setError("Restart Agent Workstation to activate the updated chat mode controls.");
      return;
    }
    void task("chat", async () => {
      await api.setChatSessionMode(selectedChatSession.id, mode);
      await loadChat();
    });
  };

  const toggleChatMode = (): void => {
    changeChatMode(selectedChatSession?.mode === "autopilot" ? "standard" : "autopilot");
  };

  const sendChat = (): void => {
    const prompt = chatInput.trim();
    if (!prompt || !ready || busy === "chat") return;
    const mode = selectedChatSession?.mode ?? "autopilot";
    setChatInput("");
    setChatFailure(null);
    setPendingChatInput({ prompt, mode });
    void task("chat", async () => {
      try {
        const result = await api.sendChatMessage(prompt);
        setHistory((old) => [...old, result]);
        await loadChat();
      } catch (value) {
        setChatFailure({ prompt, message: chatErrorMessage(value), mode });
      } finally {
        setPendingChatInput(null);
      }
    });
  };

  const Home = (): JSX.Element => (
    <div className="page-stack">
      <section className="hero">
        <div>
          <p className="eyebrow">Career Agent</p>
          <h1>
            Turn real project work into an evidence-backed professional profile.
          </h1>
          <p className="hero-copy">
            Grant access to your evidence and preferred intelligence sources once.
            Career Agent chooses the right model for each request automatically.
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
              ? "Allowed intelligence is available"
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
              <strong>Choose intelligence access</strong>
              <small>Allow local models, connected cloud providers, or both.</small>
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
    <div className="chatgpt-chat">
      {!ready ? <Setup onGo={go} /> : null}
      <div className="conversation" ref={conversation} aria-live="polite">
        <div className="conversation-content">
          {history.length === 0 && !pendingChatInput && !chatFailure ? (
            <div className="chat-welcome">
              <span className="agent-avatar large">CA</span>
              <h1>How can I help with your career evidence?</h1>
              <p>Ask about your profile, registered projects, or a change you are considering.</p>
            </div>
          ) : history.map((exchange, i) => (
            <div className="exchange" key={`${exchange.userMessage}-${i}`}>
              <div className="user-turn">
                <div className="message user"><p>{exchange.userMessage}</p></div>
                <PromptModeIcon mode={exchange.mode} />
              </div>
              <div className="message assistant">
                <span>Career Agent</span>
                <p>{exchange.assistantMessage}</p>
                {exchange.sourceReferences.length ? (
                  <div className="chips">
                    {exchange.sourceReferences.map((source, index) => (
                      <span key={`${source.type}-${index}`}>{sourceLabel(source)}</span>
                    ))}
                  </div>
                ) : null}
                {exchange.route ? (
                  <div
                    className="model-status"
                    aria-label={`Model used: ${exchange.route.location === "simulated" ? "Simulated demo" : exchange.route.modelId}`}
                    title={exchange.route.reason}
                  >
                    <i aria-hidden="true" />
                    <span>{exchange.route.location === "simulated" ? "Simulated demo" : exchange.route.modelId}</span>
                    {exchange.route.fallback ? <em>fallback</em> : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {chatFailure ? (
            <div className="exchange failed-exchange">
              <div className="user-turn">
                <div className="message user"><p>{chatFailure.prompt}</p></div>
                <PromptModeIcon mode={chatFailure.mode} />
              </div>
              <div className="message assistant error-message" role="alert">
                <span>Career Agent</span>
                <strong>{/HTTP\s+429/i.test(chatFailure.message) ? "Usage limit reached" : "Message could not be completed"}</strong>
                <p>{chatFailure.message}</p>
                <small>Your message was not lost. Try again when an allowed provider is available.</small>
              </div>
            </div>
          ) : null}
          {pendingChatInput ? (
            <div className="exchange pending-exchange">
              <div className="user-turn">
                <div className="message user"><p>{pendingChatInput.prompt}</p></div>
                <PromptModeIcon mode={pendingChatInput.mode} />
              </div>
              <div className="message assistant thinking-message" role="status" aria-label="Career Agent is thinking">
                <span>Career Agent</span>
                <div className="thinking-dots" aria-hidden="true"><i /><i /><i /></div>
                <div className="model-status choosing-model"><i aria-hidden="true" /><span>Choosing model</span></div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="composer-dock">
        <div className="composer-toolbar">
          <span className="current-chat-mode" aria-live="polite">
            <PromptModeIcon mode={selectedChatSession?.mode ?? "autopilot"} />
            <strong>{selectedChatSession?.mode === "standard" ? "Standard" : "Autopilot"}</strong>
          </span>
          <span>Shift + Tab switches mode</span>
        </div>
        <form className="composer" onSubmit={(event) => { event.preventDefault(); sendChat(); }}>
          <textarea
            aria-label="Message Career Agent"
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Tab" && event.shiftKey) {
                event.preventDefault();
                toggleChatMode();
                return;
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                sendChat();
              }
            }}
            placeholder="Message Career Agent"
          />
          <button className="primary send-icon" aria-label="Send message" disabled={!ready || busy === "chat"}>↑</button>
        </form>
        <small>Enter to send · Shift + Enter for a new line · Shift + Tab changes mode</small>
      </div>
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

  const Status = (): JSX.Element => {
    const local = localModels.filter((model) => model.location === "local");
    const ollamaCloud = localModels.filter((model) => model.location === "cloud");
    const statusRow = (model: LocalModel): JSX.Element => (
      <article className="model-status-row" key={model.id}>
        <span className={`status-dot ${model.availability ?? "unknown"}`} aria-hidden="true" />
        <div>
          <strong>{model.id}</strong>
          <small>{model.location === "local" ? `${modelSize(model.size)} · Stored on this device` : "Runs through Ollama Cloud"}</small>
          {model.lastError ? <small className="status-error">{model.lastError}</small> : null}
        </div>
        <span className={`status-badge ${model.availability ?? "unknown"}`}>
          {model.toolCalling ? availabilityLabel(model.availability) : "Not agent compatible"}
        </span>
      </article>
    );
    return (
      <div className="page-stack">
        <Heading
          eyebrow="Intelligence status"
          title="Models Career Agent can reach"
          description="Availability is informational. Career Agent still chooses and falls back automatically within the access you allow."
          action={<button type="button" disabled={busy === "endpoint" || modelDiscoveryBusy} onClick={() => void task("endpoint", async () => {
            await Promise.all([loadLocalModels(), loadProviderConnections()]);
            setNotice("Intelligence availability refreshed.");
          })}>{busy === "endpoint" || modelDiscoveryBusy ? "Refreshing…" : "Refresh status"}</button>}
        />
        <section className="status-section panel">
          <div className="section-heading"><div><p className="eyebrow">On-device</p><h2>Fully local Ollama models</h2></div><p>These remain available when cloud usage is limited.</p></div>
          <div className="model-status-list">
            {local.length ? local.map(statusRow) : <Empty title="No local models" text="Install a tool-capable Ollama model, then refresh status." />}
          </div>
        </section>
        <section className="status-section panel">
          <div className="section-heading"><div><p className="eyebrow">Ollama account</p><h2>Ollama Cloud models</h2></div><p>A 429 marks the model usage-limited and triggers automatic fallback.</p></div>
          <div className="model-status-list">
            {ollamaCloud.length ? ollamaCloud.map(statusRow) : <Empty title="No Ollama Cloud models" text="Pull a compatible cloud-tagged model in Ollama to make it discoverable." />}
          </div>
        </section>
        <section className="status-section panel">
          <div className="section-heading"><div><p className="eyebrow">Provider CLIs</p><h2>Connected cloud providers</h2></div><p>Credentials stay with each installed provider.</p></div>
          <div className="model-status-list">
            {providerConnections.map((provider) => (
              <article className="model-status-row" key={provider.id}>
                <span className={`status-dot ${provider.availability ?? "unknown"}`} aria-hidden="true" />
                <div>
                  <strong>{provider.label}</strong>
                  <small>{provider.detail}</small>
                  {provider.lastError ? <small className="status-error">{provider.lastError}</small> : null}
                </div>
                <span className={`status-badge ${provider.availability ?? "unknown"}`}>
                  {providerReady(provider) ? availabilityLabel(provider.availability) : provider.installed ? "Sign-in required" : "Not installed"}
                </span>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const Settings = (): JSX.Element => {
    const noPathAllowed = !localPathAllowed && !ollamaCloudPathAllowed && !cloudPathAllowed;
    const localUnavailable = localPathAllowed && !automaticLocalModel;
    const ollamaCloudUnavailable = ollamaCloudPathAllowed && !automaticCloudModel;
    const cloudUnavailable = cloudPathAllowed && !providerConnections.some(providerAvailable);
    const settingsBlocked = noPathAllowed || (localUnavailable && ollamaCloudUnavailable && cloudUnavailable);
    return (
      <div className="page-stack">
        <Heading
          eyebrow="Intelligence access"
          title="Choose what Career Agent may use"
          description="Grant boundaries once. Career Agent evaluates each prompt and chooses the best allowed model automatically."
        />
        <section className="availability-summary" aria-label="Intelligence availability">
          <span><strong>{localModels.filter((model) => model.location === "local" && model.toolCalling && model.availability !== "unavailable").length}</strong> on-device ready</span>
          <span><strong>{localModels.filter((model) => model.location === "cloud" && model.toolCalling && model.availability !== "limited" && model.availability !== "unavailable").length}</strong> Ollama Cloud ready</span>
          <span><strong>{providerConnections.filter(providerAvailable).length}</strong> providers ready</span>
          <button type="button" onClick={() => go("status")}>View model status</button>
        </section>
        <section className="panel form settings">
          <div className="permission-list">
            <label className={`permission-card ${localPathAllowed ? "allowed" : ""}`}>
              <input
                type="checkbox"
                aria-label="Allow local models"
                checked={localPathAllowed}
                onChange={(event) => {
                  const allowed = event.target.checked;
                  setEndpoint((old) => ({
                    ...old,
                    mode: "local",
                    modelId: automaticLocalModel?.id ?? old.modelId,
                    routingPolicy: ollamaCloudPathAllowed || cloudPathAllowed ? "adaptive" : "local_only",
                    ollamaModelIds: orderedAutomaticModelIds(localModels),
                    allowedPaths: { localModels: allowed, ollamaCloudModels: ollamaCloudPathAllowed, cloudProviders: cloudPathAllowed },
                    configured: false,
                  }));
                  setDemoSessionEnabled(false);
                }}
              />
              <span>
                <strong>Local models</strong>
                <small>Includes free Ollama models installed on this computer. Workspace context stays on-device.</small>
              </span>
              <b>{automaticLocalModel ? "Available" : "No compatible model found"}</b>
            </label>
            <label className={`permission-card ${ollamaCloudPathAllowed ? "allowed" : ""}`}>
              <input
                type="checkbox"
                aria-label="Allow Ollama Cloud models"
                checked={ollamaCloudPathAllowed}
                disabled={!ollamaCloudPathAllowed && !automaticCloudModel}
                onChange={(event) => {
                  const allowed = event.target.checked;
                  setEndpoint((old) => ({
                    ...old,
                    mode: "local",
                    routingPolicy: allowed || cloudPathAllowed ? "adaptive" : "local_only",
                    ollamaModelIds: orderedAutomaticModelIds(localModels),
                    allowedPaths: { localModels: localPathAllowed, ollamaCloudModels: allowed, cloudProviders: cloudPathAllowed },
                    configured: false,
                  }));
                  setDemoSessionEnabled(false);
                }}
              />
              <span>
                <strong>Ollama Cloud models</strong>
                <small>Large Ollama models run in Ollama Cloud. Usage limits apply and workspace context may leave this computer.</small>
              </span>
              <b>{automaticCloudModel ? "Discovered" : "No compatible cloud model found"}</b>
            </label>
            <label className={`permission-card ${cloudPathAllowed ? "allowed" : ""}`}>
              <input
                type="checkbox"
                aria-label="Allow connected cloud providers"
                checked={cloudPathAllowed}
                disabled={!cloudPathAllowed && !automaticProvider}
                onChange={(event) => {
                  const allowed = event.target.checked;
                  setEndpoint((old) => ({
                    ...old,
                    mode: "local",
                    providerId: allowed ? automaticProvider?.id : undefined,
                    providerModelId: allowed ? automaticProvider?.defaultModel : undefined,
                    providerIds: allowed ? providerConnections.filter(providerReady).map((provider) => provider.id) : [],
                    routingPolicy: allowed || ollamaCloudPathAllowed ? "adaptive" : "local_only",
                    allowedPaths: { localModels: localPathAllowed, ollamaCloudModels: ollamaCloudPathAllowed, cloudProviders: allowed },
                    configured: false,
                  }));
                  setDemoSessionEnabled(false);
                }}
              />
              <span>
                <strong>Connected cloud providers</strong>
                <small>Use detected Codex, Copilot, or Claude CLI accounts only when the prompt benefits from them.</small>
              </span>
              <b>{automaticProvider ? `${providerConnections.filter(providerReady).length} connected` : "No authenticated provider detected"}</b>
            </label>
          </div>
          {noPathAllowed ? <div className="inline-warning" role="alert">Allow at least one intelligence path.</div> : null}
          {ollamaCloudPathAllowed || cloudPathAllowed ? (
            <div className="privacy-callout">
              <strong>Cloud access is allowed.</strong>
              <span>Bounded prompt, workspace, and agent context may leave this computer. Provider CLIs keep their own credentials.</span>
            </div>
          ) : null}
          <details className="settings-details">
            <summary>Local Ollama details</summary>
            <div className="details-content">
              <label>
                <span>Endpoint URL</span>
                <input value={endpoint.baseUrl} onChange={(event) => setEndpoint((old) => ({ ...old, baseUrl: event.target.value, configured: false }))} />
              </label>
              <div className="actions model-discovery">
                <button type="button" disabled={modelDiscoveryBusy} onClick={() => void loadLocalModels()}>
                  {modelDiscoveryBusy ? "Finding models…" : "Refresh installed models"}
                </button>
                {modelDiscoveryError ? <small>{modelDiscoveryError}</small> : null}
                <small>
                  {localModels.filter((model) => model.location === "local").length} on-device · {localModels.filter((model) => model.location === "cloud").length} Ollama Cloud · {localModels.filter((model) => model.toolCalling).length} compatible
                </small>
              </div>
            </div>
          </details>
          <details className="settings-details">
            <summary>Detected provider connections</summary>
            <div className="details-content provider-list">
              {providerConnections.map((provider) => (
                <div className="source-row" key={provider.id}>
                  <span>{providerReady(provider) ? availabilityLabel(provider.availability) : provider.installed ? "Sign-in required" : "Not installed"}</span>
                  <strong>{provider.label}</strong>
                  <small>{provider.detail}</small>
                </div>
              ))}
            </div>
          </details>
          <details className="settings-details">
            <summary>Offline demo for testing</summary>
            <div className="details-content">
              <p>Simulated responses are not AI and never count as model readiness.</p>
              <button
                type="button"
                onClick={() => {
                  setEndpoint((old) => ({
                    ...old,
                    mode: "mock",
                    routingPolicy: "local_only",
                    allowedPaths: { localModels: false, ollamaCloudModels: false, cloudProviders: false },
                    configured: false,
                  }));
                  setDemoSessionEnabled(false);
                }}
              >
                Configure simulated demo
              </button>
              {endpoint.mode === "mock" ? (
                <button
                  type="button"
                  data-testid="enable-demo-session"
                  disabled={!demoConfigured || demoSessionEnabled}
                  onClick={() => {
                    setDemoSessionEnabled(true);
                    setNotice("Simulated demo enabled for this session. No AI model will be used.");
                  }}
                >
                  {demoSessionEnabled ? "Simulated demo enabled" : "Enable simulated demo for this session"}
                </button>
              ) : null}
            </div>
          </details>
          <div className="actions">
            <button type="button" disabled={busy === "endpoint" || settingsBlocked} onClick={() => void task("endpoint", async () => {
              const result = await api.testEndpointConnection(endpoint);
              setNotice(result.message);
            })}>Check allowed paths</button>
            <button className="primary" data-testid="save-endpoint" type="button" disabled={busy === "endpoint" || (endpoint.mode !== "mock" && settingsBlocked)} onClick={() => void task("endpoint", async () => {
              await api.saveEndpointConfig(endpoint);
              setEndpoint((old) => ({ ...old, configured: true }));
              setDemoSessionEnabled(false);
              setNotice(endpoint.mode === "mock"
                ? "Simulated demo configured but inactive."
                : "Intelligence access saved. Career Agent will route prompts automatically.");
            })}>{busy === "endpoint" ? "Working…" : "Save intelligence access"}</button>
          </div>
        </section>
      </div>
    );
  };

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
    status: Status,
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
        <nav className={view === "chat" ? "compact-nav" : ""}>
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
        {view === "chat" ? (
          <section className="sidebar-chats" aria-label="Career Agent conversations">
            <div className="sidebar-chats-heading">
              <span>Chats</span>
              <button type="button" aria-label="New chat" onClick={createNewChat} disabled={busy === "chat"}>＋</button>
            </div>
            <ul className="session-list" aria-label="Saved conversations">
              {sessions.map((session) => (
                <li className={session.selected ? "active" : ""} key={session.id}>
                  {deletingSessionId === session.id ? (
                    <div className="session-delete-confirm" role="group" aria-live="assertive" aria-label={`Delete ${session.name}?`}>
                      <span>Delete this chat?</span>
                      <div>
                        <button type="button" autoFocus onClick={() => setDeletingSessionId(null)}>Cancel</button>
                        <button type="button" className="danger" onClick={() => deleteChat(session.id)} disabled={busy === "chat"}>Delete</button>
                      </div>
                    </div>
                  ) : renamingSessionId === session.id ? (
                    <form onSubmit={(event) => { event.preventDefault(); saveChatName(session.id); }}>
                      <input
                        aria-label={`Rename ${session.name}`}
                        autoFocus
                        value={renameSessionName}
                        onChange={(event) => setRenameSessionName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setRenamingSessionId(null);
                            setRenameSessionName("");
                          }
                         }}
                       />
                       <button type="submit" aria-label={`Save ${session.name} name`}>✓</button>
                     </form>
                  ) : (
                    <>
                      <button type="button" className="session-open" aria-current={session.selected ? "true" : undefined} onClick={() => void task("chat", async () => {
                        await api.selectChatSession(session.id);
                        await loadChat();
                        setChatFailure(null);
                        setSessionMenuId(null);
                      })}>{session.name}</button>
                      <button
                        type="button"
                        className="session-actions-trigger"
                        aria-label={`Chat options for ${session.name}`}
                        aria-haspopup="menu"
                        aria-expanded={sessionMenuId === session.id}
                        onClick={() => setSessionMenuId((current) => current === session.id ? null : session.id)}
                      >···</button>
                      {sessionMenuId === session.id ? (
                        <div className="session-actions-menu" role="menu">
                          <button type="button" role="menuitem" onClick={() => {
                            setSessionMenuId(null);
                            setRenamingSessionId(session.id);
                            setRenameSessionName(session.name);
                          }}>Rename</button>
                          <button type="button" role="menuitem" className="danger" onClick={() => {
                            setSessionMenuId(null);
                            setDeletingSessionId(session.id);
                          }}>Delete</button>
                        </div>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="sidebar-footer">
          <button
            className="settings-link"
            type="button"
            onClick={() => go("settings")}
          >
            <span>Intelligence access</span>
            <small>
              {realEndpointReady
                ? `${Number(localPathAllowed) + Number(ollamaCloudPathAllowed) + Number(cloudPathAllowed)} path${Number(localPathAllowed) + Number(ollamaCloudPathAllowed) + Number(cloudPathAllowed) === 1 ? "" : "s"} allowed`
                : demoSessionEnabled
                  ? "Simulated demo · no AI"
                  : "Setup required"}
            </small>
          </button>
          <div className="privacy">
            <strong>{ollamaCloudPathAllowed || cloudPathAllowed ? "● Cloud permitted" : "● On-device only"}</strong>
            <small>{ollamaCloudPathAllowed || cloudPathAllowed ? "Career Agent may use allowed cloud intelligence when needed." : "Registered context stays on this computer."}</small>
          </div>
        </div>
      </aside>
      <main className={view === "chat" ? "chat-main" : ""}>
        <header>
          <div>
            <i className={realEndpointReady ? "connected" : ""} />
            {view === "chat"
              ? sessions.find((session) => session.selected)?.name ?? "New chat"
              : realEndpointReady
                ? "Career Agent ready"
              : demoSessionEnabled
                ? "Simulated demo · no AI model"
                : "Intelligence setup required"}
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
                : "Choose allowed intelligence sources, or explicitly enable the demo in Intelligence access."}
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
        <span>Add workspaces and choose which intelligence sources Career Agent may use.</span>
      </div>
      <div>
        <button type="button" onClick={() => onGo("sources")}>
          Workspaces
        </button>
        <button type="button" onClick={() => onGo("settings")}>
          Intelligence access
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
