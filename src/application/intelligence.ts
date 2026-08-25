import type { IntelligencePort, ModelRequest, ModelResponse } from '@domain/intelligence';

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
    private readonly toolExecutor: { execute(toolName: string, input: unknown, context: { workspaceId: string; signal: AbortSignal }): Promise<{ output: unknown }> },
    private readonly policyGate: { decide(metadata: { sideEffect: 'none' | 'propose' | 'external' }): 'allow' | 'require_approval' | 'deny' },
    private readonly limits: ExecutionLimits,
  ) {}

  async run(request: ModelRequest, context: { modelId: string; executionMode: 'local_only'; workspaceId: string }, signal: AbortSignal): Promise<string> {
    let toolCalls = 0;
    for (let step = 0; step < this.limits.maxSteps; step += 1) {
      signal.throwIfAborted();
      const response = await this.intelligence.execute(request, { modelId: context.modelId, executionMode: context.executionMode }, signal);
      if (response.type === 'text') return response.content;
      if (response.type === 'error') throw new Error(response.error);
      toolCalls += 1;
      if (toolCalls > this.limits.maxToolCalls) throw new Error('Max tool calls exceeded');
      const policy = this.policyGate.decide({ sideEffect: 'none' });
      if (policy !== 'allow') throw new Error('Tool not allowed');
      const result = await this.toolExecutor.execute(response.call.toolName, response.call.input, { workspaceId: context.workspaceId, signal });
      request = {
        messages: [...request.messages, { role: 'assistant', content: JSON.stringify(result.output) }],
        tools: request.tools,
      };
    }
    throw new Error('Max steps exceeded');
  }
}

