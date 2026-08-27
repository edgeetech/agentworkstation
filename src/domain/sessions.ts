export type AgentSession = {
  id: string;
  agentId: string;
  startedAt: string;
};

export type ChatMode = 'standard' | 'autopilot';

export type ChatSession = {
  id: string;
  name: string;
  mode: ChatMode;
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
  createdAt: string;
};
