export type ExecutionMode = 'local_only';

export type SourceReference = {
  type: 'file' | 'git_commit' | 'git_diff' | 'memory';
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
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>;
  tools?: Array<{ name: string; description: string }>;
};

export type ToolCallRequest = {
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

