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
  renameAgentDisplayName: 'agentWorkstation:renameAgentDisplayName',
  getAgentOnboarding: 'agentWorkstation:getAgentOnboarding',
  getAgentMemory: 'agentWorkstation:getAgentMemory',
  openAgentMemoryFile: 'agentWorkstation:openAgentMemoryFile',
  getPublicationSetup: 'agentWorkstation:getPublicationSetup',
  listPublicationCandidates: 'agentWorkstation:listPublicationCandidates',
  savePublicationSiteTarget: 'agentWorkstation:savePublicationSiteTarget',
  clearPublicationSiteTarget: 'agentWorkstation:clearPublicationSiteTarget',
  saveLinkedInPublisherConfiguration: 'agentWorkstation:saveLinkedInPublisherConfiguration',
  connectLinkedIn: 'agentWorkstation:connectLinkedIn',
  disconnectLinkedIn: 'agentWorkstation:disconnectLinkedIn',
  startPublication: 'agentWorkstation:startPublication',
  startPublicationCandidate: 'agentWorkstation:startPublicationCandidate',
  approveSitePublication: 'agentWorkstation:approveSitePublication',
  publishSite: 'agentWorkstation:publishSite',
  retrySiteVerification: 'agentWorkstation:retrySiteVerification',
  requestLinkedInApproval: 'agentWorkstation:requestLinkedInApproval',
  approveLinkedIn: 'agentWorkstation:approveLinkedIn',
  shareLinkedIn: 'agentWorkstation:shareLinkedIn',
  retryLinkedInVerification: 'agentWorkstation:retryLinkedInVerification',
  archivePublication: 'agentWorkstation:archivePublication',
  listChatSessions: 'agentWorkstation:listChatSessions',
  createChatSession: 'agentWorkstation:createChatSession',
  renameChatSession: 'agentWorkstation:renameChatSession',
  setChatSessionMode: 'agentWorkstation:setChatSessionMode',
  deleteChatSession: 'agentWorkstation:deleteChatSession',
  selectChatSession: 'agentWorkstation:selectChatSession',
  getChatHistory: 'agentWorkstation:getChatHistory',
  getChatContextUsage: 'agentWorkstation:getChatContextUsage',
  sendChatMessage: 'agentWorkstation:sendChatMessage',
  cancelChatMessage: 'agentWorkstation:cancelChatMessage',
  openExternalLink: 'agentWorkstation:openExternalLink',
  listPendingActions: 'agentWorkstation:listPendingActions',
  getProposalTally: 'agentWorkstation:getProposalTally',
  proposeProfileUpdate: 'agentWorkstation:proposeProfileUpdate',
  approvePendingAction: 'agentWorkstation:approvePendingAction',
  rejectPendingAction: 'agentWorkstation:rejectPendingAction',
  setWindowTheme: 'agentWorkstation:setWindowTheme',
  getUsageLedgerSettings: 'agentWorkstation:getUsageLedgerSettings',
  setUsageLedgerEnabled: 'agentWorkstation:setUsageLedgerEnabled',
  openUsageLedgerFolder: 'agentWorkstation:openUsageLedgerFolder',
  getReminderSettings: 'agentWorkstation:getReminderSettings',
  setReminderSettings: 'agentWorkstation:setReminderSettings',
  getAppVersion: 'agentWorkstation:getAppVersion',
  installUpdateNow: 'agentWorkstation:installUpdateNow',
} as const;

