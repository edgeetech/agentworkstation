export type ExecutionMode = 'local_only' | 'provider_allowed';
export type RoutingPolicy = 'local_only' | 'local_first' | 'adaptive';
export type TaskKind = 'chat' | 'audit' | 'proposal' | 'connection_test' | 'onboarding_extraction';

export type TokenUsage = { input: number; cachedInput: number; output: number };

export type RoutingDecision = {
  policy: RoutingPolicy;
  location: 'local' | 'external' | 'simulated';
  providerId: string;
  providerLabel: string;
  modelId: string;
  reason: string;
  fallback: boolean;
  costUsd?: number | null;
  /** Tokens the provider reported for this turn, for providers that bill by subscription and report no cost. */
  tokens?: TokenUsage | null;
  /** The model the provider actually reported (e.g. the Claude adapter's `getLastUsage().model`); null when unknown. */
  reportedModel?: string | null;
  /** ToS-relevant note surfaced in the UI, e.g. when a provider route uses a
   *  subscription login rather than metered API billing. */
  authDisclosure?: string;
};

export type ModelExecutionContext = {
  modelId: string;
  executionMode: ExecutionMode;
  taskKind?: TaskKind;
  /** Receives a final text answer while it is generated; adapters that cannot stream ignore it. */
  onTextDelta?: (delta: string) => void;
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
  /** Overrides the runtime's tool timeout for tools that legitimately run long. */
  timeoutMs?: number;
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

