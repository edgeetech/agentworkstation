import { z } from 'zod';

export const IPC_CHANNELS = {
  getDemoAudit: 'agentWorkstation:getDemoAudit',
  pickWorkspaceDirectory: 'agentWorkstation:pickWorkspaceDirectory',
  registerWorkspace: 'agentWorkstation:registerWorkspace',
  listWorkspaces: 'agentWorkstation:listWorkspaces',
  selectWorkspace: 'agentWorkstation:selectWorkspace',
  removeWorkspace: 'agentWorkstation:removeWorkspace',
  getEndpointConfig: 'agentWorkstation:getEndpointConfig',
  discoverLocalModels: 'agentWorkstation:discoverLocalModels',
  saveEndpointConfig: 'agentWorkstation:saveEndpointConfig',
  testEndpointConnection: 'agentWorkstation:testEndpointConnection',
  listChatSessions: 'agentWorkstation:listChatSessions',
  createChatSession: 'agentWorkstation:createChatSession',
  selectChatSession: 'agentWorkstation:selectChatSession',
  getChatHistory: 'agentWorkstation:getChatHistory',
  sendChatMessage: 'agentWorkstation:sendChatMessage',
  listPendingActions: 'agentWorkstation:listPendingActions',
  proposeProfileUpdate: 'agentWorkstation:proposeProfileUpdate',
  approvePendingAction: 'agentWorkstation:approvePendingAction',
  rejectPendingAction: 'agentWorkstation:rejectPendingAction',
} as const;

const workspaceIdSchema = z.object({
  id: z.string().min(1),
});

const registerWorkspaceSchema = z.object({
  id: z.string().min(1),
  rootPath: z.string().min(1),
  kind: z.enum(['profile', 'project', 'cv']),
});

const endpointConfigSchema = z.object({
  mode: z.enum(['mock', 'local']),
  baseUrl: z.string().min(1),
  modelId: z.string().min(1),
});

const chatMessageSchema = z.object({
  message: z.string().min(1),
});

const createChatSessionSchema = z.object({
  name: z.string().min(1),
});

const proposeProfileUpdateSchema = z.object({
  workspaceId: z.string().min(1),
  targetPath: z.string().min(1),
  recommendation: z.string().min(1),
});

const modelDiscoverySchema = z.object({
  baseUrl: z.string().url(),
});

const approveSchema = z.object({
  actionId: z.string().min(1),
});

const rejectSchema = z.object({
  actionId: z.string().min(1),
  reason: z.string().min(1),
});

export function parseApprovePendingActionInput(value: unknown): { actionId: string } {
  return approveSchema.parse(value);
}

export function parseWorkspaceIdInput(value: unknown): { id: string } {
  return workspaceIdSchema.parse(value);
}

export function parseRegisterWorkspaceInput(value: unknown): {
  id: string;
  rootPath: string;
  kind: 'profile' | 'project' | 'cv';
} {
  return registerWorkspaceSchema.parse(value);
}

export function parseEndpointConfigInput(value: unknown): {
  mode: 'mock' | 'local';
  baseUrl: string;
  modelId: string;
} {
  return endpointConfigSchema.parse(value);
}

export function parseChatMessageInput(value: unknown): { message: string } {
  return chatMessageSchema.parse(value);
}

export function parseCreateChatSessionInput(value: unknown): { name: string } {
  return createChatSessionSchema.parse(value);
}

export function parseProposeProfileUpdateInput(value: unknown): {
  workspaceId: string;
  targetPath: string;
  recommendation: string;
} {
  return proposeProfileUpdateSchema.parse(value);
}

export function parseModelDiscoveryInput(value: unknown): { baseUrl: string } {
  return modelDiscoverySchema.parse(value);
}

export function parseRejectPendingActionInput(value: unknown): { actionId: string; reason: string } {
  return rejectSchema.parse(value);
}
