import type { IntelligencePort, ModelRequest, ModelResponse, SourceReference } from '@domain/intelligence';
import type { ToolMetadata } from '@domain/intelligence';

export type ExecutionLimits = {
  maxSteps: number;
  maxToolCalls: number;
  maxToolResultBytes: number;
  modelTimeoutMs: number;
  toolTimeoutMs: number;
};

export class AgentRuntime {
  constructor(
    private readonly intelligence: IntelligencePort,
    private readonly toolExecutor: {
      execute(toolName: string, input: unknown, context: { workspaceId: string; signal: AbortSignal }): Promise<{ output: unknown; sourceReferences: SourceReference[] }>;
      getMetadata(toolName: string): ToolMetadata;
    },
    private readonly policyGate: { decide(metadata: { sideEffect: 'none' | 'propose' | 'external' }): 'allow' | 'require_approval' | 'deny' },
    private readonly limits: ExecutionLimits,
  ) {}

  async run(request: ModelRequest, context: { modelId: string; executionMode: 'local_only'; workspaceId: string }, signal: AbortSignal): Promise<string> {
    let toolCalls = 0;
    for (let step = 0; step < this.limits.maxSteps; step += 1) {
      signal.throwIfAborted();
      const modelAbort = new AbortController();
      const response = await this.withTimeout(
        () => this.intelligence.execute(request, { modelId: context.modelId, executionMode: context.executionMode }, AbortSignal.any([signal, modelAbort.signal])),
        this.limits.modelTimeoutMs,
        modelAbort,
        'Model timeout exceeded',
      );
      if (response.type === 'text') return response.content;
      if (response.type === 'error') throw new Error(response.error);
      toolCalls += 1;
      if (toolCalls > this.limits.maxToolCalls) throw new Error('Max tool calls exceeded');
      const policy = this.policyGate.decide(this.toolExecutor.getMetadata(response.call.toolName));
      if (policy !== 'allow') throw new Error('Tool not allowed');
      const toolAbort = new AbortController();
      const result = await this.withTimeout(
        () => this.toolExecutor.execute(response.call.toolName, response.call.input, { workspaceId: context.workspaceId, signal: AbortSignal.any([signal, toolAbort.signal]) }),
        this.limits.toolTimeoutMs,
        toolAbort,
        'Tool timeout exceeded',
      );
      const toolResult = JSON.stringify(result.output);
      if (Buffer.byteLength(toolResult, 'utf8') > this.limits.maxToolResultBytes) throw new Error('Tool result too large');
      const provenanceNote = result.sourceReferences.length > 0
        ? `\n[source: ${result.sourceReferences.map(r => r.type + (r.relativePath ? ':' + r.relativePath : '') + (r.label ? ':' + r.label : '')).join(', ')}]`
        : '';
      request = {
        messages: [...request.messages, { role: 'tool' as const, content: toolResult + provenanceNote }],
        tools: request.tools,
      };
    }
    throw new Error('Max steps exceeded');
  }

  private async withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    abortController: AbortController,
    timeoutMessage: string,
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        abortController.abort();
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });
    try {
      return await Promise.race([operation(), timeout]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
