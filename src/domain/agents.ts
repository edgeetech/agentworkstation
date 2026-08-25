export type AgentDefinition = {
  id: string;
  name: string;
  description: string;
  instructions: string[];
  workflows: string[];
  memoryDirectory: string;
  toolPolicies: Record<string, 'allow' | 'require_approval' | 'deny'>;
};

