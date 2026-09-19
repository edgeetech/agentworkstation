export type ExecutionMode = 'local_only' | 'provider_allowed';
export type RoutingPolicy = 'local_only' | 'local_first' | 'adaptive';
export type TaskKind = 'chat' | 'audit' | 'proposal' | 'connection_test' | 'onboarding_extraction';

export type RoutingDecision = {
  policy: RoutingPolicy;
  location: 'local' | 'external' | 'simulated';
  providerId: string;
  providerLabel: string;
  modelId: string;
  reason: string;
  fallback: boolean;
};

export type ModelExecutionContext = {
  modelId: string;
  executionMode: ExecutionMode;
  taskKind?: TaskKind;
};

export type SourceReference = {
  type: 'file' | 'git_commit' | 'git_diff' | 'git_status' | 'memory' | 'web';
  workspaceId?: string;
  relativePath?: string;
  commitSha?: string;
  url?: string;
  label?: string;
};

export type ToolMetadata = {
  readOnly: boolean;
  sideEffect: 'none' | 'propose' | 'external';
  sensitive: boolean;
  requiresWorkspace?: boolean;
};

export type ModelCapabilities = {
  locality: 'local' | 'saas';
  toolCalling: boolean;
  structuredOutput: boolean;
  contextWindow?: number;
};

export type ModelRequest = {
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
};

export type ModelToolCall = {
  id: string;
  toolName: string;
  input: unknown;
};

export type ModelMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ModelToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; toolName: string };

export type ModelToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolCallRequest = {
  id: string;
  toolName: string;
  input: unknown;
};

export type ModelResponse =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; call: ToolCallRequest }
  | { type: 'error'; error: string };

export interface IntelligencePort {
  execute(
    request: ModelRequest,
    context: ModelExecutionContext,
    signal: AbortSignal,
  ): Promise<ModelResponse>;
}

