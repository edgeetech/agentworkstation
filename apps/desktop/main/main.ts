import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { ApprovalService } from '../../../src/application/approvals';
import { CareerAgentLoader } from '../../../src/application/agents/CareerAgentLoader';
import { CareerAuditService } from '../../../src/application/careerAudit';
import { ContextBuilder } from '../../../src/application/context';
import { AgentRuntime } from '../../../src/application/intelligence';
import { PolicyGate, ToolExecutor, ToolRegistry } from '../../../src/application/tools';
import type { IntelligencePort, ModelMessage } from '../../../src/domain/intelligence';
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
  parseRejectPendingActionInput,
  parseWorkspaceIdInput,
} from './ipcContract';
import { getContentSecurityPolicy, isAllowedNavigation } from './security';
import { discoverOllamaModels, inspectOllamaModel } from '../../../src/infrastructure/intelligence/ollamaModelDiscovery';

const userDataOverride = process.env.AW_USER_DATA_PATH?.trim();
if (userDataOverride) app.setPath('userData', userDataOverride);

const sessionId = `desktop-${Date.now()}`;
const endpointSettingKey = 'endpoint-config';
let persistence: SqlitePersistence | null = null;

class DesktopMockIntelligenceAdapter implements IntelligencePort {
  async execute(
    request: { messages: ModelMessage[] },
    _context: { modelId: string; executionMode: 'local_only' },
    _signal: AbortSignal,
  ): Promise<{ type: 'text'; content: string }> {
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

async function ensureWorkspaceSelection(): Promise<{ selectedWorkspaceId: string; gateway: DefaultWorkspaceGateway }> {
  const db = getPersistence();
  const workspaces = await db.listWorkspaces();
  if (workspaces.length === 0) throw new Error('No workspace configured');
  const selected = await db.getSelectedWorkspace() ?? (await db.listWorkspaces())[0];
  if (!selected) throw new Error('No workspace configured');
  const all = await db.listWorkspaces();
  const roots = Object.fromEntries(all.map((workspace) => [workspace.id, workspace.rootPath]));
  return { selectedWorkspaceId: selected.id, gateway: new DefaultWorkspaceGateway(roots) };
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
  configured?: boolean;
};

async function getEndpointConfig(): Promise<EndpointConfig> {
  const raw = await getPersistence().getSetting(endpointSettingKey);
  if (!raw) return { mode: 'local', baseUrl: 'http://localhost:11434', modelId: 'llama3.1', configured: false };
  try {
    const parsed = JSON.parse(raw) as Partial<EndpointConfig>;
    if (parsed.mode !== 'mock' && parsed.mode !== 'local' && parsed.mode !== 'delegated') throw new Error('Invalid mode');
    if (!parsed.baseUrl || !parsed.modelId) throw new Error('Invalid endpoint config');
    if (parsed.mode === 'delegated' && !parsed.providerId) throw new Error('Invalid delegated provider');
    return {
      mode: parsed.mode,
      baseUrl: parsed.baseUrl,
      modelId: parsed.modelId,
      ...(parsed.providerId ? { providerId: parsed.providerId } : {}),
      configured: true,
    };
  } catch {
    return { mode: 'local', baseUrl: 'http://localhost:11434', modelId: 'llama3.1', configured: false };
  }
}

async function saveEndpointConfig(config: EndpointConfig): Promise<void> {
  await getPersistence().setSetting(endpointSettingKey, JSON.stringify(config));
}

async function testEndpointConnection(config: EndpointConfig): Promise<{ ok: true; message: string }> {
  if (config.mode === 'mock') return { ok: true, message: 'Demo mode is available. Responses will be simulated.' };
  if (config.mode === 'local') {
    try {
      const capability = await inspectOllamaModel(
        config.baseUrl, config.modelId, new DefaultNetworkGateway(), new AbortController().signal,
      );
      if (!capability.toolCalling) {
        throw new Error(`${config.modelId} is installed but does not support tool calling required by Career Agent. Choose a model marked Career Agent ready.`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('does not support tool calling')) throw error;
      // Non-Ollama OpenAI-compatible endpoints may not expose /api/show.
    }
  }
  const adapter: IntelligencePort = config.mode === 'delegated'
    ? new DelegatedCliIntelligenceAdapter(
        getDelegatedProvider(config.providerId ?? ''),
        new NodeCliProcessRunner(app.getPath('temp')),
      )
    : new OpenAICompatibleLocalAdapter(config.baseUrl, new DefaultNetworkGateway());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.mode === 'delegated' ? 60_000 : 30_000);
  let response;
  try {
    response = await adapter.execute(
      { messages: [{ role: 'user', content: 'Return the required JSON text envelope with content exactly OK.' }] },
      { modelId: config.modelId, executionMode: config.mode === 'local' ? 'local_only' : 'provider_allowed' },
      controller.signal,
    );
  } finally {
    clearTimeout(timeout);
  }
  if (response.type !== 'text' || !response.content.trim()) throw new Error('The provider returned an empty response');
  const providerLabel = config.mode === 'delegated'
    ? getDelegatedProvider(config.providerId ?? '').label
    : config.modelId;
  return { ok: true, message: `Connected to ${providerLabel}.` };
}

async function assertEndpointWorkflowCompatible(endpoint: EndpointConfig): Promise<void> {
  if (endpoint.mode !== 'local') return;
  try {
    const capability = await inspectOllamaModel(
      endpoint.baseUrl, endpoint.modelId, new DefaultNetworkGateway(), new AbortController().signal,
    );
    if (!capability.toolCalling) {
      throw new Error(`${endpoint.modelId} cannot run Career Agent because it does not support tool calling. Choose a model marked Career Agent ready in Model settings.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('cannot run Career Agent')) throw error;
    // Preserve support for non-Ollama OpenAI-compatible local endpoints.
  }
}

async function listProviderConnections(): Promise<Array<{
  id: string; label: string; kind: 'delegated_cli'; installed: boolean;
  authenticated: boolean | null; detail: string; defaultModel: string;
}>> {
  const runner = new NodeCliProcessRunner(app.getPath('temp'));
  return Promise.all(delegatedProviders.map(async (provider) => {
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
}

async function ensureChatSession(): Promise<{ id: string; name: string; createdAt: string; updatedAt: string }> {
  const db = getPersistence();
  const selected = await db.getSelectedChatSession();
  if (selected) return selected;
  const sessions = await db.listChatSessions();
  if (sessions.length > 0) {
    await db.selectChatSession(sessions[0].id);
    return sessions[0];
  }
  const now = new Date().toISOString();
  const created = { id: `session-${Date.now()}`, name: 'Career Agent Session', createdAt: now, updatedAt: now };
  await db.saveChatSession(created);
  await db.selectChatSession(created.id);
  return created;
}

async function getChatConversation(sessionIdValue: string): Promise<ModelMessage[]> {
  const messages = await getPersistence().listChatMessages(sessionIdValue);
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: message.content })) as ModelMessage[];
}

async function appendChatPair(
  sessionIdValue: string,
  userMessage: string,
  assistantMessage: string,
  sourceReferences: Array<{ type: string; workspaceId?: string; relativePath?: string; commitSha?: string; label?: string }>,
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
    createdAt: now,
  });
  await getPersistence().appendChatMessage({
    sessionId: sessionIdValue,
    sequence: assistantSequence,
    role: 'assistant',
    content: assistantMessage,
    sourceReferencesJson: JSON.stringify(sourceReferences),
    createdAt: now,
  });
}

async function getChatHistory(): Promise<Array<{
  userMessage: string;
  assistantMessage: string;
  sourceReferences: Array<{ type: string; workspaceId?: string; relativePath?: string; commitSha?: string; label?: string }>;
}>> {
  const sessionValue = await ensureChatSession();
  const messages = await getPersistence().listChatMessages(sessionValue.id);
  const exchanges: Array<{
    userMessage: string;
    assistantMessage: string;
    sourceReferences: Array<{ type: string; workspaceId?: string; relativePath?: string; commitSha?: string; label?: string }>;
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
    });
  }
  return exchanges;
}

async function runChatMessage(message: string): Promise<{
  userMessage: string;
  assistantMessage: string;
  sourceReferences: Array<{ type: string; workspaceId?: string; relativePath?: string; commitSha?: string; label?: string }>;
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
  toolRegistry.register(createFilesystemProposeWriteTool(approvalContext.service, sessionId));

  const toolExecutor = new ToolExecutor(toolRegistry);
  const runtime = createRuntime(endpoint, toolExecutor, workspaceContext.gateway);

  const loader = new CareerAgentLoader(new FileSystemAgentDefinitionSource(getCareerAgentDirectory()));
  const agent = loader.load();
  const contextBuilder = new ContextBuilder();
  const persistedConversation = await getChatConversation(chatSession.id);
  const nextConversation = [...persistedConversation, { role: 'user' as const, content: message }];
  const built = contextBuilder.buildRequest(
    {
      systemPrompt: agent.systemPrompt,
      memoryContext: agent.memoryContext,
      conversation: nextConversation,
      tools: toolRegistry.getModelTools(),
    },
    {
      maxInstructionsBytes: 16 * 1024,
      maxMemoryBytes: 8 * 1024,
      maxConversationBytes: 8 * 1024,
      maxToolResultBytes: 16 * 1024,
      maxTotalContentBytes: 48 * 1024,
    },
  );
  const result = await runtime.runWithTrace(
    built.request,
    {
      modelId: endpoint.modelId,
      executionMode: endpoint.mode === 'delegated' ? 'provider_allowed' : 'local_only',
      workspaceId: workspaceContext.selectedWorkspaceId,
    },
    new AbortController().signal,
  );
  await appendChatPair(chatSession.id, message, result.content, result.sourceReferences);
  return {
    userMessage: message,
    assistantMessage: result.content,
    sourceReferences: result.sourceReferences,
  };
}

function createRuntime(
  endpoint: EndpointConfig,
  toolExecutor: ToolExecutor,
  workspaceGateway: DefaultWorkspaceGateway,
): AgentRuntime {
  const intelligence: IntelligencePort = endpoint.mode === 'mock'
    ? new DesktopMockIntelligenceAdapter()
    : endpoint.mode === 'delegated'
      ? new DelegatedCliIntelligenceAdapter(
          getDelegatedProvider(endpoint.providerId ?? ''),
          new NodeCliProcessRunner(app.getPath('temp')),
        )
      : new OpenAICompatibleLocalAdapter(endpoint.baseUrl, new DefaultNetworkGateway());
  return new AgentRuntime(
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
      modelTimeoutMs: endpoint.mode === 'delegated' ? 120_000 : 30_000,
      toolTimeoutMs: 10_000,
    },
  );
}

async function runCareerAudit(): Promise<{
  title: string;
  summary: string;
  result: {
    content: string;
    workspaceIds: string[];
    sourceReferences: Array<{ type: string; workspaceId?: string; relativePath?: string; commitSha?: string; label?: string }>;
  };
}> {
  const endpoint = await getEndpointConfig();
  await assertEndpointWorkflowCompatible(endpoint);
  const workspaceContext = await ensureWorkspaceSelection();
  const approvalContext = await approvals();
  const db = getPersistence();

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(filesystemReadTool);
  toolRegistry.register(gitStatusTool);
  toolRegistry.register(gitLogTool);
  toolRegistry.register(gitDiffTool);
  toolRegistry.register(createFilesystemProposeWriteTool(approvalContext.service, sessionId));
  const toolExecutor = new ToolExecutor(toolRegistry);
  const runtime = createRuntime(endpoint, toolExecutor, workspaceContext.gateway);
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
      executionMode: endpoint.mode === 'delegated' ? 'provider_allowed' : 'local_only',
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
}> {
  const endpoint = await getEndpointConfig();
  await assertEndpointWorkflowCompatible(endpoint);
  const workspaceContext = await ensureWorkspaceSelection();
  const approvalContext = await approvals();
  const workspace = await getPersistence().getWorkspace(input.workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${input.workspaceId}`);
  const current = await workspaceContext.gateway.readFileIfExists(input.workspaceId, input.targetPath);
  const currentContent = current?.content ?? '';
  const mockProposedContent = `${currentContent.trimEnd()}\n\n## Proposed profile update\n\n${input.recommendation.trim()}\n`;
  const pendingBefore = new Set((await approvalContext.service.listPending()).map((action) => action.id));

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(createFilesystemProposeWriteTool(approvalContext.service, sessionId));
  const toolExecutor = new ToolExecutor(toolRegistry);

  const intelligence: IntelligencePort = endpoint.mode === 'mock'
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
    : new OpenAICompatibleLocalAdapter(endpoint.baseUrl, new DefaultNetworkGateway());

  const runtime = new AgentRuntime(
    intelligence,
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
      modelTimeoutMs: endpoint.mode === 'delegated' ? 120_000 : 30_000,
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
      executionMode: endpoint.mode === 'delegated' ? 'provider_allowed' : 'local_only',
      workspaceId: input.workspaceId,
    },
    new AbortController().signal,
  );

  const pending = await approvalContext.service.listPending();
  const latest = pending.find((action) => !pendingBefore.has(action.id));
  if (!latest) {
    throw new Error(`The model did not create a structured file proposal. ${runResult.content.trim() || 'Try refining the recommendation.'}`);
  }
  return {
    id: latest.id,
    status: latest.status,
    workspaceId: latest.workspaceId,
    targetPath: latest.targetPath,
    diff: latest.diff,
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
    if (!selected) await db.selectWorkspace(input.id);
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
  });

  ipcMain.handle(IPC_CHANNELS.removeWorkspace, async (_event, payload: unknown) => {
    const { id } = parseWorkspaceIdInput(payload);
    await getPersistence().removeWorkspace(id);
  });

  ipcMain.handle(IPC_CHANNELS.getEndpointConfig, async () => getEndpointConfig());

  ipcMain.handle(IPC_CHANNELS.listProviderConnections, async () => listProviderConnections());

  ipcMain.handle(IPC_CHANNELS.discoverLocalModels, async (_event, payload: unknown) => {
    const { baseUrl } = parseModelDiscoveryInput(payload);
    return discoverOllamaModels(baseUrl, new DefaultNetworkGateway(), new AbortController().signal);
  });

  ipcMain.handle(IPC_CHANNELS.saveEndpointConfig, async (_event, payload: unknown) => {
    const config = parseEndpointConfigInput(payload);
    await saveEndpointConfig(config);
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
    const { name } = parseCreateChatSessionInput(payload);
    const now = new Date().toISOString();
    const created = {
      id: `session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      createdAt: now,
      updatedAt: now,
    };
    const db = getPersistence();
    await db.saveChatSession(created);
    await db.selectChatSession(created.id);
    return { ...created, selected: true };
  });

  ipcMain.handle(IPC_CHANNELS.selectChatSession, async (_event, payload: unknown) => {
    const { id } = parseWorkspaceIdInput(payload);
    await getPersistence().selectChatSession(id);
  });

  ipcMain.handle(IPC_CHANNELS.getChatHistory, async () => getChatHistory());

  ipcMain.handle(IPC_CHANNELS.sendChatMessage, async (_event, payload: unknown) => {
    const { message } = parseChatMessageInput(payload);
    return runChatMessage(message);
  });

  ipcMain.handle(IPC_CHANNELS.listPendingActions, async () => {
    if ((await getPersistence().listWorkspaces()).length === 0) return [];
    const { service } = await approvals();
    return service.listPending();
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
