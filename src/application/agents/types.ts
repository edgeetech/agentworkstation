import type { SourceReference } from '@domain/intelligence';

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
  toolPolicies: Record<string, AgentToolPolicy>;
};

export type AgentDefinition = AgentDefinitionMaterials & {
  systemPrompt: string;
  memoryContext: {
    content: string;
    byteLength: number;
    truncated: boolean;
    sourceReferences: SourceReference[];
  };
};
