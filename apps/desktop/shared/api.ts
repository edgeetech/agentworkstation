export type SourceReference = {
  type: string;
  workspaceId?: string;
  relativePath?: string;
  commitSha?: string;
  url?: string;
  label?: string;
};

export type DemoAudit = {
  title: string;
  summary: string;
  result: {
    content: string;
    workspaceIds: string[];
    sourceReferences: SourceReference[];
    route?: RoutingDecision;
  };
};

export type PendingAction = {
  id: string;
  sessionId: string;
  status: 'PROPOSED' | 'APPROVED' | 'EXECUTED' | 'REJECTED' | 'STALE';
  workspaceId: string;
  targetPath: string;
  diff: string;
  rejectionReason?: string;
  route?: RoutingDecision;
};

/** Approve/reject tally over the most recent proposals for one agent, shown in the empty-state and session inspector. */
export type ProposalTally = {
  limit: number;
  total: number;
  approved: number;
  rejected: number;
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
  providerModelId?: string;
  routingPolicy?: 'local_only' | 'local_first' | 'adaptive';
  allowedPaths?: {
    localModels: boolean;
    ollamaCloudModels?: boolean;
    cloudProviders: boolean;
  };
  ollamaModelIds?: string[];
  providerIds?: string[];
  configured?: boolean;
};

export type WorkspaceEntry = {
  name: string;
  relativePath: string;
  kind: 'file' | 'directory';
};

export type WorkspaceFilePreview = {
  workspaceId: string;
  relativePath: string;
  content: string;
  truncated: boolean;
};

export type RoutingDecision = {
  policy: 'local_only' | 'local_first' | 'adaptive';
  location: 'local' | 'external' | 'simulated';
  providerId: string;
  providerLabel: string;
  modelId: string;
  reason: string;
  fallback: boolean;
  costUsd?: number | null;
  reportedModel?: string | null;
  authDisclosure?: string;
};

export type ProviderConnection = {
  id: string;
  label: string;
  kind: 'delegated_cli';
  installed: boolean;
  authenticated: boolean | null;
  detail: string;
  defaultModel: string;
  modelLabel?: string;
  version?: string;
  availability?: 'available' | 'limited' | 'unavailable' | 'unknown';
  lastError?: string;
};

export type LocalModel = {
  id: string;
  size: number;
  modifiedAt?: string;
  capabilities: string[];
  toolCalling: boolean;
  location: 'local' | 'cloud';
  availability?: 'available' | 'limited' | 'unavailable' | 'unknown';
  lastError?: string;
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
  route?: RoutingDecision;
  mode: ChatMode;
};

export type ChatContextUsage = {
  usedBytes: number;
  limitBytes: number;
  percentage: number;
  truncatedSections: Array<'instructions' | 'memory' | 'conversation' | 'toolResults'>;
};

export type ChatMode = 'standard' | 'autopilot';

export type ChatSessionRecord = {
  id: string;
  name: string;
  mode: ChatMode;
  workspaceId?: string | null;
  agentId: string;
  intelligencePreference: 'auto';
  permissionMode: 'interactive';
  isolationMode: 'read_only';
  createdAt: string;
  updatedAt: string;
  selected: boolean;
};

export type AgentQuickAction = {
  id: string;
  title: string;
  prompt: string;
  workflow?: string;
};

export type AgentSummary = {
  id: string;
  name: string;
  description: string;
  quickActions: AgentQuickAction[];
  onboarding: OnboardingQuestion[];
};

export type OnboardingIntent = 'initial' | 'publish' | 'linkedin';
export type OnboardingQuestion = {
  id: string;
  prompt: string;
  memoryKey: string;
  intent: OnboardingIntent;
  critical: boolean;
  required?: boolean;
  optional?: boolean;
  extractionHint: string;
};
export type AgentMemoryEntry = {
  agentId: string;
  fieldKey: string;
  value: unknown;
  provenance: { source: 'user_message'; questionId: string; capturedAt: string };
  confidence: number;
  confirmationStatus: 'pending' | 'confirmed' | 'rejected';
  confirmedAt?: string;
  updatedAt: string;
};
export type OnboardingStep =
  | { kind: 'question'; question: OnboardingQuestion }
  | { kind: 'confirmation'; question: OnboardingQuestion; memory: AgentMemoryEntry }
  | { kind: 'complete'; intent: OnboardingIntent };

