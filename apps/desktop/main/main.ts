import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron';
import { join } from 'node:path';
import { ApprovalService } from '../../../src/application/approvals';
import { CareerAgentLoader } from '../../../src/application/agents/CareerAgentLoader';
import { CareerAuditService } from '../../../src/application/careerAudit';
import {
  chatContextBudget,
  summarizeChatContextUsage,
  type ChatContextUsage,
} from '../../../src/application/chatContextUsage';
import { buildChatModeInstructions } from '../../../src/application/chatMode';
import { ContextBuilder } from '../../../src/application/context';
import { AgentRuntime } from '../../../src/application/intelligence';
import { AdaptiveRoutingIntelligenceAdapter, type RoutingAttempt } from '../../../src/application/intelligenceRouting';
import { PolicyGate, ToolExecutor, ToolRegistry } from '../../../src/application/tools';
import { buildWorkspaceAccessInstructions, type WorkspaceRegistration } from '../../../src/application/workspaces';
import type { IntelligencePort, ModelMessage, RoutingDecision, RoutingPolicy } from '../../../src/domain/intelligence';
import type { ChatMode, ChatSession } from '../../../src/domain/sessions';
import { FileSystemAgentDefinitionSource } from '../../../src/infrastructure/agents/FileSystemAgentDefinitionSource';
import { createFilesystemProposeWriteTool, filesystemReadTool } from '../../../src/infrastructure/filesystem/filesystemTools';
import { DefaultWorkspaceGateway } from '../../../src/infrastructure/filesystem/workspaceGateway';
import { gitDiffTool, gitLogTool, gitStatusTool } from '../../../src/infrastructure/git/gitTools';
import { OpenAICompatibleLocalAdapter } from '../../../src/infrastructure/intelligence/openaiCompatibleLocalAdapter';
import {
  DelegatedCliIntelligenceAdapter,
  NodeCliProcessRunner,
  delegatedProviders,
  getDelegatedProvider,
} from '../../../src/infrastructure/intelligence/delegatedCliAdapter';
import { MockIntelligenceAdapter } from '../../../src/infrastructure/mock/mockIntelligence';
import { DefaultNetworkGateway } from '../../../src/infrastructure/network/DefaultNetworkGateway';
import { SqlitePersistence } from '../../../src/infrastructure/persistence/sqlite';
import {
  IPC_CHANNELS,
  parseApprovePendingActionInput,
  parseChatMessageInput,
  parseCreateChatSessionInput,
  parseEndpointConfigInput,
  parseModelDiscoveryInput,
  parseProposeProfileUpdateInput,
  parseRegisterWorkspaceInput,
  parseWorkspacePathInput,
  parseRenameChatSessionInput,
  parseSetChatSessionModeInput,
  parseRejectPendingActionInput,
  parseWorkspaceIdInput,
} from './ipcContract';
import { getContentSecurityPolicy, isAllowedNavigation } from './security';
import { discoverOllamaModels, inspectOllamaModel, isOllamaCloudModel } from '../../../src/infrastructure/intelligence/ollamaModelDiscovery';

const userDataOverride = process.env.AW_USER_DATA_PATH?.trim();
if (userDataOverride) app.setPath('userData', userDataOverride);

const intelligenceHealth = new Map<string, {
  availability: 'available' | 'limited' | 'unavailable';
  lastError?: string;
  checkedAt: string;
}>();
const endpointSettingKey = 'endpoint-config';
let persistence: SqlitePersistence | null = null;

class DesktopMockIntelligenceAdapter implements IntelligencePort {
  async execute(
    request: { messages: ModelMessage[] },
    _context: { modelId: string; executionMode: 'local_only' },
    signal: AbortSignal,
  ): Promise<{ type: 'text'; content: string }> {
    const delayMs = Number(process.env.AW_MOCK_RESPONSE_DELAY_MS ?? 0);
    if (Number.isFinite(delayMs) && delayMs > 0) {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          clearTimeout(timeout);
          reject(signal.reason);
        };
        const timeout = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, Math.min(delayMs, 2_000));
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    const configuredError = !app.isPackaged && process.env.AW_RENDERER_MODE === 'file'
      ? process.env.AW_MOCK_RESPONSE_ERROR?.trim()
      : undefined;
    if (configuredError) throw new Error(configuredError);
    const lastUserMessage = [...request.messages].reverse().find((message) => message.role === 'user');
    const content = lastUserMessage?.content ?? '';
    return { type: 'text', content: `Mock response: ${content}` };
  }
}

function getPersistence(): SqlitePersistence {
  if (persistence) return persistence;
  persistence = new SqlitePersistence(join(app.getPath('userData'), 'agentworkstation.db'));
  return persistence;
}

function getCareerAgentDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'agents', 'career')
    : join(process.cwd(), 'src', 'agents', 'career');
}

async function ensureWorkspaceSelection(): Promise<{
  selectedWorkspaceId: string;
  registrations: WorkspaceRegistration[];
  gateway: DefaultWorkspaceGateway;
}> {
  const db = getPersistence();
  const workspaces = await db.listWorkspaces();
  if (workspaces.length === 0) throw new Error('No workspace configured');
  const selected = await db.getSelectedWorkspace() ?? (await db.listWorkspaces())[0];
  if (!selected) throw new Error('No workspace configured');
  const all = await db.listWorkspaces();
  const roots = Object.fromEntries(all.map((workspace) => [workspace.id, workspace.rootPath]));
  return { selectedWorkspaceId: selected.id, registrations: all, gateway: new DefaultWorkspaceGateway(roots) };
}

async function approvals(): Promise<{ service: ApprovalService; workspaceId: string }> {
  const db = getPersistence();
  const context = await ensureWorkspaceSelection();
  return {
    service: new ApprovalService(db, context.gateway),
    workspaceId: context.selectedWorkspaceId,
  };
}

