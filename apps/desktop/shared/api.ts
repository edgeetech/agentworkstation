export type SourceReference = {
  type: string;
  workspaceId?: string;
  relativePath?: string;
  commitSha?: string;
  label?: string;
};

export type DemoAudit = {
  title: string;
  summary: string;
  result: {
    content: string;
    workspaceIds: string[];
    sourceReferences: SourceReference[];
  };
};

export type PendingAction = {
  id: string;
  status: 'PROPOSED' | 'APPROVED' | 'EXECUTED' | 'REJECTED' | 'STALE';
  workspaceId: string;
  targetPath: string;
  diff: string;
  rejectionReason?: string;
};

export type WorkspaceRecord = {
  id: string;
  rootPath: string;
  kind: 'profile' | 'project' | 'cv';
  selected: boolean;
};

export type EndpointConfig = {
  mode: 'mock' | 'local' | 'delegated';
  baseUrl: string;
  modelId: string;
  providerId?: string;
  configured?: boolean;
};

export type ProviderConnection = {
  id: string;
  label: string;
  kind: 'delegated_cli';
  installed: boolean;
  authenticated: boolean | null;
  detail: string;
  defaultModel: string;
};

export type LocalModel = {
  id: string;
  size: number;
  modifiedAt?: string;
  capabilities: string[];
  toolCalling: boolean;
};

export type ProposalRequest = {
  workspaceId: string;
  targetPath: string;
  recommendation: string;
};

export type ChatExchange = {
  userMessage: string;
  assistantMessage: string;
  sourceReferences: SourceReference[];
};

export type ChatSessionRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  selected: boolean;
};

export type AgentWorkstationApi = {
  getDemoAudit: () => Promise<DemoAudit>;
  pickWorkspaceDirectory: () => Promise<string | null>;
  registerWorkspace: (input: { id: string; rootPath: string; kind: 'profile' | 'project' | 'cv' }) => Promise<void>;
  listWorkspaces: () => Promise<WorkspaceRecord[]>;
  selectWorkspace: (id: string) => Promise<void>;
  removeWorkspace: (id: string) => Promise<void>;
  getEndpointConfig: () => Promise<EndpointConfig>;
  listProviderConnections: () => Promise<ProviderConnection[]>;
  discoverLocalModels: (baseUrl: string) => Promise<LocalModel[]>;
  saveEndpointConfig: (config: EndpointConfig) => Promise<void>;
  testEndpointConnection: (config: EndpointConfig) => Promise<{ ok: true; message: string }>;
  listChatSessions: () => Promise<ChatSessionRecord[]>;
  createChatSession: (name: string) => Promise<ChatSessionRecord>;
  selectChatSession: (id: string) => Promise<void>;
  getChatHistory: () => Promise<ChatExchange[]>;
  sendChatMessage: (message: string) => Promise<ChatExchange>;
  listPendingActions: () => Promise<PendingAction[]>;
  proposeProfileUpdate: (input: ProposalRequest) => Promise<PendingAction>;
  approvePendingAction: (actionId: string) => Promise<PendingAction>;
  rejectPendingAction: (actionId: string, reason: string) => Promise<PendingAction>;
};
