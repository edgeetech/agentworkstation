import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import type {
  ChatActivity,
  ChatExchange,
  ChatContextUsage,
  ChatMode,
  ChatSessionRecord,
  AgentSummary,
  DemoAudit,
  EndpointConfig,
  PendingAction,
  LocalModel,
  ProviderConnection,
  OnboardingStep,
  ProposalTally,
  UsageLedgerSettings,
  ReminderSettings,
  UpdateReadyInfo,
  WorkspaceRecord,
} from "../shared/api";
import {
  SessionsSidebar,
  shortcutLabel,
  type AgentNavigationItem,
  type AgentView,
} from "./features/sessions/SessionsSidebar";
import { SessionInspector } from "./features/inspector/SessionInspector";
import { MessageContent } from "./features/chat/MessageContent";
import { ChatView, type FailedChat, type PendingChat } from "./features/chat/ChatView";
import { CommandPalette, type PaletteItem } from "./features/shell/CommandPalette";
import { ConnectPanel } from "./features/intelligence/ConnectPanel";
import { Icon } from "./features/shell/icons";
import { detectPlatform, useTheme } from "./features/shell/theme";
import { PublicationSetupPanel } from "./features/publication/PublicationSetupPanel";
import { SpecialistAvatar } from "./features/agents/SpecialistAvatar";
import {
  moveProvider,
  providerModelLabel,
  selectedProviderIds,
  toggleProvider,
} from "./features/intelligence/providerSelection";
import { I18nProvider, useI18n, type Translator } from "./i18n";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

type View = AgentView;
type Busy =
  | "workspace"
  | "endpoint"
  | "chat"
  | "audit"
  | "proposal"
  | "approval"
  | "usageLedger"
  | null;
const careerNav = (t: Translator): AgentNavigationItem[] => [
  { id: "chat", label: t('nav.careerChat'), hint: t('nav.careerChatHint') },
  { id: "audit", label: t('nav.careerAudit'), hint: t('nav.careerAuditHint') },
  { id: "changes", label: t('nav.reviewChanges'), hint: t('nav.reviewChangesHint') },
  { id: "sources", label: t('nav.workspaces'), hint: t('nav.careerWorkspacesHint') },
];
const generalAgentNav = (agentName: string, t: Translator): AgentNavigationItem[] => [
  { id: "chat", label: t('nav.specialistChat', { name: agentName }), hint: t('nav.specialistChatHint') },
  { id: "sources", label: t('nav.workspaces'), hint: t('nav.specialistWorkspacesHint') },
];
const bloggerNav = (t: Translator): AgentNavigationItem[] => [
  { id: "chat", label: t('nav.bloggerChat'), hint: t('nav.bloggerChatHint') },
  { id: "publication", label: t('nav.publishing'), hint: t('nav.publishingHint') },
  { id: "sources", label: t('nav.workspaces'), hint: t('nav.bloggerWorkspacesHint') },
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
  t: Translator,
): string =>
  source.label ??
  source.url ??
  source.relativePath ??
  source.commitSha ??
  source.workspaceId ??
  t('app.localEvidence');

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

const availabilityLabel = (value: LocalModel["availability"] | ProviderConnection["availability"], t: Translator): string => {
  if (value === "limited") return t('app.usageLimited');
  if (value === "unavailable") return t('app.unavailable');
  if (value === "available") return t('app.available');
  return t('app.discovered');
};

const modelSize = (bytes: number, t: Translator): string => bytes > 0 ? `${(bytes / (1024 ** 3)).toFixed(1)} GB` : t('app.cloudManaged');