type EndpointConfig = {
  mode: 'mock' | 'local' | 'delegated';
  baseUrl: string;
  modelId: string;
  providerId?: string;
  providerModelId?: string;
  routingPolicy?: RoutingPolicy;
  allowedPaths?: { localModels: boolean; ollamaCloudModels?: boolean; cloudProviders: boolean };
  ollamaModelIds?: string[];
  providerIds?: string[];
  configured?: boolean;
};

function localModelsAllowed(endpoint: EndpointConfig): boolean {
  return endpoint.allowedPaths?.localModels ?? endpoint.mode === 'local';
}

function cloudProvidersAllowed(endpoint: EndpointConfig): boolean {
  return endpoint.allowedPaths?.cloudProviders
    ?? (endpoint.mode === 'delegated' || (endpoint.routingPolicy !== undefined && endpoint.routingPolicy !== 'local_only'));
}

function ollamaCloudModelsAllowed(endpoint: EndpointConfig): boolean {
  return endpoint.allowedPaths?.ollamaCloudModels ?? false;
}

function externalIntelligenceAllowed(endpoint: EndpointConfig): boolean {
  return ollamaCloudModelsAllowed(endpoint) || cloudProvidersAllowed(endpoint);
}

function configuredOllamaModelIds(endpoint: EndpointConfig): string[] {
  return [...new Set(endpoint.ollamaModelIds?.length ? endpoint.ollamaModelIds : [endpoint.modelId])];
}

function healthKey(candidate: { id: string; modelId: string }): string {
  return `${candidate.id}/${candidate.modelId}`;
}

function recordRoutingAttempt(attempt: RoutingAttempt): void {
  intelligenceHealth.set(healthKey(attempt.candidate), {
    availability: attempt.status,
    ...(attempt.error ? { lastError: attempt.error } : {}),
    checkedAt: new Date().toISOString(),
  });
}

function routeCandidateReady(candidate: { id: string; modelId: string }): boolean {
  const health = intelligenceHealth.get(healthKey(candidate));
  if (!health || health.availability === 'available') return true;
  const ageMs = Date.now() - Date.parse(health.checkedAt);
  const cooldownMs = health.availability === 'limited' ? 5 * 60_000 : 30_000;
  return ageMs >= cooldownMs;
}

async function getEndpointConfig(): Promise<EndpointConfig> {
  const raw = await getPersistence().getSetting(endpointSettingKey);
  if (!raw) return {
    mode: 'local', baseUrl: 'http://localhost:11434', modelId: 'llama3.1', routingPolicy: 'local_only',
    allowedPaths: { localModels: true, ollamaCloudModels: false, cloudProviders: false },
    ollamaModelIds: ['llama3.1'], providerIds: [], configured: false,
  };
  try {
    const parsed = JSON.parse(raw) as Partial<EndpointConfig>;
    if (parsed.mode !== 'mock' && parsed.mode !== 'local' && parsed.mode !== 'delegated') throw new Error('Invalid mode');
    if (!parsed.baseUrl || !parsed.modelId) throw new Error('Invalid endpoint config');
    const allowedPaths = parsed.allowedPaths ?? {
      localModels: parsed.mode === 'local',
      ollamaCloudModels: false,
      cloudProviders: parsed.mode === 'delegated' || (parsed.routingPolicy !== undefined && parsed.routingPolicy !== 'local_only'),
    };
    if (allowedPaths.cloudProviders && !parsed.providerId) throw new Error('Invalid delegated provider');
    if (parsed.mode !== 'mock' && !allowedPaths.localModels && !allowedPaths.ollamaCloudModels && !allowedPaths.cloudProviders) throw new Error('No intelligence path allowed');
    const routingPolicy = allowedPaths.ollamaCloudModels || allowedPaths.cloudProviders ? 'adaptive' : 'local_only';
    return {
      mode: parsed.mode,
      baseUrl: parsed.baseUrl,
      modelId: parsed.modelId,
      ...(parsed.providerId ? { providerId: parsed.providerId } : {}),
      ...(parsed.providerModelId ? { providerModelId: parsed.providerModelId } : {}),
      ollamaModelIds: parsed.ollamaModelIds ?? [parsed.modelId],
      providerIds: parsed.providerIds ?? (parsed.providerId ? [parsed.providerId] : []),
      routingPolicy,
      allowedPaths,
      configured: true,
    };
  } catch {
    return {
      mode: 'local', baseUrl: 'http://localhost:11434', modelId: 'llama3.1', routingPolicy: 'local_only',
      allowedPaths: { localModels: true, ollamaCloudModels: false, cloudProviders: false },
      ollamaModelIds: ['llama3.1'], providerIds: [], configured: false,
    };
  }
}

async function saveEndpointConfig(config: EndpointConfig): Promise<void> {
  await getPersistence().setSetting(endpointSettingKey, JSON.stringify(config));
}

function effectiveRoutingPolicy(endpoint: EndpointConfig): RoutingPolicy {
  return externalIntelligenceAllowed(endpoint) ? 'adaptive' : 'local_only';
}

