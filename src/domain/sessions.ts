export type AgentSession = {
  id: string;
  agentId: string;
  startedAt: string;
};

export type ChatMode = 'standard' | 'autopilot';

export type SessionIntelligencePreference = 'auto';
export type SessionPermissionMode = 'interactive';
export type SessionIsolationMode = 'read_only';

export type ChatSession = {
  id: string;
  name: string;
  mode: ChatMode;
  workspaceId?: string | null;
  agentId: string;
  intelligencePreference: SessionIntelligencePreference;
  permissionMode: SessionPermissionMode;
  isolationMode: SessionIsolationMode;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: number;
  sessionId: string;
  sequence: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  sourceReferencesJson: string;
  routingJson?: string | null;
  mode?: ChatMode | null;
  /** Set on an assistant reply that stopped at its step budget and can be resumed. */
  pausedJson?: string | null;
  createdAt: string;
};