export type PublicationSiteTarget = {
  displayDomain: string;
  workspaceId: string;
  contentDirectory: string;
  publishBranch: string;
  approvedAssetDirectories?: readonly string[];
  publicBaseUrl?: string;
};

export type LinkedInPublisherConfiguration = { clientId: string; apiVersion: string };

export type LinkedInConnectionState = {
  state: 'disconnected' | 'connecting' | 'connected' | 'expired' | 'error';
  member?: { subject: string; authorUrn: string; displayName?: string };
  expiresAt?: string;
  error?: string;
};

export type PublicationStage =
  | 'SITE_APPROVAL_PENDING'
  | 'SITE_APPROVED'
  | 'SITE_PUBLICATION_AWAITING_VERIFICATION'
  | 'SITE_PUBLISHED_VERIFIED'
  | 'LINKEDIN_APPROVAL_PENDING'
  | 'LINKEDIN_APPROVED'
  | 'LINKEDIN_SHARE_AWAITING_VERIFICATION'
  | 'LINKEDIN_SHARED_VERIFIED';

export type PublicationWorkflowSummary = {
  id: string;
  contentId: string;
  stage: PublicationStage;
  bundle: {
    contentId: string;
    primaryArticlePath: string;
    artifacts: readonly {
      path: string;
      sha256: string;
      role: 'primary-article' | 'translation' | 'visual-asset' | 'other-asset';
    }[];
  };
  publicationUrl?: string;
  linkedInShareUrl?: string;
  linkedInApproval?: {
    commentary: string;
    publicationUrl: string;
    authorUrn: string;
    memberDisplayName?: string;
    approvedBy?: string;
    approvedAt?: string;
  };
};

export type PublicationSetup = {
  siteTarget: PublicationSiteTarget | null;
  linkedInConfiguration: LinkedInPublisherConfiguration | null;
  linkedInState: LinkedInConnectionState;
  activeWorkflow: PublicationWorkflowSummary | null;
  history: readonly PublicationWorkflowSummary[];
};

export type StartPublicationInput = {
  contentId: string;
  primaryArticlePath: string;
  translationPaths: string[];
  visualAssetPaths?: string[];
  otherAssetPaths?: string[];
};

export type PublicationCandidateLanguage = 'tr' | 'en';

export type PublicationCandidate = {
  id: string;
  contentId: string;
  label: string;
  sessionId: string;
  sessionName: string;
  workspaceId: string;
  updatedAt: string;
  recommendedPrimaryLanguage: PublicationCandidateLanguage;
  articles: Record<PublicationCandidateLanguage, {
    language: PublicationCandidateLanguage;
    title: string;
    description?: string;
    path: string;
    preview: string;
    byteLength: number;
  }>;
  visuals: readonly {
    path: string;
    name: string;
    format: string;
    byteLength: number;
    width?: string;
    height?: string;
    altText?: string;
  }[];
};

export type CreateChatSessionInput = {
  name: string;
  workspaceId?: string;
  agentId: string;
  intelligencePreference: 'auto';
  permissionMode: 'interactive';
  isolationMode: 'read_only';
};

export type UsageLedgerSettings = {
  enabled: boolean;
  /** Absolute path to the folder holding the monthly `aw-usage-YYYY-MM.jsonl` files. */
  path: string;
};

/** Live progress for an in-flight chat request, pushed from the main process. */
export type ChatActivity = { requestId: string } & (
  | { type: 'thinking'; step: number }
  | { type: 'tool'; step: number; toolName: string; target?: string }
  | { type: 'tool_failed'; step: number; toolName: string }
  | { type: 'text_delta'; step: number; delta: string }
);

