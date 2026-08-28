import { contextBridge, ipcRenderer } from 'electron';
import type { AgentWorkstationApi } from '../shared/api';

const IPC_CHANNELS = {
  getDemoAudit: 'agentWorkstation:getDemoAudit',
  pickWorkspaceDirectory: 'agentWorkstation:pickWorkspaceDirectory',
  registerWorkspace: 'agentWorkstation:registerWorkspace',
  listWorkspaces: 'agentWorkstation:listWorkspaces',
  selectWorkspace: 'agentWorkstation:selectWorkspace',
  removeWorkspace: 'agentWorkstation:removeWorkspace',
  listWorkspaceEntries: 'agentWorkstation:listWorkspaceEntries',
  readWorkspaceFile: 'agentWorkstation:readWorkspaceFile',
  getEndpointConfig: 'agentWorkstation:getEndpointConfig',
  listProviderConnections: 'agentWorkstation:listProviderConnections',
  discoverLocalModels: 'agentWorkstation:discoverLocalModels',
  saveEndpointConfig: 'agentWorkstation:saveEndpointConfig',
  testEndpointConnection: 'agentWorkstation:testEndpointConnection',
  listAgents: 'agentWorkstation:listAgents',
  listChatSessions: 'agentWorkstation:listChatSessions',
  createChatSession: 'agentWorkstation:createChatSession',
  renameChatSession: 'agentWorkstation:renameChatSession',
  setChatSessionMode: 'agentWorkstation:setChatSessionMode',
  deleteChatSession: 'agentWorkstation:deleteChatSession',
  selectChatSession: 'agentWorkstation:selectChatSession',
  getChatHistory: 'agentWorkstation:getChatHistory',
  getChatContextUsage: 'agentWorkstation:getChatContextUsage',
  sendChatMessage: 'agentWorkstation:sendChatMessage',
  listPendingActions: 'agentWorkstation:listPendingActions',
  proposeProfileUpdate: 'agentWorkstation:proposeProfileUpdate',
  approvePendingAction: 'agentWorkstation:approvePendingAction',
  rejectPendingAction: 'agentWorkstation:rejectPendingAction',
} as const;

declare global {
  interface Window {
    agentWorkstation: AgentWorkstationApi;
  }
}

const api: AgentWorkstationApi = {
  getDemoAudit: async () => ipcRenderer.invoke(IPC_CHANNELS.getDemoAudit),
  pickWorkspaceDirectory: async () => ipcRenderer.invoke(IPC_CHANNELS.pickWorkspaceDirectory),
  registerWorkspace: async (input) => ipcRenderer.invoke(IPC_CHANNELS.registerWorkspace, input),
  listWorkspaces: async () => ipcRenderer.invoke(IPC_CHANNELS.listWorkspaces),
  selectWorkspace: async (id) => ipcRenderer.invoke(IPC_CHANNELS.selectWorkspace, { id }),
  removeWorkspace: async (id) => ipcRenderer.invoke(IPC_CHANNELS.removeWorkspace, { id }),
  listWorkspaceEntries: async (workspaceId, relativePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.listWorkspaceEntries, { workspaceId, relativePath }),
  readWorkspaceFile: async (workspaceId, relativePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.readWorkspaceFile, { workspaceId, relativePath }),
  getEndpointConfig: async () => ipcRenderer.invoke(IPC_CHANNELS.getEndpointConfig),
  listProviderConnections: async () => ipcRenderer.invoke(IPC_CHANNELS.listProviderConnections),
  discoverLocalModels: async (baseUrl) =>
    ipcRenderer.invoke(IPC_CHANNELS.discoverLocalModels, { baseUrl }),
  saveEndpointConfig: async (config) => ipcRenderer.invoke(IPC_CHANNELS.saveEndpointConfig, config),
  testEndpointConnection: async (config) => ipcRenderer.invoke(IPC_CHANNELS.testEndpointConnection, config),
  listAgents: async () => ipcRenderer.invoke(IPC_CHANNELS.listAgents),
  listChatSessions: async () => ipcRenderer.invoke(IPC_CHANNELS.listChatSessions),
  createChatSession: async (input) => ipcRenderer.invoke(IPC_CHANNELS.createChatSession,
    typeof input === 'string'
      ? {
        name: input,
        agentId: 'career',
        intelligencePreference: 'auto',
        permissionMode: 'interactive',
        isolationMode: 'read_only',
      }
      : input),
  renameChatSession: async (id, name) => ipcRenderer.invoke(IPC_CHANNELS.renameChatSession, { id, name }),
  setChatSessionMode: async (id, mode) => ipcRenderer.invoke(IPC_CHANNELS.setChatSessionMode, { id, mode }),
  deleteChatSession: async (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteChatSession, { id }),
  selectChatSession: async (id) => ipcRenderer.invoke(IPC_CHANNELS.selectChatSession, { id }),
  getChatHistory: async () => ipcRenderer.invoke(IPC_CHANNELS.getChatHistory),
  getChatContextUsage: async () => ipcRenderer.invoke(IPC_CHANNELS.getChatContextUsage),
  sendChatMessage: async (message) => ipcRenderer.invoke(IPC_CHANNELS.sendChatMessage, { message }),
  listPendingActions: async () => ipcRenderer.invoke(IPC_CHANNELS.listPendingActions),
  proposeProfileUpdate: async (input) => ipcRenderer.invoke(IPC_CHANNELS.proposeProfileUpdate, input),
  approvePendingAction: async (actionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.approvePendingAction, { actionId }),
  rejectPendingAction: async (actionId, reason) =>
    ipcRenderer.invoke(IPC_CHANNELS.rejectPendingAction, { actionId, reason }),
};

contextBridge.exposeInMainWorld('agentWorkstation', api);