const CHAT_ACTIVITY_EVENT = 'agentWorkstation:chatActivity';
const OPEN_AGENT_EVENT = 'agentWorkstation:openAgent';
const UPDATE_READY_EVENT = 'agentWorkstation:updateReady';

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
  renameAgentDisplayName: async (agentId, displayName) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameAgentDisplayName, { agentId, displayName }),
  getAgentOnboarding: async (agentId, intent = 'initial') =>
    ipcRenderer.invoke(IPC_CHANNELS.getAgentOnboarding, { agentId, intent }),
  getAgentMemory: async (agentId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getAgentMemory, { agentId, intent: 'initial' }),
  openAgentMemoryFile: async (agentId) =>
    ipcRenderer.invoke(IPC_CHANNELS.openAgentMemoryFile, { agentId, intent: 'initial' }),
  getPublicationSetup: async () => ipcRenderer.invoke(IPC_CHANNELS.getPublicationSetup),
  listPublicationCandidates: async () => ipcRenderer.invoke(IPC_CHANNELS.listPublicationCandidates),
  savePublicationSiteTarget: async (target) =>
    ipcRenderer.invoke(IPC_CHANNELS.savePublicationSiteTarget, target),
  clearPublicationSiteTarget: async () => ipcRenderer.invoke(IPC_CHANNELS.clearPublicationSiteTarget),
  saveLinkedInPublisherConfiguration: async (configuration) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveLinkedInPublisherConfiguration, configuration),
  connectLinkedIn: async () => ipcRenderer.invoke(IPC_CHANNELS.connectLinkedIn),
  disconnectLinkedIn: async () => ipcRenderer.invoke(IPC_CHANNELS.disconnectLinkedIn),
  startPublication: async (input) => ipcRenderer.invoke(IPC_CHANNELS.startPublication, input),
  startPublicationCandidate: async (candidateId, primaryLanguage) =>
    ipcRenderer.invoke(IPC_CHANNELS.startPublicationCandidate, { candidateId, primaryLanguage }),
  approveSitePublication: async () => ipcRenderer.invoke(IPC_CHANNELS.approveSitePublication),
  publishSite: async () => ipcRenderer.invoke(IPC_CHANNELS.publishSite),
  retrySiteVerification: async () => ipcRenderer.invoke(IPC_CHANNELS.retrySiteVerification),
  requestLinkedInApproval: async (commentary) =>
    ipcRenderer.invoke(IPC_CHANNELS.requestLinkedInApproval, { commentary }),
  approveLinkedIn: async () => ipcRenderer.invoke(IPC_CHANNELS.approveLinkedIn),
  shareLinkedIn: async () => ipcRenderer.invoke(IPC_CHANNELS.shareLinkedIn),
  retryLinkedInVerification: async () => ipcRenderer.invoke(IPC_CHANNELS.retryLinkedInVerification),
  archivePublication: async () => ipcRenderer.invoke(IPC_CHANNELS.archivePublication),
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
  sendChatMessage: async (message, requestId, sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.sendChatMessage, { message, requestId, sessionId }),
  cancelChatMessage: async (requestId) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelChatMessage, { requestId }),
  openExternalLink: async (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternalLink, { url }),
  listPendingActions: async () => ipcRenderer.invoke(IPC_CHANNELS.listPendingActions),
  getProposalTally: async (agentId) => ipcRenderer.invoke(IPC_CHANNELS.getProposalTally, { agentId }),
  proposeProfileUpdate: async (input) => ipcRenderer.invoke(IPC_CHANNELS.proposeProfileUpdate, input),
  approvePendingAction: async (actionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.approvePendingAction, { actionId }),
  rejectPendingAction: async (actionId, reason) =>
    ipcRenderer.invoke(IPC_CHANNELS.rejectPendingAction, { actionId, reason }),
  setWindowTheme: async (theme) => ipcRenderer.invoke(IPC_CHANNELS.setWindowTheme, { theme }),
  getUsageLedgerSettings: async () => ipcRenderer.invoke(IPC_CHANNELS.getUsageLedgerSettings),
  setUsageLedgerEnabled: async (enabled) => ipcRenderer.invoke(IPC_CHANNELS.setUsageLedgerEnabled, { enabled }),
  openUsageLedgerFolder: async () => ipcRenderer.invoke(IPC_CHANNELS.openUsageLedgerFolder),
  getReminderSettings: async () => ipcRenderer.invoke(IPC_CHANNELS.getReminderSettings),
  setReminderSettings: async (settings) => ipcRenderer.invoke(IPC_CHANNELS.setReminderSettings, settings),
  onChatActivity: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, activity: Parameters<typeof listener>[0]): void => listener(activity);
    ipcRenderer.on(CHAT_ACTIVITY_EVENT, handler);
    return () => { ipcRenderer.removeListener(CHAT_ACTIVITY_EVENT, handler); };
  },
  onOpenAgent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]): void => listener(payload);
    ipcRenderer.on(OPEN_AGENT_EVENT, handler);
    return () => { ipcRenderer.removeListener(OPEN_AGENT_EVENT, handler); };
  },
  getAppVersion: async () => ipcRenderer.invoke(IPC_CHANNELS.getAppVersion),
  installUpdateNow: async () => ipcRenderer.invoke(IPC_CHANNELS.installUpdateNow),
  onUpdateReady: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, info: Parameters<typeof listener>[0]): void => listener(info);
    ipcRenderer.on(UPDATE_READY_EVENT, handler);
    return () => { ipcRenderer.removeListener(UPDATE_READY_EVENT, handler); };
  },
};

contextBridge.exposeInMainWorld('agentWorkstation', api);