export type AgentWorkstationApi = {
  getDemoAudit: () => Promise<DemoAudit>;
  pickWorkspaceDirectory: () => Promise<string | null>;
  registerWorkspace: (input: { id: string; rootPath: string; kind: 'profile' | 'project' | 'cv' }) => Promise<void>;
  listWorkspaces: () => Promise<WorkspaceRecord[]>;
  selectWorkspace: (id: string) => Promise<void>;
  removeWorkspace: (id: string) => Promise<void>;
  listWorkspaceEntries: (workspaceId: string, relativePath: string) => Promise<WorkspaceEntry[]>;
  readWorkspaceFile: (workspaceId: string, relativePath: string) => Promise<WorkspaceFilePreview>;
  getEndpointConfig: () => Promise<EndpointConfig>;
  listProviderConnections: () => Promise<ProviderConnection[]>;
  discoverLocalModels: (baseUrl: string) => Promise<LocalModel[]>;
  saveEndpointConfig: (config: EndpointConfig) => Promise<void>;
  testEndpointConnection: (config: EndpointConfig) => Promise<{ ok: true; message: string }>;
  listAgents: () => Promise<AgentSummary[]>;
  renameAgentDisplayName: (agentId: string, displayName: string | null) => Promise<AgentSummary>;
  getAgentOnboarding: (agentId: string, intent?: OnboardingIntent) => Promise<OnboardingStep>;
  getAgentMemory: (agentId: string) => Promise<AgentMemoryEntry[]>;
  openAgentMemoryFile: (agentId: string) => Promise<string>;
  getPublicationSetup: () => Promise<PublicationSetup>;
  listPublicationCandidates: () => Promise<PublicationCandidate[]>;
  savePublicationSiteTarget: (target: PublicationSiteTarget) => Promise<PublicationSetup>;
  clearPublicationSiteTarget: () => Promise<PublicationSetup>;
  saveLinkedInPublisherConfiguration: (configuration: LinkedInPublisherConfiguration) => Promise<PublicationSetup>;
  connectLinkedIn: () => Promise<PublicationSetup>;
  disconnectLinkedIn: () => Promise<PublicationSetup>;
  startPublication: (input: StartPublicationInput) => Promise<PublicationSetup>;
  startPublicationCandidate: (
    candidateId: string,
    primaryLanguage: PublicationCandidateLanguage,
  ) => Promise<PublicationSetup>;
  approveSitePublication: () => Promise<PublicationSetup>;
  publishSite: () => Promise<PublicationSetup>;
  retrySiteVerification: () => Promise<PublicationSetup>;
  requestLinkedInApproval: (commentary: string) => Promise<PublicationSetup>;
  approveLinkedIn: () => Promise<PublicationSetup>;
  shareLinkedIn: () => Promise<PublicationSetup>;
  retryLinkedInVerification: () => Promise<PublicationSetup>;
  archivePublication: () => Promise<PublicationSetup>;
  listChatSessions: () => Promise<ChatSessionRecord[]>;
  createChatSession: (input: CreateChatSessionInput | string) => Promise<ChatSessionRecord>;
  renameChatSession: (id: string, name: string) => Promise<ChatSessionRecord>;
  setChatSessionMode: (id: string, mode: ChatMode) => Promise<ChatSessionRecord>;
  deleteChatSession: (id: string) => Promise<void>;
  selectChatSession: (id: string) => Promise<void>;
  getChatHistory: () => Promise<ChatExchange[]>;
  getChatContextUsage: () => Promise<ChatContextUsage>;
  sendChatMessage: (message: string, requestId: string, sessionId: string) => Promise<ChatExchange>;
  cancelChatMessage: (requestId: string) => Promise<boolean>;
  openExternalLink: (url: string) => Promise<void>;
  listPendingActions: () => Promise<PendingAction[]>;
  getProposalTally: (agentId: string) => Promise<ProposalTally>;
  proposeProfileUpdate: (input: ProposalRequest) => Promise<PendingAction>;
  approvePendingAction: (actionId: string) => Promise<PendingAction>;
  rejectPendingAction: (actionId: string, reason: string) => Promise<PendingAction>;
  setWindowTheme: (theme: 'light' | 'dark') => Promise<void>;
  getUsageLedgerSettings: () => Promise<UsageLedgerSettings>;
  setUsageLedgerEnabled: (enabled: boolean) => Promise<UsageLedgerSettings>;
  openUsageLedgerFolder: () => Promise<void>;
  onChatActivity: (listener: (activity: ChatActivity) => void) => () => void;
};
