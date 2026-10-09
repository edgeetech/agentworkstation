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

export type MemoryConfirmationStatus = 'pending' | 'confirmed' | 'rejected';

export type AgentMemoryEntry = {
  agentId: string;
  fieldKey: string;
  value: unknown;
  provenance: {
    source: 'user_message' | 'agent_learned';
    questionId: string;
    capturedAt: string;
  };
  confidence: number;
  confirmationStatus: MemoryConfirmationStatus;
  confirmedAt?: string;
  updatedAt: string;
};

export type OnboardingStep =
  | { kind: 'question'; question: OnboardingQuestion }
  | { kind: 'confirmation'; question: OnboardingQuestion; memory: AgentMemoryEntry }
  | { kind: 'complete'; intent: OnboardingIntent };

export type ExtractedMemoryValue = {
  value: unknown;
  confidence: number;
};

export interface AgentMemoryStore {
  getAgentMemory(agentId: string): Promise<AgentMemoryEntry[]>;
  getMemoryEntry(agentId: string, fieldKey: string): Promise<AgentMemoryEntry | null>;
  saveMemoryEntry(entry: AgentMemoryEntry): Promise<void>;
  getActiveOnboardingIntent(agentId: string): Promise<OnboardingIntent | null>;
  setActiveOnboardingIntent(agentId: string, intent: OnboardingIntent | null): Promise<void>;
}
