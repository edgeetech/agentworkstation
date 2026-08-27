import { contextBridge, ipcRenderer } from 'electron';
import type { AgentWorkstationApi } from '../shared/api';

const IPC_CHANNELS = {
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
  getEndpointConfig: async () => ipcRenderer.invoke(IPC_CHANNELS.getEndpointConfig),
  discoverLocalModels: async (baseUrl) =>
    ipcRenderer.invoke(IPC_CHANNELS.discoverLocalModels, { baseUrl }),
  saveEndpointConfig: async (config) => ipcRenderer.invoke(IPC_CHANNELS.saveEndpointConfig, config),
  testEndpointConnection: async (config) => ipcRenderer.invoke(IPC_CHANNELS.testEndpointConnection, config),
  listChatSessions: async () => ipcRenderer.invoke(IPC_CHANNELS.listChatSessions),
  createChatSession: async (name) => ipcRenderer.invoke(IPC_CHANNELS.createChatSession, { name }),
  selectChatSession: async (id) => ipcRenderer.invoke(IPC_CHANNELS.selectChatSession, { id }),
  getChatHistory: async () => ipcRenderer.invoke(IPC_CHANNELS.getChatHistory),
  sendChatMessage: async (message) => ipcRenderer.invoke(IPC_CHANNELS.sendChatMessage, { message }),
  listPendingActions: async () => ipcRenderer.invoke(IPC_CHANNELS.listPendingActions),
  proposeProfileUpdate: async (input) => ipcRenderer.invoke(IPC_CHANNELS.proposeProfileUpdate, input),
  approvePendingAction: async (actionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.approvePendingAction, { actionId }),
  rejectPendingAction: async (actionId, reason) =>
    ipcRenderer.invoke(IPC_CHANNELS.rejectPendingAction, { actionId, reason }),
};

contextBridge.exposeInMainWorld('agentWorkstation', api);
