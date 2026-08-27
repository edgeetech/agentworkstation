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
import { MockIntelligenceAdapter } from '../../../src/infrastructure/mock/mockIntelligence';
import { DefaultNetworkGateway } from '../../../src/infrastructure/network/DefaultNetworkGateway';
import { SqlitePersistence } from '../../../src/infrastructure/persistence/sqlite';
import {
  IPC_CHANNELS,
  parseApprovePendingActionInput,
  parseChatMessageInput,
  parseCreateChatSessionInput,
  parseEndpointConfigInput,
  parseProposeProfileUpdateInput,
  parseRegisterWorkspaceInput,
  parseRejectPendingActionInput,
  parseWorkspaceIdInput,
} from './ipcContract';
import { getContentSecurityPolicy, isAllowedNavigation } from './security';

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
  mode: 'mock' | 'local';
  baseUrl: string;
  modelId: string;
  configured?: boolean;
};

async function getEndpointConfig(): Promise<EndpointConfig> {
  const raw = await getPersistence().getSetting(endpointSettingKey);
  if (!raw) return { mode: 'local', baseUrl: 'http://localhost:11434', modelId: 'llama3.1', configured: false };
  try {
    const parsed = JSON.parse(raw) as Partial<EndpointConfig>;
    if (parsed.mode !== 'mock' && parsed.mode !== 'local') throw new Error('Invalid mode');
    if (!parsed.baseUrl || !parsed.modelId) throw new Error('Invalid endpoint config');
    return { mode: parsed.mode, baseUrl: parsed.baseUrl, modelId: parsed.modelId, configured: true };
  } catch {
    return { mode: 'local', baseUrl: 'http://localhost:11434', modelId: 'llama3.1', configured: false };
  }
}

async function saveEndpointConfig(config: EndpointConfig): Promise<void> {
  await getPersistence().setSetting(endpointSettingKey, JSON.stringify(config));
}

async function testEndpointConnection(config: EndpointConfig): Promise<{ ok: true; message: string }> {
  if (config.mode === 'mock') return { ok: true, message: 'Demo mode is available. Responses will be simulated.' };
  const adapter = new OpenAICompatibleLocalAdapter(config.baseUrl, new DefaultNetworkGateway());
  const response = await adapter.execute(
    { messages: [{ role: 'user', content: 'Reply with OK.' }] },
    { modelId: config.modelId, executionMode: 'local_only' },
    new AbortController().signal,
  );
  if (response.type !== 'text' || !response.content.trim()) throw new Error('The local model returned an empty response');
  return { ok: true, message: `Connected to ${config.modelId}.` };
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
      executionMode: 'local_only',
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
      modelTimeoutMs: 30_000,
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
      tools: toolRegistry.getModelTools(),
    },
    new AbortController().signal,
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
      modelTimeoutMs: 30_000,
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
    { modelId: endpoint.modelId, executionMode: 'local_only', workspaceId: input.workspaceId },
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