function createRoutingIntelligence(endpoint: EndpointConfig): {
  intelligence: IntelligencePort;
  router: AdaptiveRoutingIntelligenceAdapter | null;
} {
  if (endpoint.mode === 'mock') return { intelligence: new DesktopMockIntelligenceAdapter(), router: null };
  const ollamaIds = configuredOllamaModelIds(endpoint);
  const local = localModelsAllowed(endpoint)
    ? ollamaIds.filter((id) => !isOllamaCloudModel(id)).map((modelId) => ({
      id: 'ollama', label: 'Ollama on-device', location: 'local' as const, modelId,
      intelligence: new OpenAICompatibleLocalAdapter(endpoint.baseUrl, new DefaultNetworkGateway()),
    })).filter(routeCandidateReady)
    : [];
  const ollamaCloud = ollamaCloudModelsAllowed(endpoint)
    ? ollamaIds.filter(isOllamaCloudModel).map((modelId) => ({
      id: 'ollama-cloud', label: 'Ollama Cloud', location: 'external' as const, modelId,
      intelligence: new OpenAICompatibleLocalAdapter(endpoint.baseUrl, new DefaultNetworkGateway()),
    })).filter(routeCandidateReady)
    : [];
  const providerIds = endpoint.providerIds?.length
    ? endpoint.providerIds
    : endpoint.providerId ? [endpoint.providerId] : [];
  const providers = cloudProvidersAllowed(endpoint)
    ? providerIds.map((providerId) => {
      const provider = getDelegatedProvider(providerId);
      return {
        id: providerId,
        label: provider.label,
        location: 'external' as const,
        modelId: providerId === endpoint.providerId
          ? endpoint.providerModelId ?? provider.defaultModel
          : provider.defaultModel,
        intelligence: new DelegatedCliIntelligenceAdapter(
          provider,
          new NodeCliProcessRunner(app.getPath('temp')),
        ),
      };
    }).filter(routeCandidateReady)
    : [];
  const router = new AdaptiveRoutingIntelligenceAdapter(
    effectiveRoutingPolicy(endpoint), local, [...ollamaCloud, ...providers],
    { localMs: 90_000, externalMs: 120_000 }, recordRoutingAttempt,
  );
  return { intelligence: router, router };
}

function simulatedRoute(): RoutingDecision {
  return {
    policy: 'local_only', location: 'simulated', providerId: 'mock', providerLabel: 'Simulated demo',
    modelId: 'mock', reason: 'Simulated demo was explicitly enabled; no AI model was used.', fallback: false,
  };
}

async function probeIntelligence(
  intelligence: IntelligencePort,
  modelId: string,
  executionMode: 'local_only' | 'provider_allowed',
  timeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await intelligence.execute(
      { messages: [{ role: 'user', content: 'Return the required JSON text envelope with content exactly OK.' }] },
      { modelId, executionMode, taskKind: 'connection_test' },
      controller.signal,
    );
    if (response.type !== 'text' || !response.content.trim()) throw new Error('The provider returned an empty response');
  } finally {
    clearTimeout(timeout);
  }
}

async function testEndpointConnection(config: EndpointConfig): Promise<{ ok: true; message: string }> {
  if (config.mode === 'mock') return { ok: true, message: 'Demo mode is available. Responses will be simulated.' };
  const useLocal = localModelsAllowed(config);
  const useOllamaCloud = ollamaCloudModelsAllowed(config);
  const useProviders = cloudProvidersAllowed(config);
  if (!useLocal && !useOllamaCloud && !useProviders) throw new Error('Allow at least one intelligence path before testing.');

  const ollamaIds = configuredOllamaModelIds(config);
  const localIds = ollamaIds.filter((id) => !isOllamaCloudModel(id));
  const cloudId = ollamaIds.find(isOllamaCloudModel);
  const successes: string[] = [];
  const failures: string[] = [];
  const attempt = async (
    candidate: { id: string; label: string; location: 'local' | 'external'; modelId: string; intelligence: IntelligencePort },
    executionMode: 'local_only' | 'provider_allowed',
    timeoutMs: number,
  ): Promise<boolean> => {
    try {
      await probeIntelligence(candidate.intelligence, candidate.modelId, executionMode, timeoutMs);
      recordRoutingAttempt({ candidate, status: 'available' });
      successes.push(candidate.label);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordRoutingAttempt({ candidate, status: /HTTP\s+429\b/i.test(message) ? 'limited' : 'unavailable', error: message });
      failures.push(`${candidate.label}: ${message}`);
      return false;
    }
  };

  if (useLocal && localIds.length > 0) {
    for (const localId of localIds) {
      const available = await attempt({
        id: 'ollama', label: `On-device Ollama (${localId})`, location: 'local', modelId: localId,
        intelligence: new OpenAICompatibleLocalAdapter(config.baseUrl, new DefaultNetworkGateway()),
      }, 'local_only', 45_000);
      if (available) break;
    }
  } else if (useLocal) failures.push('On-device Ollama: no compatible local model discovered');

  if (useOllamaCloud && cloudId) {
    await attempt({
      id: 'ollama-cloud', label: 'Ollama Cloud', location: 'external', modelId: cloudId,
      intelligence: new OpenAICompatibleLocalAdapter(config.baseUrl, new DefaultNetworkGateway()),
    }, 'provider_allowed', 60_000);
  } else if (useOllamaCloud) failures.push('Ollama Cloud: no compatible cloud model discovered');

  if (useProviders && config.providerId) {
    const provider = getDelegatedProvider(config.providerId);
    await attempt({
      id: provider.id, label: provider.label, location: 'external',
      modelId: config.providerModelId ?? provider.defaultModel,
      intelligence: new DelegatedCliIntelligenceAdapter(provider, new NodeCliProcessRunner(app.getPath('temp'))),
    }, 'provider_allowed', 60_000);
  } else if (useProviders) failures.push('Connected providers: no authenticated provider discovered');

  if (successes.length === 0) throw new Error(`No allowed intelligence source is currently available. ${failures.join(' | ')}`);
  return {
    ok: true,
    message: failures.length > 0
      ? `Available: ${successes.join(', ')}. Career Agent will bypass unavailable sources automatically. ${failures.join(' | ')}`
      : `Available: ${successes.join(', ')}. Career Agent will route requests automatically.`,
  };
}

