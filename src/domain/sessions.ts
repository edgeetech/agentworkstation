export type AgentSession = {
  id: string;
  agentId: string;
  startedAt: string;
};

export type ChatSession = {
  id: string;
  name: string;
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
  createdAt: string;
};