function App(): JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const api = window.agentWorkstation;
  const [view, setView] = useState<View>("chat");
  const [audit, setAudit] = useState<DemoAudit | null>(null);
  const [auditSessionId, setAuditSessionId] = useState<string | null>(null);
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
  const [contextUsage, setContextUsage] = useState<ChatContextUsage | null>(null);
  const [sessions, setSessions] = useState<ChatSessionRecord[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep | null>(null);
  const [proposalTally, setProposalTally] = useState<ProposalTally | null>(null);
  const [preferredAgentId, setPreferredAgentId] = useState<string | undefined>();
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [pendingChatInput, setPendingChatInput] = useState<PendingChat | null>(null);
  const [chatFailure, setChatFailure] = useState<FailedChat | null>(null);
  const [chatActivity, setChatActivity] = useState<ChatActivity[]>([]);
  const [streamedReply, setStreamedReply] = useState("");
  const streamedReplyRef = useRef("");
  const [freshReply, setFreshReply] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pendingRequestId = useRef<string | null>(null);
  const selectedSessionIdRef = useRef<string | undefined>(undefined);
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
  const [usageLedgerSettings, setUsageLedgerSettings] = useState<UsageLedgerSettings>({ enabled: true, path: "" });
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings>({ accountantDeadlines: true });
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState<UpdateReadyInfo | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 900);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const automaticLocalModel = chooseAutomaticLocalModel(localModels);
  const automaticCloudModel = chooseAutomaticCloudModel(localModels);
  const localPathAllowed = endpoint.mode !== "mock" && (endpoint.allowedPaths?.localModels ?? endpoint.mode === "local");
  const cloudPathAllowed = endpoint.mode !== "mock" && (endpoint.allowedPaths?.cloudProviders
    ?? (endpoint.mode === "delegated" || endpoint.routingPolicy !== "local_only"));
  const ollamaCloudPathAllowed = endpoint.mode !== "mock" && (endpoint.allowedPaths?.ollamaCloudModels ?? false);
  const localEndpointReady = endpoint.configured === true && localPathAllowed && automaticLocalModel !== undefined;
  const allowedProviderIds = selectedProviderIds(endpoint);
  const allowedProviderConnections = allowedProviderIds
    .map((id) => providerConnections.find((provider) => provider.id === id))
    .filter((provider): provider is ProviderConnection => provider !== undefined);
  const automaticProvider = allowedProviderConnections.find(providerReady);
  const recommendedProvider = providerConnections.find(providerReady);
  const cloudEndpointReady = endpoint.configured === true && cloudPathAllowed
    && allowedProviderConnections.some(providerAvailable);
  const ollamaCloudEndpointReady = endpoint.configured === true && ollamaCloudPathAllowed && automaticCloudModel !== undefined;
  const realEndpointReady = localEndpointReady || ollamaCloudEndpointReady || cloudEndpointReady;
  const demoConfigured =
    endpoint.configured === true && endpoint.mode === "mock";
  const endpointReady = realEndpointReady || demoSessionEnabled;
  const workspaceReady = workspaces.length > 0;
  const ready = endpointReady && workspaceReady;
  const realReady = realEndpointReady && workspaceReady;
  const selectedChatSession = sessions.find((session) => session.selected);
  selectedSessionIdRef.current = selectedChatSession?.id;
  const visiblePendingChat = pendingChatInput?.sessionId === selectedChatSession?.id ? pendingChatInput : null;
  const visibleChatFailure = chatFailure?.sessionId === selectedChatSession?.id ? chatFailure : null;
  const chatDraftKey = selectedChatSession?.id ?? "no-session";
  const chatInput = chatDrafts[chatDraftKey] ?? "";
  const setChatInput = (value: string): void => {
    setChatDrafts((current) => {
      if (value) return { ...current, [chatDraftKey]: value };
      if (!Object.prototype.hasOwnProperty.call(current, chatDraftKey)) return current;
      const next = { ...current };
      delete next[chatDraftKey];
      return next;
    });
  };
  const sessionAgent = agents.find((agent) => agent.id === selectedChatSession?.agentId);
  const preferredAgent = agents.find((agent) => agent.id === preferredAgentId);
  const selectedAgent = (view === "chat" ? sessionAgent : preferredAgent ?? sessionAgent)
    ?? agents.find((agent) => agent.id === "career")
    ?? agents[0];
  const selectedAgentName = selectedAgent?.name ?? "Agent";
  const agentNavigation = selectedAgent?.id === "career"
    ? careerNav(t)
    : selectedAgent?.id === "blogger"
      ? bloggerNav(t)
      : generalAgentNav(selectedAgentName, t);
  const selectedSessionWorkspace = workspaces.find((workspace) => workspace.id === selectedChatSession?.workspaceId);
  const activeSessionActions = selectedChatSession
    ? actions.filter((action) => action.sessionId === selectedChatSession.id)
    : [];
  const activeAuditSources = audit && auditSessionId === selectedChatSession?.id
    ? audit.result.sourceReferences
    : [];
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
  const loadChatContextUsage = useCallback(async (): Promise<void> => {
    if (typeof api.getChatContextUsage !== "function") {
      setContextUsage(null);
      return;
    }
    setContextUsage(await api.getChatContextUsage());
  }, [api]);
  const loadChat = async (): Promise<void> => {
    const nextSessions = await api.listChatSessions();
    const activeSession = nextSessions.find((session) => session.selected);
    const [nextHistory, nextOnboarding] = await Promise.all([
      api.getChatHistory(),
      activeSession ? api.getAgentOnboarding(activeSession.agentId) : Promise.resolve(null),
    ]);
    setSessions(nextSessions);
    setHistory(nextHistory);
    setOnboardingStep(nextOnboarding);
    setProposalTally(
      activeSession && typeof api.getProposalTally === "function"
        ? await api.getProposalTally(activeSession.agentId)
        : null,
    );
    await loadChatContextUsage();
  };
  const loadLocalModels = useCallback(async (baseUrl: string): Promise<void> => {
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
  }, [api]);
  const loadProviderConnections = useCallback(async (): Promise<void> => {
    const providers = await api.listProviderConnections();
    setProviderConnections(providers);
    setEndpoint((old) => {
      const providerIds = selectedProviderIds(old);
      const preferred = providers.find((provider) => provider.id === providerIds[0]);
      if (!preferred || (old.providerId === preferred.id && old.providerModelId === preferred.defaultModel)) return old;
      return {
        ...old,
        providerId: preferred.id,
        providerModelId: preferred.defaultModel,
        providerIds,
      };
    });
  }, [api]);
  useEffect(() => {
    const sidebarQuery = window.matchMedia("(min-width: 900px)");
    const inspectorQuery = window.matchMedia("(min-width: 1200px)");
    const syncSidebar = (event: MediaQueryListEvent): void => setSidebarOpen(event.matches);
    const syncInspector = (event: MediaQueryListEvent): void => {
      if (!event.matches) setInspectorOpen(false);
    };
    sidebarQuery.addEventListener("change", syncSidebar);
    inspectorQuery.addEventListener("change", syncInspector);
    return () => {
      sidebarQuery.removeEventListener("change", syncSidebar);
      inspectorQuery.removeEventListener("change", syncInspector);
    };
  }, []);
  useEffect(() => {
    void Promise.all([
      api.getEndpointConfig(),
      api.listWorkspaces(),
      api.listPendingActions(),
      api.listChatSessions(),
      api.getChatHistory(),
      api.listAgents(),
    ])
      .then(([config, records, pending, nextSessions, nextHistory, nextAgents]) => {
        setEndpoint(config);
        setWorkspaces(records);
        setActions(pending);
        setSessions(nextSessions);
        setHistory(nextHistory);
        setAgents(nextAgents);
        const activeSession = nextSessions.find((session) => session.selected);
        if (activeSession) {
          void api.getAgentOnboarding(activeSession.agentId).then(setOnboardingStep);
          if (typeof api.getProposalTally === "function") {
            void api.getProposalTally(activeSession.agentId).then(setProposalTally);
          }
        }
        setProposalWorkspace(chooseProposalWorkspace(records));
        void loadChatContextUsage().catch(() => setContextUsage(null));
        if ((config.allowedPaths?.localModels ?? config.mode === "local") || config.allowedPaths?.ollamaCloudModels) {
          void loadLocalModels(config.baseUrl);
        }
      })
      .catch((value: unknown) => setError(messageOf(value)));
    if (typeof api.getUsageLedgerSettings === "function") {
      void api.getUsageLedgerSettings().then(setUsageLedgerSettings).catch(() => undefined);
    }
    void loadProviderConnections()
      .catch(() => setProviderConnections([]));
    void api.getReminderSettings().then(setReminderSettings).catch(() => undefined);
    if (typeof api.getAppVersion === "function") {
      void api.getAppVersion().then(setAppVersion).catch(() => setAppVersion(null));
    }
  }, [api, loadChatContextUsage, loadLocalModels, loadProviderConnections]);
  useEffect(() => {
    if (typeof api.onUpdateReady !== "function") return undefined;
    return api.onUpdateReady((info) => setUpdateReady(info));
  }, [api]);
  useEffect(() => {
    if (typeof api.onChatActivity !== "function") return undefined;
    return api.onChatActivity((activity) => {
      if (activity.requestId !== pendingRequestId.current) return;
      if (activity.type === "text_delta") {
        streamedReplyRef.current += activity.delta;
        setStreamedReply(streamedReplyRef.current);
        return;
      }
      if (activity.type === "thinking") {
        streamedReplyRef.current = "";
        setStreamedReply("");
      }
      setChatActivity((current) => [...current, activity].slice(-24));
    });
  }, [api]);
  const go = (next: View): void => {
    setView(next);
    setError(null);
    setNotice(null);
  };

  const createNewChat = (agentId?: string): void => {
    const targetAgentId = agentId ?? selectedAgent?.id;
    if (!targetAgentId) return;
    const targetAgent = agents.find((agent) => agent.id === targetAgentId);
    void task("chat", async () => {
      await api.createChatSession({
        name: `${targetAgent?.name ?? "Agent"} conversation`,
        agentId: targetAgentId,
        intelligencePreference: "auto",
        permissionMode: "interactive",
        isolationMode: "read_only",
      });
      setPreferredAgentId(targetAgentId);
      await loadChat();
      setView("chat");
    });
  };

  const openAgent = (agentId: string): void => {
    setPreferredAgentId(agentId);
    const latest = sessions
      .filter((session) => session.agentId === agentId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (latest) {
      openSession(latest.id);
      return;
    }
    createNewChat(agentId);
  };

  const openAgentRef = useRef(openAgent);
  openAgentRef.current = openAgent;
  useEffect(() => {
    if (typeof api.onOpenAgent !== "function") return undefined;
    return api.onOpenAgent(({ agentId }) => openAgentRef.current(agentId));
  }, [api]);

  const openSession = (sessionId: string): void => {
    void task("chat", async () => {
      await api.selectChatSession(sessionId);
      const session = sessions.find((candidate) => candidate.id === sessionId);
      setPreferredAgentId(session?.agentId);
      setAudit(null);
      setAuditSessionId(null);
      await Promise.all([loadChat(), loadWorkspaces(), loadActions()]);
      setView("chat");
    });
  };

  const saveChatName = (sessionId: string, nextName: string): void => {
    const name = nextName.trim();
    if (!name) return;
    void task("chat", async () => {
      await api.renameChatSession(sessionId, name);
      await loadChat();
    });
  };

  const saveAgentName = (agentId: string, nextName: string): void => {
    const name = nextName.trim();
    if (!name) return;
    void task("chat", async () => {
      await api.renameAgentDisplayName(agentId, name);
      setAgents(await api.listAgents());
      setNotice(t('app.nameChanged', { name }));
    });
  };

  const deleteChat = (sessionId: string): void => {
    void task("chat", async () => {
      await api.deleteChatSession(sessionId);
      setChatDrafts((current) => {
        if (!Object.prototype.hasOwnProperty.call(current, sessionId)) return current;
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      await loadChat();
      setAudit(null);
      setAuditSessionId(null);
      setChatFailure((current) => current?.sessionId === sessionId ? null : current);
      setPendingChatInput((current) => current?.sessionId === sessionId ? null : current);
    });
  };

  const changeChatMode = (mode: ChatMode): void => {
    if (!selectedChatSession || selectedChatSession.mode === mode) return;
    if (typeof api.setChatSessionMode !== "function") {
      setError(t('app.restartModes'));
      return;
    }
    void task("chat", async () => {
      await api.setChatSessionMode(selectedChatSession.id, mode);
      await loadChat();
    });
  };

  const addFolderFromChat = (): void => {
    void task("workspace", async () => {
      const directory = await api.pickWorkspaceDirectory();
      if (!directory) return;
      const existing = workspaces.find((workspace) => workspace.rootPath.toLowerCase() === directory.toLowerCase());
      if (existing) {
        setNotice(t('chat.folderAlreadyAdded'));
        return;
      }
      const name = directory.split(/[\\/]/).filter(Boolean).pop() ?? 'folder';
      const base = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'folder';
      let id = base;
      for (let suffix = 2; workspaces.some((workspace) => workspace.id === id); suffix++) id = `${base}-${suffix}`;
      await api.registerWorkspace({ id, rootPath: directory, kind: 'project' });
      await loadWorkspaces();
      await loadChat();
      setNotice(t('chat.folderAdded', { name }));
    });
  };

  const openMemoryFile = (): void => {
    if (!selectedAgent) return;
    void api.openAgentMemoryFile(selectedAgent.id).catch((value: unknown) => setError(messageOf(value)));
  };

  const sendChat = (promptOverride?: string, modeOverride?: ChatMode, options?: { resume?: boolean }): void => {
    const prompt = (promptOverride ?? chatInput).trim();
    if (!prompt || busy === "chat" || !selectedChatSession) return;
    if (endpoint.mode === "mock" && !demoSessionEnabled) {
      go("settings");
      setNotice(t('demo.inactiveHelp'));
      return;
    }
    const mode = modeOverride ?? selectedChatSession?.mode ?? "autopilot";
    const sessionId = selectedChatSession.id;
    const requestId = crypto.randomUUID();
    if (promptOverride === undefined) setChatInput("");
    setChatFailure((current) => current?.sessionId === sessionId ? null : current);
    pendingRequestId.current = requestId;
    setChatActivity([]);
    streamedReplyRef.current = "";
    setStreamedReply("");
    setFreshReply(null);
    setPendingChatInput({ sessionId, requestId, prompt, mode, startedAt: Date.now() });
    void task("chat", async () => {
      try {
        const exchange = await api.sendChatMessage(prompt, requestId, sessionId, options);
        if (selectedSessionIdRef.current === sessionId) {
          setHistory((current) => [...current, exchange]);
          // A reply that already streamed in needs no reveal animation.
          setFreshReply(streamedReplyRef.current ? null : exchange.assistantMessage);
        }
        pendingRequestId.current = null;
        setPendingChatInput((current) => current?.requestId === requestId ? null : current);
        // Refresh in the background so the composer is usable the moment the reply lands.
        void loadChat().catch((value: unknown) => setError(messageOf(value)));
      } catch (value) {
        const message = chatErrorMessage(value);
        if (/abort|cancel/i.test(message)) {
          setChatDrafts((current) => current[sessionId] ? current : { ...current, [sessionId]: prompt });
          setNotice(t('app.messageCancelled'));
        } else {
          setChatFailure({ sessionId, prompt, message, mode });
        }
      } finally {
        if (pendingRequestId.current === requestId) pendingRequestId.current = null;
        setPendingChatInput((current) => current?.requestId === requestId ? null : current);
      }
    });
  };

  const cancelChat = (): void => {
    if (!visiblePendingChat) return;
    void api.cancelChatMessage(visiblePendingChat.requestId)
      .then((cancelled) => {
        if (!cancelled) {
          setNotice(t('app.cannotCancel'));
        }
      })
      .catch((value: unknown) => setError(messageOf(value)));
  };

  const approveAction = (actionId: string): void => {
    const action = actions.find((candidate) => candidate.id === actionId);
    void task("approval", async () => {
      await api.approvePendingAction(actionId);
      await loadActions();
      setNotice(action ? t('app.applied', { path: action.targetPath }) : t('app.approvedChange'));
    });
  };

  const rejectAction = (actionId: string): void => {
    void task("approval", async () => {
      await api.rejectPendingAction(actionId, "Rejected from desktop review");
      await loadActions();
      setNotice(t('app.proposalRejected'));
    });
  };

  const Home = (): JSX.Element => (
    <div className="page-stack">
      <section className="hero">
        <div>
          <p className="eyebrow">{selectedAgentName}</p>
          <h1>
            {selectedAgent?.id === "blogger"
              ? t('home.bloggerDescription')
              : t('home.careerDescription')}
          </h1>
          <p className="hero-copy">
            {t('home.heroCopy', { name: selectedAgentName })}
          </p>
        </div>
        <div className={`readiness ${realReady ? "ready" : ""}`}>
          <span>
            {realReady
              ? t('home.ready')
              : demoSessionEnabled
                ? t('home.simulated')
                : t('home.setupNeeded')}
          </span>
          <strong>
            {realReady
              ? t('home.intelligenceReady')
              : demoSessionEnabled
                ? t('home.noAi')
                : t('home.stepsComplete', { count: Number(workspaceReady) + Number(realEndpointReady) })}
          </strong>
        </div>
      </section>
      {!realReady ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t('home.firstRun')}</p>
              <h2>{t('home.finishSetup')}</h2>
            </div>
            <p>
              {t('home.localFiles')}
            </p>
          </div>
          <div className="step-grid">
            <button
              className={`step-card ${workspaceReady ? "complete" : ""}`}
              type="button"
              onClick={() => go("sources")}
            >
              <span>{workspaceReady ? "✓" : "1"}</span>
              <strong>{t('home.addWorkspaces')}</strong>
              <small>{t('home.addWorkspacesHelp')}</small>
            </button>
            <button
              className={`step-card ${realEndpointReady ? "complete" : ""}`}
              type="button"
              onClick={() => go("settings")}
            >
              <span>{realEndpointReady ? "✓" : "2"}</span>
              <strong>{t('home.chooseIntelligence')}</strong>
              <small>{t('home.chooseIntelligenceHelp')}</small>
            </button>
          </div>
        </section>
      ) : null}
      {selectedAgent?.id === "blogger" ? (
        <section className="workflow-grid">
          {selectedAgent.quickActions.slice(0, 3).map((action, index) => (
            <article key={action.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h2>{action.title}</h2>
              <p>{action.prompt}</p>
              <button type="button" disabled={!ready} onClick={() => createNewChat(selectedAgent.id)}>
                {t('home.startBlogger')}
              </button>
            </article>
          ))}
        </section>
      ) : <section className="workflow-grid">
        <article>
          <span>01</span>
          <h2>{t('home.ask')}</h2>
          <p>{t('home.askHelp')}</p>
          <button type="button" disabled={!ready} onClick={() => go("chat")}>
            {t('home.openCareer')}
          </button>
        </article>
        <article>
          <span>02</span>
          <h2>{t('home.audit')}</h2>
          <p>{t('home.auditHelp')}</p>
          <button type="button" disabled={!ready} onClick={() => go("audit")}>
            {t('audit.run')}
          </button>
        </article>
        <article>
          <span>03</span>
          <h2>{t('home.improve')}</h2>
          <p>{t('home.improveHelp')}</p>
          <button type="button" disabled={!ready} onClick={() => go("changes")}>
            {t('changes.title')}
          </button>
        </article>
      </section>}
    </div>
  );

  const connectProvider = (provider: ProviderConnection): void => {
    void task("endpoint", async () => {
      const config: EndpointConfig = {
        ...endpoint,
        mode: "local",
        providerIds: [provider.id],
        providerId: provider.id,
        providerModelId: provider.defaultModel,
        routingPolicy: "adaptive",
        allowedPaths: { localModels: false, ollamaCloudModels: false, cloudProviders: true },
      };
      await api.saveEndpointConfig(config);
      setEndpoint({ ...config, configured: true });
      setDemoSessionEnabled(false);
      setNotice(t('connect.connected', { name: provider.label }));
    });
  };

  const connectLocalModels = (): void => {
    void task("endpoint", async () => {
      const config: EndpointConfig = {
        ...endpoint,
        mode: "local",
        modelId: automaticLocalModel?.id ?? endpoint.modelId,
        ollamaModelIds: orderedAutomaticModelIds(localModels),
        providerIds: [],
        providerId: undefined,
        providerModelId: undefined,
        routingPolicy: "local_only",
        allowedPaths: { localModels: true, ollamaCloudModels: false, cloudProviders: false },
      };
      await api.saveEndpointConfig(config);
      setEndpoint({ ...config, configured: true });
      setDemoSessionEnabled(false);
      setNotice(t('connect.localConnected'));
    });
  };

  const Chat = (): JSX.Element => (
    <ChatView
      agent={selectedAgent}
      agentName={selectedAgentName}
      session={selectedChatSession}
      history={history}
      onboardingStep={onboardingStep}
      proposalTally={proposalTally}
      pending={visiblePendingChat}
      activity={chatActivity}
      streamedReply={streamedReply}
      failure={visibleChatFailure}
      freshReply={freshReply}
      draft={chatInput}
      busy={busy === "chat"}
      contextUsage={contextUsage}
      connectPanel={!realEndpointReady && !demoSessionEnabled && endpoint.mode !== "mock" ? (
        <ConnectPanel
          providers={providerConnections}
          localModelCount={localModels.filter((model) => model.location === "local" && model.toolCalling).length}
          busy={busy === "endpoint" || modelDiscoveryBusy}
          onUseProvider={connectProvider}
          onUseLocal={connectLocalModels}
          onRefresh={() => void task("endpoint", async () => {
            await Promise.all([loadLocalModels(endpoint.baseUrl), loadProviderConnections()]);
          })}
          onMore={() => go("settings")}
        />
      ) : null}
      onDraftChange={setChatInput}
      onSend={sendChat}
      onContinue={() => sendChat(t('chat.continueCommand'), undefined, { resume: true })}
      onCancel={cancelChat}
      onChangeMode={changeChatMode}
      onAddFolder={addFolderFromChat}
      onEditMemory={openMemoryFile}
      onManageSources={() => go("sources")}
      onRevealDone={() => setFreshReply(null)}
    />
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
                setAuditSessionId(selectedChatSession?.id ?? null);
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
      {!ready ? <Setup onGo={go} agentName={selectedAgentName} workspaceReady={workspaceReady} intelligenceReady={endpointReady} /> : null}
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
            <div className="agent-output"><MessageContent content={audit.result.content} /></div>
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
                  <strong>{sourceLabel(s, t)}</strong>
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
      {!ready ? <Setup onGo={go} agentName={selectedAgentName} workspaceReady={workspaceReady} intelligenceReady={endpointReady} /> : null}
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
        description="Register only the folders Career may inspect."
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
            <small>This role helps agents distinguish profile content from project evidence.</small>
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
                await loadChat();
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
                      await loadChat();
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
          <small>{model.location === "local" ? t('status.storedLocal', { size: modelSize(model.size, t) }) : t('status.ollamaCloud')}</small>
          {model.lastError ? <small className="status-error">{model.lastError}</small> : null}
        </div>
        <span className={`status-badge ${model.availability ?? "unknown"}`}>
          {model.toolCalling ? availabilityLabel(model.availability, t) : t('status.notCompatible')}
        </span>
      </article>
    );
    return (
      <div className="page-stack">
        <Heading
          eyebrow="Intelligence status"
          title={`Models ${selectedAgentName} can reach`}
          description={`Availability is informational. ${selectedAgentName} still chooses and falls back automatically within the access you allow.`}
          action={<button type="button" disabled={busy === "endpoint" || modelDiscoveryBusy} onClick={() => void task("endpoint", async () => {
            await Promise.all([loadLocalModels(endpoint.baseUrl), loadProviderConnections()]);
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
          <div className="section-heading"><div><p className="eyebrow">{t('status.providerClis')}</p><h2>{t('status.providers')}</h2></div><p>{t('status.providersHelp')}</p></div>
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
                  {providerReady(provider) ? availabilityLabel(provider.availability, t) : provider.installed ? t('status.signIn') : t('status.notInstalled')}
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
    const selectedPathReady = (localPathAllowed && Boolean(automaticLocalModel))
      || (ollamaCloudPathAllowed && Boolean(automaticCloudModel))
      || (cloudPathAllowed && allowedProviderConnections.some(providerAvailable));
    const settingsBlocked = !selectedPathReady;
    const setProviderPolicy = (providerId: string, allowed: boolean): void => {
      setEndpoint((old) => {
        const providerIds = toggleProvider(selectedProviderIds(old), providerId, allowed);
        const primary = providerConnections.find((provider) => provider.id === providerIds[0]);
        const cloudProviders = providerIds.length > 0;
        return {
          ...old,
          mode: "local",
          providerIds,
          providerId: primary?.id,
          providerModelId: primary?.defaultModel,
          routingPolicy: cloudProviders || ollamaCloudPathAllowed ? "adaptive" : "local_only",
          allowedPaths: {
            localModels: localPathAllowed,
            ollamaCloudModels: ollamaCloudPathAllowed,
            cloudProviders,
          },
          configured: false,
        };
      });
      setDemoSessionEnabled(false);
    };
    const reorderProvider = (providerId: string, offset: -1 | 1): void => {
      setEndpoint((old) => {
        const providerIds = moveProvider(selectedProviderIds(old), providerId, offset);
        const primary = providerConnections.find((provider) => provider.id === providerIds[0]);
        return {
          ...old,
          providerIds,
          providerId: primary?.id,
          providerModelId: primary?.defaultModel,
          configured: false,
        };
      });
    };
    return (
      <div className="page-stack">
        <Heading
          eyebrow={t('settings.eyebrow')}
          title={t('settings.title', { name: selectedAgentName })}
          description={t('settings.description', { name: selectedAgentName })}
        />
        <section className="availability-summary" aria-label={t('settings.availability')}>
          <span>{t('settings.onDeviceReady', { count: localModels.filter((model) => model.location === "local" && model.toolCalling && model.availability !== "unavailable").length })}</span>
          <span>{t('settings.cloudReady', { count: localModels.filter((model) => model.location === "cloud" && model.toolCalling && model.availability !== "limited" && model.availability !== "unavailable").length })}</span>
          <span><strong>{allowedProviderConnections.filter(providerAvailable).length}</strong> {t('settings.allowedProvidersReady')}</span>
          <button type="button" onClick={() => go("status")}>{t('settings.viewStatus')}</button>
        </section>
        <section className="panel form settings">
          <div className="permission-list">
            <button
              type="button"
              className={`permission-card ${localPathAllowed ? "allowed" : ""}`}
              aria-label={t('settings.allowLocal')}
              aria-pressed={localPathAllowed}
              onClick={() => {
                  const allowed = !localPathAllowed;
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
            >
              <span className="permission-copy">
                  <strong>{t('settings.localModels')}</strong>
                  <small>{t('settings.localHelp')}</small>
              </span>
              <span className="permission-state">
                <b>{automaticLocalModel ? t('app.available') : t('settings.noModel')}</b>
                <span className="toggle-switch" aria-hidden="true"><span /></span>
              </span>
            </button>
            <button
              type="button"
              className={`permission-card ${ollamaCloudPathAllowed ? "allowed" : ""}`}
              aria-label={t('settings.allowCloud')}
              aria-pressed={ollamaCloudPathAllowed}
              disabled={!ollamaCloudPathAllowed && !automaticCloudModel}
              onClick={() => {
                  const allowed = !ollamaCloudPathAllowed;
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
            >
              <span className="permission-copy">
                  <strong>{t('settings.cloudModels')}</strong>
                  <small>{t('settings.cloudHelp')}</small>
              </span>
              <span className="permission-state">
                <b>{automaticCloudModel ? t('app.discovered') : t('settings.noCloud')}</b>
                <span className="toggle-switch" aria-hidden="true"><span /></span>
              </span>
            </button>
            <button
              type="button"
              className={`permission-card ${cloudPathAllowed ? "allowed" : ""}`}
              aria-label={t('settings.allowProviders')}
              aria-pressed={cloudPathAllowed}
              disabled={!cloudPathAllowed && !recommendedProvider}
              onClick={() => {
                  const allowed = !cloudPathAllowed;
                  const providerIds = allowed
                    ? (allowedProviderIds.length > 0 ? allowedProviderIds : recommendedProvider ? [recommendedProvider.id] : [])
                    : [];
                  const primary = providerConnections.find((provider) => provider.id === providerIds[0]);
                  setEndpoint((old) => ({
                    ...old,
                    mode: "local",
                    providerId: primary?.id,
                    providerModelId: primary?.defaultModel,
                    providerIds,
                    routingPolicy: allowed || ollamaCloudPathAllowed ? "adaptive" : "local_only",
                    allowedPaths: {
                      localModels: localPathAllowed,
                      ollamaCloudModels: ollamaCloudPathAllowed,
                      cloudProviders: allowed && providerIds.length > 0,
                    },
                    configured: false,
                  }));
                  setDemoSessionEnabled(false);
                }}
            >
              <span className="permission-copy">
                  <strong>{t('settings.providers')}</strong>
                <small>{t('settings.providersHelp')}</small>
              </span>
              <span className="permission-state">
                <b>{automaticProvider
                  ? t('settings.allowedCount', { count: allowedProviderIds.length })
                  : recommendedProvider ? t('settings.chooseAllowedProviders') : t('settings.noProvider')}</b>
                <span className="toggle-switch" aria-hidden="true"><span /></span>
              </span>
            </button>
          </div>
            {noPathAllowed ? <div className="inline-warning" role="alert">{t('settings.allowOne')}</div> : null}
          {ollamaCloudPathAllowed || cloudPathAllowed ? (
            <div className="privacy-callout">
                <strong>{t('settings.cloudAllowed')}</strong>
                <span>{t('settings.cloudAllowedHelp')}</span>
            </div>
          ) : null}
          <details className="settings-details">
              <summary>{t('settings.ollamaDetails')}</summary>
            <div className="details-content">
              <label>
                    <span>{t('settings.endpoint')}</span>
                <input value={endpoint.baseUrl} onChange={(event) => setEndpoint((old) => ({ ...old, baseUrl: event.target.value, configured: false }))} />
              </label>
              <div className="actions model-discovery">
                <button type="button" disabled={modelDiscoveryBusy} onClick={() => void loadLocalModels(endpoint.baseUrl)}>
                    {modelDiscoveryBusy ? t('settings.finding') : t('settings.refreshModels')}
                </button>
                {modelDiscoveryError ? <small>{modelDiscoveryError}</small> : null}
                <small>
                  {t('settings.discoverySummary', {
                    local: localModels.filter((model) => model.location === "local").length,
                    cloud: localModels.filter((model) => model.location === "cloud").length,
                    compatible: localModels.filter((model) => model.toolCalling).length,
                  })}
                </small>
              </div>
            </div>
          </details>
          <details className="settings-details">
            <summary>{t('settings.providerConnections')}</summary>
            <div className="details-content provider-policy-list">
              <p className="provider-policy-help">{t('settings.providerPolicyHelp')}</p>
              {providerConnections.map((provider) => {
                const priority = allowedProviderIds.indexOf(provider.id);
                const allowed = priority >= 0;
                const selectable = providerReady(provider);
                return (
                  <article className={`provider-policy-row ${allowed ? "allowed" : "blocked"}`} key={provider.id}>
                    <button
                        type="button"
                        className="provider-allow"
                        aria-pressed={allowed}
                        disabled={!allowed && !selectable}
                        onClick={() => setProviderPolicy(provider.id, !allowed)}
                        aria-label={t('settings.allowProvider', { provider: provider.label })}
                    >
                      <span className="provider-priority" aria-hidden="true">{allowed ? priority + 1 : "—"}</span>
                      <span className="toggle-switch compact" aria-hidden="true"><span /></span>
                    </button>
                    <div className="provider-policy-copy">
                      <strong>{provider.label}</strong>
                      <small>{provider.detail}</small>
                      <small>{provider.version ? `${provider.version} · ` : ""}{t('settings.modelSelection', {
                        model: provider.modelLabel
                          ?? (providerModelLabel(provider) === 'provider-default'
                            ? t('settings.providerSelectedModel')
                            : providerModelLabel(provider)),
                      })}</small>
                    </div>
                    <div className="provider-policy-state">
                      <span className={`status-badge ${provider.availability ?? "unknown"}`}>
                        {providerReady(provider) ? availabilityLabel(provider.availability, t) : provider.installed ? t('status.signIn') : t('status.notInstalled')}
                      </span>
                      <strong>{allowed ? t('settings.priority', { priority: priority + 1 }) : t('settings.notAllowed')}</strong>
                      {allowed ? (
                        <span className="provider-order-actions">
                          <button type="button" disabled={priority === 0} onClick={() => reorderProvider(provider.id, -1)} aria-label={t('settings.moveProviderUp', { provider: provider.label })}>↑</button>
                          <button type="button" disabled={priority === allowedProviderIds.length - 1} onClick={() => reorderProvider(provider.id, 1)} aria-label={t('settings.moveProviderDown', { provider: provider.label })}>↓</button>
                        </span>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </details>
          <details className="settings-details">
              <summary>{t('settings.offlineDemo')}</summary>
            <div className="details-content demo-settings">
                <p>{t('settings.demoHelp')}</p>
              <button
                className="secondary"
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
                {t('settings.configureDemo')}
              </button>
              {endpoint.mode === "mock" ? (
                <button
                  className="secondary"
                  type="button"
                  data-testid="enable-demo-session"
                  disabled={!demoConfigured || demoSessionEnabled}
                  onClick={() => {
                    setDemoSessionEnabled(true);
                    setNotice(t('settings.demoEnabledNotice'));
                  }}
                >
                  {demoSessionEnabled ? t('settings.demoEnabled') : t('settings.enableDemo')}
                </button>
              ) : null}
            </div>
          </details>
          <details className="settings-details" open>
            <summary>{t('settings.notifications')}</summary>
            <div className="details-content">
              <button
                type="button"
                className={`permission-card ${reminderSettings.accountantDeadlines ? "allowed" : ""}`}
                aria-label={t('settings.remindDeadlines')}
                aria-pressed={reminderSettings.accountantDeadlines}
                onClick={() => {
                  const next = { accountantDeadlines: !reminderSettings.accountantDeadlines };
                  setReminderSettings(next);
                  void api.setReminderSettings(next);
                }}
              >
                <span className="permission-copy">
                  <strong>{t('settings.remindDeadlines')}</strong>
                  <small>{t('settings.remindDeadlinesHelp')}</small>
                </span>
                <span className="permission-state">
                  <span className="toggle-switch" aria-hidden="true"><span /></span>
                </span>
              </button>
            </div>
          </details>
          <details className="settings-details">
            <summary>{t('settings.usageLedgerTitle')}</summary>
            <div className="details-content usage-ledger-settings">
              <button
                type="button"
                className={`permission-card ${usageLedgerSettings.enabled ? "allowed" : ""}`}
                aria-label={t('settings.usageLedgerToggleLabel')}
                aria-pressed={usageLedgerSettings.enabled}
                disabled={busy === "usageLedger"}
                onClick={() => void task("usageLedger", async () => {
                  const next = await api.setUsageLedgerEnabled(!usageLedgerSettings.enabled);
                  setUsageLedgerSettings(next);
                })}
              >
                <span className="permission-copy">
                  <strong>{t('settings.usageLedgerToggleLabel')}</strong>
                  <small>{t('settings.usageLedgerHelp', { path: usageLedgerSettings.path })}</small>
                </span>
                <span className="permission-state">
                  <span className="toggle-switch" aria-hidden="true"><span /></span>
                </span>
              </button>
              <div className="actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void task("usageLedger", async () => {
                    await api.openUsageLedgerFolder();
                  })}
                >
                  {t('settings.usageLedgerOpenFolder')}
                </button>
              </div>
            </div>
          </details>
          <div className="actions">
            <button type="button" disabled={busy === "endpoint" || settingsBlocked} onClick={() => void task("endpoint", async () => {
              const result = await api.testEndpointConnection(endpoint);
              setNotice(result.message);
              })}>{t('settings.checkPaths')}</button>
            <button className="primary" data-testid="save-endpoint" type="button" disabled={busy === "endpoint" || (endpoint.mode !== "mock" && settingsBlocked)} onClick={() => void task("endpoint", async () => {
              await api.saveEndpointConfig(endpoint);
              setEndpoint((old) => ({ ...old, configured: true }));
              setDemoSessionEnabled(false);
              setNotice(endpoint.mode === "mock"
                  ? t('settings.demoInactive')
                  : t('settings.saved'));
              })}>{busy === "endpoint" ? t('settings.working') : t('settings.save')}</button>
          </div>
        </section>
        {appVersion ? <p className="app-version">{t('settings.appVersion', { version: appVersion })}</p> : null}
      </div>
    );
  };

  const Publication = (): JSX.Element => (
    <div className="page-stack">
      <Heading
        eyebrow="Blogger delivery"
        title="Publishing"
        description="Configure a destination once, then review website and LinkedIn actions separately for every article."
      />
      <PublicationSetupPanel
        api={api}
        workspaces={workspaces}
        onError={setError}
        onNotice={setNotice}
      />
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
        {agents.map((agent) => (
          <article className={`panel agent-card agent-tone-${agent.id} ${agent.id === selectedAgent?.id ? "active-agent" : ""}`} key={agent.id}>
            <SpecialistAvatar agentId={agent.id} name={agent.name} large />
            <div>
              <span className="pill">Available now</span>
              <h2>{agent.name}</h2>
              <p>{agent.description}</p>
            </div>
            <button
              className="primary"
              type="button"
              onClick={() => {
                setPreferredAgentId(agent.id);
                go("home");
              }}
            >
              Open {agent.name}
            </button>
          </article>
        ))}
      </section>
    </div>
  );

  const pages: Record<View, () => JSX.Element> = {
    agents: Agents,
    home: Home,
    chat: Chat,
    audit: Audit,
    changes: Changes,
    publication: Publication,
    sources: Sources,
    status: Status,
    settings: Settings,
  };
  const orderedAgents = [...agents].sort((left, right) => {
    const priority = (id: string): number => ['career', 'blogger', 'accountant'].indexOf(id) >>> 0;
    return priority(left.id) - priority(right.id) || left.name.localeCompare(right.name);
  });
  const primaryProvider = allowedProviderConnections[0];
  const intelligenceSummary = realEndpointReady
    ? [
      cloudPathAllowed && primaryProvider ? primaryProvider.label : null,
      localPathAllowed && automaticLocalModel ? t('shell.onDevice') : null,
      ollamaCloudPathAllowed ? "Ollama Cloud" : null,
    ].filter(Boolean).join(" + ") || t('home.ready')
    : demoSessionEnabled ? t('home.simulated') : t('home.setupNeeded');
  const pageTitle = view === "chat"
    ? selectedChatSession?.name ?? t('chat.newChat')
    : agentNavigation.find((item) => item.id === view)?.label
      ?? (view === "settings" ? t('common.settings') : view === "status" ? t('shell.modelStatus') : selectedAgentName);

  const cancelRef = useRef<() => void>(() => undefined);
  cancelRef.current = cancelChat;
  const shortcutState = useRef({ openAgent, createNewChat, go, orderedAgents, pending: Boolean(visiblePendingChat) });
  shortcutState.current = { openAgent, createNewChat, go, orderedAgents, pending: Boolean(visiblePendingChat) };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey;
      const state = shortcutState.current;
      if (event.key === "Escape" && state.pending && !document.querySelector(".palette")) {
        cancelRef.current();
        return;
      }
      if (!mod || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "k") { event.preventDefault(); setPaletteOpen((open) => !open); }
      else if (key === "n" && !event.shiftKey) { event.preventDefault(); state.createNewChat(); }
      else if (key === "b") { event.preventDefault(); setSidebarOpen((open) => !open); }
      else if (key === ".") { event.preventDefault(); setInspectorOpen((open) => !open); }
      else if (key === ",") { event.preventDefault(); state.go("settings"); }
      else if (/^[1-9]$/.test(key)) {
        const agent = state.orderedAgents[Number(key) - 1];
        if (agent) { event.preventDefault(); state.openAgent(agent.id); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const themeLabel = t(theme.preference === "system" ? 'shell.themeSystem' : theme.preference === "light" ? 'shell.themeLight' : 'shell.themeDark');
  const paletteItems: PaletteItem[] = paletteOpen ? [
    {
      id: "new-chat", group: t('shell.actions'), label: t('shell.newChatWith', { name: selectedAgentName }),
      icon: "pencil", shortcut: shortcutLabel("N"), run: () => createNewChat(),
    },
    ...agentNavigation.filter((item) => item.id !== "chat").map((item): PaletteItem => ({
      id: `page-${item.id}`, group: t('shell.actions'), label: item.label, hint: item.hint,
      icon: item.id === "audit" ? "audit" : item.id === "changes" ? "review" : item.id === "publication" ? "globe" : "folder",
      run: () => go(item.id),
    })),
    { id: "settings", group: t('shell.actions'), label: t('shell.openSettings'), icon: "settings", shortcut: shortcutLabel(","), run: () => go("settings") },
    { id: "status", group: t('shell.actions'), label: t('shell.openStatus'), icon: "bolt", run: () => go("status") },
    { id: "theme", group: t('shell.actions'), label: t('shell.cycleTheme', { theme: themeLabel }), icon: theme.resolved === "dark" ? "moon" : "sun", run: theme.cycle },
    { id: "sidebar", group: t('shell.actions'), label: t('shell.toggleSidebar'), icon: "sidebar", shortcut: shortcutLabel("B"), run: () => setSidebarOpen((open) => !open) },
    { id: "context", group: t('shell.actions'), label: t('shell.toggleContext'), icon: "panel", shortcut: shortcutLabel("."), run: () => setInspectorOpen((open) => !open) },
    ...orderedAgents.map((agent, index): PaletteItem => ({
      id: `agent-${agent.id}`, group: t('shell.specialists'), label: t('shell.openSpecialist', { name: agent.name }),
      hint: agent.description, keywords: agent.id,
      leading: <SpecialistAvatar agentId={agent.id} name={agent.name} />,
      ...(index < 9 ? { shortcut: shortcutLabel(String(index + 1)) } : {}),
      run: () => openAgent(agent.id),
    })),
    ...[...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map((session): PaletteItem => {
      const agent = agents.find((candidate) => candidate.id === session.agentId);
      return {
        id: `session-${session.id}`, group: t('shell.conversations'), label: session.name,
        hint: [agent?.name ?? session.agentId, session.workspaceId].filter(Boolean).join(", "),
        leading: <SpecialistAvatar agentId={session.agentId} name={agent?.name ?? session.agentId} />,
        run: () => openSession(session.id),
      };
    }),
  ] : [];

  return (
    <div
      className={`shell agent-tone-${selectedAgent?.id ?? "default"} ${sidebarOpen ? "" : "sidebar-collapsed"} ${inspectorOpen ? "" : "inspector-collapsed"}`}
      data-platform={detectPlatform()}
    >
      <SessionsSidebar
        view={view}
        navigation={agentNavigation}
        agents={orderedAgents}
        activeAgent={selectedAgent}
        workspaces={workspaces}
        sessions={sessions}
        pendingActionCount={actions.length}
        busy={busy === "chat"}
        intelligenceReady={realEndpointReady}
        intelligenceSummary={intelligenceSummary}
        cloudPermitted={ollamaCloudPathAllowed || cloudPathAllowed}
        theme={theme.preference}
        onCycleTheme={theme.cycle}
        onOpenAgent={openAgent}
        onRenameAgent={saveAgentName}
        onNavigate={go}
        onNewSession={() => createNewChat(selectedAgent?.id)}
        onSearch={() => setPaletteOpen(true)}
        onOpenSession={openSession}
        onRenameSession={saveChatName}
        onDeleteSession={deleteChat}
      />
      <main className={view === "chat" ? "chat-main" : ""}>
        <header className="titlebar">
          <div className="titlebar-leading">
            <button
              type="button"
              className="shell-toggle icon-button"
              aria-label={sidebarOpen ? t('chat.hideNavigation') : t('chat.showNavigation')}
              aria-expanded={sidebarOpen}
              title={`${sidebarOpen ? t('chat.hideNavigation') : t('chat.showNavigation')} (${shortcutLabel("B")})`}
              onClick={() => setSidebarOpen((open) => !open)}
            >
              <Icon name="sidebar" />
            </button>
            {!sidebarOpen ? (
              <button
                type="button"
                className="icon-button"
                aria-label={t('shell.newChatWith', { name: selectedAgentName })}
                title={`${t('shell.newChatWith', { name: selectedAgentName })} (${shortcutLabel("N")})`}
                onClick={() => createNewChat()}
              >
                <Icon name="pencil" />
              </button>
            ) : null}
            <span className="titlebar-title">{pageTitle}</span>
            {selectedAgent ? <span className="titlebar-agent">{selectedAgentName}</span> : null}
          </div>
          <div className="header-actions">
            <button
              type="button"
              className={`icon-button ${inspectorOpen ? "active" : ""}`}
              onClick={() => setInspectorOpen((open) => !open)}
              aria-expanded={inspectorOpen}
              aria-label={inspectorOpen ? t('chat.hideContext') : t('chat.showContext')}
              title={`${inspectorOpen ? t('chat.hideContext') : t('chat.showContext')} (${shortcutLabel(".")})`}
            >
              <Icon name="panel" />
            </button>
          </div>
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
        <div className="toast-stack">
          {error ? <Toast kind="error" text={error} close={() => setError(null)} /> : null}
          {notice ? <Toast kind="success" text={notice} close={() => setNotice(null)} /> : null}
          {updateReady ? (
            <div className="toast update-ready" role="status">
              <span>{t('update.ready', { version: updateReady.version })}</span>
              <div className="toast-actions">
                <button
                  type="button"
                  className="text"
                  onClick={() => void api.installUpdateNow().catch((value: unknown) => setError(messageOf(value)))}
                >
                  {t('update.restartNow')}
                </button>
                <button type="button" aria-label="Dismiss" onClick={() => setUpdateReady(null)}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="page">
          {pages[view]()}
        </div>
      </main>
      <SessionInspector
        key={selectedChatSession?.id ?? "no-session"}
        session={selectedChatSession}
        agentName={sessionAgent?.name}
        workspace={selectedSessionWorkspace}
        history={history}
        additionalSources={activeAuditSources}
        actions={activeSessionActions}
        cloudPermitted={ollamaCloudPathAllowed || cloudPathAllowed}
        busy={busy === "approval"}
        listEntries={api.listWorkspaceEntries}
        readFile={api.readWorkspaceFile}
        onApprove={approveAction}
        onReject={rejectAction}
        onOpenReview={() => go("changes")}
        onError={setError}
      />
      {paletteOpen ? <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} /> : null}
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
function Setup({
  onGo,
  agentName,
  workspaceReady,
  intelligenceReady,
}: {
  onGo: (view: View) => void;
  agentName: string;
  workspaceReady: boolean;
  intelligenceReady: boolean;
}): JSX.Element {
  return (
    <div className="setup">
      <div>
        <strong>Finish setup to use {agentName}</strong>
        <span>{Number(workspaceReady) + Number(intelligenceReady)} of 2 steps complete. Your files stay local unless you allow a connected provider.</span>
      </div>
      <div>
        <button type="button" onClick={() => onGo("sources")}>
          {workspaceReady ? "✓ Workspaces ready" : "1 · Add workspaces"}
        </button>
        <button type="button" onClick={() => onGo("settings")}>
          {intelligenceReady ? "✓ Intelligence ready" : "2 · Intelligence access"}
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
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (kind === "error") return undefined;
    const timer = window.setTimeout(() => closeRef.current(), 5000);
    return () => window.clearTimeout(timer);
  }, [kind, text]);
  return (
    <div
      className={`toast ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <span>{text}</span>
      <button type="button" aria-label="Dismiss" onClick={close}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider><App /></I18nProvider>
  </React.StrictMode>,
);