async function assertEndpointWorkflowCompatible(endpoint: EndpointConfig): Promise<void> {
  if (!localModelsAllowed(endpoint)) return;
  const modelId = configuredOllamaModelIds(endpoint).find((id) => !isOllamaCloudModel(id));
  if (!modelId) {
    if (externalIntelligenceAllowed(endpoint)) return;
    throw new Error('No compatible on-device Ollama model is configured. Refresh Intelligence status.');
  }
  try {
    const capability = await inspectOllamaModel(
      endpoint.baseUrl, modelId, new DefaultNetworkGateway(), new AbortController().signal,
    );
    if (!capability.toolCalling) {
      if (externalIntelligenceAllowed(endpoint)) return;
      throw new Error(`${modelId} cannot run Career Agent because it does not support tool calling. Install a tool-capable Ollama model.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('cannot run Career Agent')) throw error;
    // Preserve support for non-Ollama OpenAI-compatible local endpoints.
  }
}

async function listProviderConnections(): Promise<Array<{
  id: string; label: string; kind: 'delegated_cli'; installed: boolean;
  authenticated: boolean | null; detail: string; defaultModel: string;
  availability: 'available' | 'limited' | 'unavailable' | 'unknown'; lastError?: string;
}>> {
  const runner = new NodeCliProcessRunner(app.getPath('temp'));
  const connections = await Promise.all(delegatedProviders.map(async (provider) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const version = await runner.run(provider.command, ['--version'], '', controller.signal);
      if (version.exitCode !== 0) throw new Error(version.stderr);
      if (!provider.statusArgs) {
        return {
          id: provider.id, label: provider.label, kind: 'delegated_cli' as const,
          installed: true, authenticated: null,
          detail: 'Installed; authentication is verified on first request.',
          defaultModel: provider.defaultModel,
        };
      }
      const status = await runner.run(provider.command, provider.statusArgs, '', controller.signal);
      return {
        id: provider.id, label: provider.label, kind: 'delegated_cli' as const,
        installed: true, authenticated: status.exitCode === 0,
        detail: status.exitCode === 0
          ? 'Signed in through the provider CLI; use Test connection to verify inference.'
          : 'CLI installed; sign-in required.',
        defaultModel: provider.defaultModel,
      };
    } catch {
      return {
        id: provider.id, label: provider.label, kind: 'delegated_cli' as const,
        installed: false, authenticated: false,
        detail: `Install ${provider.command} and sign in to connect.`,
        defaultModel: provider.defaultModel,
      };
    } finally {
      clearTimeout(timer);
    }
  }));
  return connections.map((connection) => {
    const health = intelligenceHealth.get(`${connection.id}/${connection.defaultModel}`)
      ?? [...intelligenceHealth.entries()].find(([key]) => key.startsWith(`${connection.id}/`))?.[1];
    return {
      ...connection,
      availability: health?.availability
        ?? (connection.installed && connection.authenticated !== false ? 'available' : 'unavailable'),
      ...(health?.lastError ? { lastError: health.lastError } : {}),
    };
  });
}

async function ensureChatSession(): Promise<ChatSession> {
  const db = getPersistence();
  const selected = await db.getSelectedChatSession();
  if (selected) return selected;
  const sessions = await db.listChatSessions();
  if (sessions.length > 0) {
    await db.selectChatSession(sessions[0].id);
    return sessions[0];
  }
  const now = new Date().toISOString();
  const selectedWorkspace = await db.getSelectedWorkspace();
  const created: ChatSession = {
    id: `session-${Date.now()}`,
    name: 'Career Agent Session',
    mode: 'autopilot',
    workspaceId: selectedWorkspace?.id ?? null,
    agentId: 'career',
    intelligencePreference: 'auto',
    permissionMode: 'interactive',
    isolationMode: 'read_only',
    createdAt: now,
    updatedAt: now,
  };
  await db.saveChatSession(created);
  await db.selectChatSession(created.id);
  return created;
}

async function bindSelectedSessionToWorkspace(workspaceId: string): Promise<void> {
  const db = getPersistence();
  const selectedSession = await db.getSelectedChatSession();
  if (!selectedSession || selectedSession.workspaceId === workspaceId) return;
  await db.saveChatSession({
    ...selectedSession,
    workspaceId,
    updatedAt: new Date().toISOString(),
  });
}

async function getChatConversation(sessionIdValue: string): Promise<ModelMessage[]> {
  const messages = await getPersistence().listChatMessages(sessionIdValue);
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: message.content })) as ModelMessage[];
}

function buildCareerChatContext(
  chatSession: ChatSession,
  conversation: ModelMessage[],
  registrations: WorkspaceRegistration[],
  selectedWorkspaceId?: string,
  tools?: ReturnType<ToolRegistry['getModelTools']>,
) {
  const loader = new CareerAgentLoader(new FileSystemAgentDefinitionSource(getCareerAgentDirectory()));
  const agent = loader.load();
  return new ContextBuilder().buildRequest(
    {
      systemPrompt: `${agent.systemPrompt}\n\n===\n\n${buildWorkspaceAccessInstructions(
        registrations,
        selectedWorkspaceId,
      )}\n\n===\n\n${buildChatModeInstructions(chatSession.mode)}`,
      memoryContext: agent.memoryContext,
      conversation,
      ...(tools ? { tools } : {}),
    },
    chatContextBudget,
  );
}

async function getChatContextUsage(): Promise<ChatContextUsage> {
  const db = getPersistence();
  const chatSession = await ensureChatSession();
  const [conversation, registrations, selectedWorkspace] = await Promise.all([
    getChatConversation(chatSession.id),
    db.listWorkspaces(),
    db.getSelectedWorkspace(),
  ]);
  return summarizeChatContextUsage(buildCareerChatContext(
    chatSession,
    conversation,
    registrations,
    selectedWorkspace?.id,
  ));
}

async function appendChatPair(
  sessionIdValue: string,
  userMessage: string,
  mode: ChatMode,
  assistantMessage: string,
  sourceReferences: Array<{ type: string; workspaceId?: string; relativePath?: string; commitSha?: string; label?: string }>,
  route: RoutingDecision,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await getPersistence().listChatMessages(sessionIdValue);
  const userSequence = existing.length + 1;
  const assistantSequence = existing.length + 2;
  await getPersistence().appendChatMessage({
    sessionId: sessionIdValue,
    sequence: userSequence,
    role: 'user',
    content: userMessage,
    sourceReferencesJson: '[]',
    routingJson: null,
    mode,
    createdAt: now,
  });
  await getPersistence().appendChatMessage({
    sessionId: sessionIdValue,
    sequence: assistantSequence,
    role: 'assistant',
    content: assistantMessage,
    sourceReferencesJson: JSON.stringify(sourceReferences),
    routingJson: JSON.stringify(route),
    mode: null,
    createdAt: now,
  });
}

async function getChatHistory(): Promise<Array<{
  userMessage: string;
  assistantMessage: string;
  sourceReferences: Array<{ type: string; workspaceId?: string; relativePath?: string; commitSha?: string; label?: string }>;
  route?: RoutingDecision;
  mode: ChatMode;
}>> {
  const sessionValue = await ensureChatSession();
  const messages = await getPersistence().listChatMessages(sessionValue.id);
  const exchanges: Array<{
    userMessage: string;
    assistantMessage: string;
    sourceReferences: Array<{ type: string; workspaceId?: string; relativePath?: string; commitSha?: string; label?: string }>;
    route?: RoutingDecision;
    mode: ChatMode;
  }> = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    const assistant = messages[index + 1];
    if (!assistant || assistant.role !== 'assistant') continue;
    exchanges.push({
      userMessage: message.content,
      assistantMessage: assistant.content,
      sourceReferences: JSON.parse(assistant.sourceReferencesJson) as Array<{ type: string; workspaceId?: string; relativePath?: string; commitSha?: string; label?: string }>,
      mode: message.mode ?? 'standard',
      ...(assistant.routingJson ? { route: JSON.parse(assistant.routingJson) as RoutingDecision } : {}),
    });
  }
  return exchanges;
}

async function runChatMessage(message: string): Promise<{
  userMessage: string;
  assistantMessage: string;
  sourceReferences: Array<{ type: string; workspaceId?: string; relativePath?: string; commitSha?: string; label?: string }>;
  route?: RoutingDecision;
  mode: ChatMode;
}> {
  const endpoint = await getEndpointConfig();
  await assertEndpointWorkflowCompatible(endpoint);
  const workspaceContext = await ensureWorkspaceSelection();
  const approvalContext = await approvals();
  const chatSession = await ensureChatSession();

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(filesystemReadTool);
  toolRegistry.register(gitStatusTool);
  toolRegistry.register(gitLogTool);
  toolRegistry.register(gitDiffTool);
  toolRegistry.register(createFilesystemProposeWriteTool(approvalContext.service, chatSession.id));

  const toolExecutor = new ToolExecutor(toolRegistry);
  const { runtime, router } = createRuntime(endpoint, toolExecutor, workspaceContext.gateway);

  const persistedConversation = await getChatConversation(chatSession.id);
  const nextConversation = [...persistedConversation, { role: 'user' as const, content: message }];
  const built = buildCareerChatContext(
    chatSession,
    nextConversation,
    workspaceContext.registrations,
    workspaceContext.selectedWorkspaceId,
    toolRegistry.getModelTools(),
  );
  const result = await runtime.runWithTrace(
    built.request,
    {
      modelId: endpoint.modelId,
      executionMode: effectiveRoutingPolicy(endpoint) === 'local_only' ? 'local_only' : 'provider_allowed',
      workspaceId: workspaceContext.selectedWorkspaceId,
      taskKind: 'chat',
    },
    new AbortController().signal,
  );
  const route = router?.getLastDecision() ?? simulatedRoute();
  await appendChatPair(chatSession.id, message, chatSession.mode, result.content, result.sourceReferences, route);
  return {
    userMessage: message,
    assistantMessage: result.content,
    sourceReferences: result.sourceReferences,
    route,
    mode: chatSession.mode,
  };
}

function createRuntime(
  endpoint: EndpointConfig,
  toolExecutor: ToolExecutor,
  workspaceGateway: DefaultWorkspaceGateway,
): { runtime: AgentRuntime; router: AdaptiveRoutingIntelligenceAdapter | null } {
  const { intelligence, router } = createRoutingIntelligence(endpoint);
  const runtime = new AgentRuntime(
    intelligence,
    {
      execute: (toolName, input, context) => toolExecutor.execute(toolName, input, { ...context, workspaceGateway }),
      getMetadata: (toolName) => toolExecutor.getMetadata(toolName),
    },
    new PolicyGate(),
    {
      maxSteps: 6,
      maxToolCalls: 8,
      maxToolResultBytes: 64 * 1024,
      modelTimeoutMs: effectiveRoutingPolicy(endpoint) === 'local_only' ? 90_000 : 120_000,
      toolTimeoutMs: 10_000,
    },
  );
  return { runtime, router };
}

async function runCareerAudit(): Promise<{
  title: string;
  summary: string;
  result: {
    content: string;
    workspaceIds: string[];
    sourceReferences: Array<{ type: string; workspaceId?: string; relativePath?: string; commitSha?: string; label?: string }>;
    route?: RoutingDecision;
  };
}> {
  const endpoint = await getEndpointConfig();
  await assertEndpointWorkflowCompatible(endpoint);
  const workspaceContext = await ensureWorkspaceSelection();
  const approvalContext = await approvals();
  const db = getPersistence();
  const chatSession = await ensureChatSession();

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(filesystemReadTool);
  toolRegistry.register(gitStatusTool);
  toolRegistry.register(gitLogTool);
  toolRegistry.register(gitDiffTool);
  toolRegistry.register(createFilesystemProposeWriteTool(approvalContext.service, chatSession.id));
  const toolExecutor = new ToolExecutor(toolRegistry);
  const { runtime, router } = createRuntime(endpoint, toolExecutor, workspaceContext.gateway);
  const signal = new AbortController().signal;

  const evidenceMessages: ModelMessage[] = [];
  const evidenceSources: Array<{ type: 'file' | 'git_commit' | 'git_diff' | 'git_status' | 'memory'; workspaceId?: string; relativePath?: string; commitSha?: string; label?: string }> = [];
  const registrations = await db.listWorkspaces();
  for (const workspace of registrations) {
    const evidenceRequests = workspace.kind === 'profile' || workspace.kind === 'cv'
      ? [{ toolName: 'filesystem.read', input: { workspaceId: workspace.id, relativePath: 'README.md' } }]
      : [
        { toolName: 'git.log', input: { workspaceId: workspace.id, maxCount: 10 } },
        { toolName: 'git.status', input: { workspaceId: workspace.id } },
      ];
    for (const request of evidenceRequests) {
      const callId = `audit-evidence-${workspace.id}-${request.toolName}`;
      try {
        const evidence = await toolExecutor.execute(request.toolName, request.input, {
          workspaceId: workspace.id,
          signal,
          workspaceGateway: workspaceContext.gateway,
        });
        evidenceMessages.push(
          { role: 'assistant', content: '', toolCalls: [{ id: callId, toolName: request.toolName, input: request.input }] },
          { role: 'tool', content: JSON.stringify(evidence.output), toolCallId: callId, toolName: request.toolName },
        );
        evidenceSources.push(...evidence.sourceReferences);
      } catch {
        // A missing README or non-Git folder should not prevent other registered
        // workspaces from contributing evidence to the audit.
      }
    }
  }

  const loader = new CareerAgentLoader(new FileSystemAgentDefinitionSource(getCareerAgentDirectory()));
  const agent = loader.load();
  const auditService = new CareerAuditService(
    {
      saveWorkspace: (workspace) => db.saveWorkspace(workspace),
      getWorkspace: (id) => db.getWorkspace(id),
      listWorkspaces: () => db.listWorkspaces(),
      selectWorkspace: (id) => db.selectWorkspace(id),
      removeWorkspace: (id) => db.removeWorkspace(id),
      getSelectedWorkspace: () => db.getSelectedWorkspace(),
    },
    runtime,
    new ContextBuilder(),
    {
      maxInstructionsBytes: 16 * 1024,
      maxMemoryBytes: 8 * 1024,
      maxConversationBytes: 8 * 1024,
      maxToolResultBytes: 16 * 1024,
      maxTotalContentBytes: 48 * 1024,
    },
  );

  const result = await auditService.run(
    {
      agent,
      userMessage: 'Compare my recent project activity with my current professional profile and identify important gaps.',
      modelId: endpoint.modelId,
      executionMode: effectiveRoutingPolicy(endpoint) === 'local_only' ? 'local_only' : 'provider_allowed',
      taskKind: 'audit',
      tools: toolRegistry.getModelTools(),
      preloadedEvidence: { messages: evidenceMessages, sourceReferences: evidenceSources },
    },
    signal,
  );
  return {
    title: 'Career Audit',
    summary: 'Evidence-backed comparison of registered workspaces and current profile memory.',
    result: {
      content: result.content,
      workspaceIds: result.workspaceIds,
      sourceReferences: result.sourceReferences,
      route: router?.getLastDecision() ?? simulatedRoute(),
    },
  };
}

async function proposeProfileUpdate(input: {
  workspaceId: string;
  targetPath: string;
  recommendation: string;
}): Promise<{
  id: string;
  status: 'PROPOSED' | 'APPROVED' | 'EXECUTED' | 'REJECTED' | 'STALE';
  workspaceId: string;
  targetPath: string;
  diff: string;
  rejectionReason?: string;
  route?: RoutingDecision;
}> {
  const endpoint = await getEndpointConfig();
  await assertEndpointWorkflowCompatible(endpoint);
  const workspaceContext = await ensureWorkspaceSelection();
  const approvalContext = await approvals();
  const chatSession = await ensureChatSession();
  const workspace = await getPersistence().getWorkspace(input.workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${input.workspaceId}`);
  const current = await workspaceContext.gateway.readFileIfExists(input.workspaceId, input.targetPath);
  const currentContent = current?.content ?? '';
  const mockProposedContent = `${currentContent.trimEnd()}\n\n## Proposed profile update\n\n${input.recommendation.trim()}\n`;
  const pendingBefore = new Set((await approvalContext.service.listPending()).map((action) => action.id));

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(createFilesystemProposeWriteTool(approvalContext.service, chatSession.id));
  const toolExecutor = new ToolExecutor(toolRegistry);

  const mockIntelligence = endpoint.mode === 'mock'
    ? new MockIntelligenceAdapter([
      {
        type: 'tool_call',
        call: {
          id: 'call-propose-readme',
          toolName: 'filesystem.proposeWrite',
          input: {
            workspaceId: input.workspaceId,
            targetPath: input.targetPath,
            proposedContent: mockProposedContent,
          },
        },
      },
      { type: 'text', content: 'Proposal created.' },
    ])
    : null;
  const routed = mockIntelligence ? { intelligence: mockIntelligence as IntelligencePort, router: null } : createRoutingIntelligence(endpoint);

  const runtime = new AgentRuntime(
    routed.intelligence,
    {
      execute: (toolName, toolInput, context) => {
        if (toolName === 'filesystem.proposeWrite') {
          const sourceInput = (toolInput && typeof toolInput === 'object') ? (toolInput as Record<string, unknown>) : {};
          if (sourceInput.workspaceId !== input.workspaceId || sourceInput.targetPath !== input.targetPath) {
            throw new Error('The model attempted to propose a change outside the selected file');
          }
          return toolExecutor.execute(toolName, sourceInput, { ...context, workspaceGateway: workspaceContext.gateway });
        }
        return toolExecutor.execute(toolName, toolInput, { ...context, workspaceGateway: workspaceContext.gateway });
      },
      getMetadata: (toolName) => toolExecutor.getMetadata(toolName),
    },
    new PolicyGate(),
    {
      maxSteps: 3,
      maxToolCalls: 3,
      maxToolResultBytes: 64 * 1024,
      modelTimeoutMs: effectiveRoutingPolicy(endpoint) === 'local_only' ? 90_000 : 120_000,
      toolTimeoutMs: 10_000,
    },
  );

  const request = {
    messages: [
      {
        role: 'system' as const,
        content: 'Create exactly one filesystem.proposeWrite action for the workspace and target path supplied by the user. The proposedContent must be the complete updated file. Do not apply any write and do not target another file.',
      },
      {
        role: 'user' as const,
        content: `Workspace: ${input.workspaceId}\nTarget path: ${input.targetPath}\nRecommendation: ${input.recommendation}\n\nCurrent file content:\n${currentContent.slice(0, 32 * 1024)}`,
      },
    ],
    tools: toolRegistry.getModelTools(),
  };
  const runResult = await runtime.runWithTrace(
    request,
    {
      modelId: endpoint.modelId,
      executionMode: effectiveRoutingPolicy(endpoint) === 'local_only' ? 'local_only' : 'provider_allowed',
      workspaceId: input.workspaceId,
      taskKind: 'proposal',
    },
    new AbortController().signal,
  );

  const pending = await approvalContext.service.listPending();
  const latest = pending.find((action) => !pendingBefore.has(action.id));
  if (!latest) {
    throw new Error(`The model did not create a structured file proposal. ${runResult.content.trim() || 'Try refining the recommendation.'}`);
  }
  const route = routed.router?.getLastDecision() ?? simulatedRoute();
  latest.routingJson = JSON.stringify(route);
  await getPersistence().savePendingAction(latest);
  return {
    id: latest.id,
    status: latest.status,
    workspaceId: latest.workspaceId,
    targetPath: latest.targetPath,
    diff: latest.diff,
    route,
    ...(latest.rejectionReason ? { rejectionReason: latest.rejectionReason } : {}),
  };
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getDemoAudit, async () => runCareerAudit());

  ipcMain.handle(IPC_CHANNELS.pickWorkspaceDirectory, async () => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select workspace directory',
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.registerWorkspace, async (_event, payload: unknown) => {
    const input = parseRegisterWorkspaceInput(payload);
    const db = getPersistence();
    await db.saveWorkspace(input);
    const selected = await db.getSelectedWorkspace();
    if (!selected) {
      await db.selectWorkspace(input.id);
      await bindSelectedSessionToWorkspace(input.id);
    }
  });

  ipcMain.handle(IPC_CHANNELS.listWorkspaces, async () => {
    const db = getPersistence();
    const selected = await db.getSelectedWorkspace();
    const selectedId = selected?.id;
    const workspaces = await db.listWorkspaces();
    return workspaces.map((workspace) => ({
      ...workspace,
      kind: workspace.kind ?? 'project',
      selected: workspace.id === selectedId,
    }));
  });

  ipcMain.handle(IPC_CHANNELS.selectWorkspace, async (_event, payload: unknown) => {
    const { id } = parseWorkspaceIdInput(payload);
    await getPersistence().selectWorkspace(id);
    await bindSelectedSessionToWorkspace(id);
  });

  ipcMain.handle(IPC_CHANNELS.removeWorkspace, async (_event, payload: unknown) => {
    const { id } = parseWorkspaceIdInput(payload);
    await getPersistence().removeWorkspace(id);
  });

  ipcMain.handle(IPC_CHANNELS.getEndpointConfig, async () => getEndpointConfig());

  ipcMain.handle(IPC_CHANNELS.listProviderConnections, async () => listProviderConnections());

  ipcMain.handle(IPC_CHANNELS.discoverLocalModels, async (_event, payload: unknown) => {
    const { baseUrl } = parseModelDiscoveryInput(payload);
    const models = await discoverOllamaModels(baseUrl, new DefaultNetworkGateway(), new AbortController().signal);
    return models.map((model) => {
      const candidateId = model.location === 'cloud' ? 'ollama-cloud' : 'ollama';
      const health = intelligenceHealth.get(`${candidateId}/${model.id}`);
      return {
        ...model,
        availability: health?.availability
          ?? (model.toolCalling ? (model.location === 'local' ? 'available' : 'unknown') : 'unavailable'),
        ...(health?.lastError ? { lastError: health.lastError } : {}),
      };
    });
  });

  ipcMain.handle(IPC_CHANNELS.listWorkspaceEntries, async (_event, payload: unknown) => {
    const { workspaceId, relativePath } = parseWorkspacePathInput(payload);
    const registrations = await getPersistence().listWorkspaces();
    const gateway = new DefaultWorkspaceGateway(
      Object.fromEntries(registrations.map((workspace) => [workspace.id, workspace.rootPath])),
    );
    return gateway.listDirectoryEntries(workspaceId, relativePath);
  });

  ipcMain.handle(IPC_CHANNELS.readWorkspaceFile, async (_event, payload: unknown) => {
    const { workspaceId, relativePath } = parseWorkspacePathInput(payload);
    const registrations = await getPersistence().listWorkspaces();
    const gateway = new DefaultWorkspaceGateway(
      Object.fromEntries(registrations.map((workspace) => [workspace.id, workspace.rootPath])),
    );
    const result = await gateway.readFile(workspaceId, relativePath);
    const maximumPreviewBytes = 64 * 1024;
    const encoded = Buffer.from(result.content, 'utf8');
    const truncated = encoded.byteLength > maximumPreviewBytes;
    return {
      workspaceId,
      relativePath,
      content: truncated
        ? encoded.subarray(0, maximumPreviewBytes).toString('utf8').replace(/\uFFFD$/u, '')
        : result.content,
      truncated,
    };
  });

  ipcMain.handle(IPC_CHANNELS.saveEndpointConfig, async (_event, payload: unknown) => {
    const config = parseEndpointConfigInput(payload);
    await saveEndpointConfig(config);
  });

  ipcMain.handle(IPC_CHANNELS.listAgents, async () => {
    const agent = new CareerAgentLoader(
      new FileSystemAgentDefinitionSource(getCareerAgentDirectory()),
    ).load();
    return [{
      id: agent.id,
      name: agent.name,
      description: agent.description,
      quickActions: agent.quickActions,
    }];
  });

  ipcMain.handle(IPC_CHANNELS.listChatSessions, async () => {
    const db = getPersistence();
    const selected = await ensureChatSession();
    const sessions = await db.listChatSessions();
    return sessions.map((sessionValue) => ({
      ...sessionValue,
      selected: sessionValue.id === selected.id,
    }));
  });

  ipcMain.handle(IPC_CHANNELS.createChatSession, async (_event, payload: unknown) => {
    const input = parseCreateChatSessionInput(payload);
    if (input.workspaceId && !(await getPersistence().getWorkspace(input.workspaceId))) {
      throw new Error(`Unknown workspace: ${input.workspaceId}`);
    }
    const now = new Date().toISOString();
    const created = {
      id: `session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: input.name,
      mode: 'autopilot' as const,
      workspaceId: input.workspaceId ?? null,
      agentId: input.agentId,
      intelligencePreference: input.intelligencePreference,
      permissionMode: input.permissionMode,
      isolationMode: input.isolationMode,
      createdAt: now,
      updatedAt: now,
    };
    const db = getPersistence();
    await db.saveChatSession(created);
    await db.selectChatSession(created.id);
    if (created.workspaceId) await db.selectWorkspace(created.workspaceId);
    return { ...created, selected: true };
  });

  ipcMain.handle(IPC_CHANNELS.renameChatSession, async (_event, payload: unknown) => {
    const { id, name } = parseRenameChatSessionInput(payload);
    const db = getPersistence();
    const existing = (await db.listChatSessions()).find((sessionValue) => sessionValue.id === id);
    if (!existing) throw new Error(`Unknown chat session: ${id}`);
    const renamed = { ...existing, name, updatedAt: new Date().toISOString() };
    await db.saveChatSession(renamed);
    const selected = await db.getSelectedChatSession();
    return { ...renamed, selected: selected?.id === id };
  });

  ipcMain.handle(IPC_CHANNELS.setChatSessionMode, async (_event, payload: unknown) => {
    const { id, mode } = parseSetChatSessionModeInput(payload);
    const db = getPersistence();
    const existing = (await db.listChatSessions()).find((sessionValue) => sessionValue.id === id);
    if (!existing) throw new Error(`Unknown chat session: ${id}`);
    const updated = { ...existing, mode, updatedAt: new Date().toISOString() };
    await db.saveChatSession(updated);
    const selected = await db.getSelectedChatSession();
    return { ...updated, selected: selected?.id === id };
  });

  ipcMain.handle(IPC_CHANNELS.deleteChatSession, async (_event, payload: unknown) => {
    const { id } = parseWorkspaceIdInput(payload);
    const db = getPersistence();
    const existing = (await db.listChatSessions()).find((sessionValue) => sessionValue.id === id);
    if (!existing) throw new Error(`Unknown chat session: ${id}`);
    await db.deleteChatSession(id);
    await ensureChatSession();
  });

  ipcMain.handle(IPC_CHANNELS.selectChatSession, async (_event, payload: unknown) => {
    const { id } = parseWorkspaceIdInput(payload);
    const db = getPersistence();
    const sessionValue = (await db.listChatSessions()).find((candidate) => candidate.id === id);
    if (!sessionValue) throw new Error(`Unknown chat session: ${id}`);
    await db.selectChatSession(id);
    if (sessionValue.workspaceId && await db.getWorkspace(sessionValue.workspaceId)) {
      await db.selectWorkspace(sessionValue.workspaceId);
    }
  });

  ipcMain.handle(IPC_CHANNELS.getChatHistory, async () => getChatHistory());

  ipcMain.handle(IPC_CHANNELS.getChatContextUsage, async () => getChatContextUsage());

  ipcMain.handle(IPC_CHANNELS.sendChatMessage, async (_event, payload: unknown) => {
    const { message } = parseChatMessageInput(payload);
    return runChatMessage(message);
  });

  ipcMain.handle(IPC_CHANNELS.listPendingActions, async () => {
    if ((await getPersistence().listWorkspaces()).length === 0) return [];
    const { service } = await approvals();
    return (await service.listPending()).map((action) => ({
      ...action,
      ...(action.routingJson ? { route: JSON.parse(action.routingJson) as RoutingDecision } : {}),
    }));
  });

  ipcMain.handle(IPC_CHANNELS.testEndpointConnection, async (_event, payload: unknown) => {
    const config = parseEndpointConfigInput(payload);
    return testEndpointConnection(config);
  });

  ipcMain.handle(IPC_CHANNELS.proposeProfileUpdate, async (_event, payload: unknown) => {
    const input = parseProposeProfileUpdateInput(payload);
    return proposeProfileUpdate(input);
  });

  ipcMain.handle(IPC_CHANNELS.approvePendingAction, async (_event, payload: unknown) => {
    const { actionId } = parseApprovePendingActionInput(payload);
    const { service, workspaceId } = await approvals();
    return service.approveAndExecute(actionId, workspaceId);
  });

  ipcMain.handle(IPC_CHANNELS.rejectPendingAction, async (_event, payload: unknown) => {
    const { actionId, reason } = parseRejectPendingActionInput(payload);
    const { service } = await approvals();
    return service.rejectAction(actionId, reason);
  });
}

function createWindow(): void {
  const isDev = !app.isPackaged;
  const forceFileMode = process.env.AW_RENDERER_MODE === 'file';
  const preloadPath = join(__dirname, '../preload/preload.js');
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Restrict navigation to local origins only
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedNavigation(navigationUrl, isDev)) {
      event.preventDefault();
    }
  });

  // Block new windows from renderer
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('did-fail-load', (_event, code, description, failingUrl) => {
    process.stderr.write(`Renderer failed to load (${code}): ${description} at ${failingUrl}\n`);
  });

  if (isDev && !forceFileMode) {
    void win.loadURL('http://localhost:5173');
  } else {
    void win.loadFile(join(__dirname, '../../../../dist/index.html'));
  }
}

app.whenReady().then(() => {
  const isDev = !app.isPackaged;
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [getContentSecurityPolicy(isDev)],
      },
    });
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
