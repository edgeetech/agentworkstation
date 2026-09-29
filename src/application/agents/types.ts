import type { SourceReference } from '@domain/intelligence';
import type { OnboardingQuestion } from '@domain/onboarding';

export type AgentToolPolicy = 'allow' | 'require_approval' | 'deny';

export type AgentContentFile = {
  relativePath: string;
  content: string;
};

export type AgentQuickAction = {
  id: string;
  title: string;
  prompt: string;
  workflow?: string;
};

export type AgentDefinitionMaterials = {
  id: string;
  name: string;
  description: string;
  instructions: AgentContentFile[];
  workflows: AgentContentFile[];
  memory: AgentContentFile[];
  quickActions: AgentQuickAction[];
  onboarding?: OnboardingQuestion[];
  toolPolicies: Record<string, AgentToolPolicy>;
  /** Intelligence candidates (for example "claude", "ollama") this agent may use; all allowed ones when absent. */
  intelligence?: string[];
};

export type AgentDefinition = Omit<AgentDefinitionMaterials, 'onboarding'> & {
  onboarding: OnboardingQuestion[];
  /** Created by the user in the app rather than shipped with it. */
  custom?: boolean;
  systemPrompt: string;
  memoryContext: {
    content: string;
    byteLength: number;
    truncated: boolean;
    sourceReferences: SourceReference[];
  };
};
