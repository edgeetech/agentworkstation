export type ExecutionMode = 'local_only';

export type SourceReference = {
  type: 'file' | 'git_commit' | 'git_diff' | 'git_status' | 'memory';
  workspaceId?: string;
  relativePath?: string;
  commitSha?: string;
  label?: string;
};

export type ToolMetadata = {
  readOnly: boolean;
  sideEffect: 'none' | 'propose' | 'external';
  sensitive: boolean;
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
    context: { modelId: string; executionMode: ExecutionMode },
    signal: AbortSignal,
  ): Promise<ModelResponse>;
}

