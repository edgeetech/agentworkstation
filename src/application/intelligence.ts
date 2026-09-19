import type { ExecutionMode, IntelligencePort, ModelRequest, SourceReference, TaskKind } from '@domain/intelligence';
import type { ToolMetadata } from '@domain/intelligence';

export type ExecutionLimits = {
  maxSteps: number;
  maxToolCalls: number;
  maxToolResultBytes: number;
  modelTimeoutMs: number;
  toolTimeoutMs: number;
};

export type AgentRunResult = {
  content: string;
  sourceReferences: SourceReference[];
};

export class AgentRuntime {
  constructor(
    private readonly intelligence: IntelligencePort,
    private readonly toolExecutor: {
      execute(toolName: string, input: unknown, context: { workspaceId: string; signal: AbortSignal }): Promise<{ output: unknown; sourceReferences: SourceReference[] }>;
      getMetadata(toolName: string): ToolMetadata;
    },
    private readonly policyGate: { decide(metadata: { sideEffect: 'none' | 'propose' | 'external' }, toolName?: string): 'allow' | 'require_approval' | 'deny' },
    private readonly limits: ExecutionLimits,
  ) {}

  async run(request: ModelRequest, context: { modelId: string; executionMode: ExecutionMode; workspaceId?: string; taskKind?: TaskKind }, signal: AbortSignal): Promise<string> {
    return (await this.runWithTrace(request, context, signal)).content;
  }

  async runWithTrace(request: ModelRequest, context: { modelId: string; executionMode: ExecutionMode; workspaceId?: string; taskKind?: TaskKind }, signal: AbortSignal): Promise<AgentRunResult> {
    let toolCalls = 0;
    const sourceReferences: SourceReference[] = [];
    for (let step = 0; step < this.limits.maxSteps; step += 1) {
      signal.throwIfAborted();
      const modelAbort = new AbortController();
      const response = await this.withTimeout(
        () => this.intelligence.execute(request, {
          modelId: context.modelId,
          executionMode: context.executionMode,
          taskKind: context.taskKind,
        }, AbortSignal.any([signal, modelAbort.signal])),
        this.limits.modelTimeoutMs,
        modelAbort,
        'Model timeout exceeded',
      );
      if (response.type === 'text') return { content: response.content, sourceReferences };
      if (response.type === 'error') throw new Error(response.error);
      toolCalls += 1;
      if (toolCalls > this.limits.maxToolCalls) throw new Error('Max tool calls exceeded');
      const metadata = this.toolExecutor.getMetadata(response.call.toolName);
      const workspaceId = context.workspaceId;
      if (metadata.requiresWorkspace && !workspaceId) {
        request = {
          messages: [
            ...request.messages,
            {
              role: 'assistant',
              content: '',
              toolCalls: [{
                id: response.call.id,
                toolName: response.call.toolName,
                input: response.call.input,
              }],
            },
            {
              role: 'tool',
              content: JSON.stringify({
                error: 'Local workspace access is not configured. Continue without local files, or ask the user to add a folder from Workspaces when file access is essential.',
              }),
              toolCallId: response.call.id,
              toolName: response.call.toolName,
            },
          ],
          tools: request.tools,
        };
        continue;
      }
      const policy = this.policyGate.decide(metadata, response.call.toolName);
      if (policy === 'deny') throw new Error('Tool not allowed');
      if (policy === 'require_approval' && metadata.sideEffect !== 'propose') {
        throw new Error('Tool not allowed');
      }
      const toolAbort = new AbortController();
      let result: { output: unknown; sourceReferences: SourceReference[] };
      try {
        result = await this.withTimeout(
          () => this.toolExecutor.execute(response.call.toolName, response.call.input, { workspaceId: workspaceId ?? '', signal: AbortSignal.any([signal, toolAbort.signal]) }),
          this.limits.toolTimeoutMs,
          toolAbort,
          'Tool timeout exceeded',
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        request = {
          messages: [
            ...request.messages,
            {
              role: 'assistant',
              content: '',
              toolCalls: [{
                id: response.call.id,
                toolName: response.call.toolName,
                input: response.call.input,
              }],
            },
            {
              role: 'tool',
              content: JSON.stringify({ error: message.slice(0, 1_000) }),
              toolCallId: response.call.id,
              toolName: response.call.toolName,
            },
          ],
          tools: request.tools,
        };
        continue;
      }
      const output = result !== null && typeof result === 'object' && 'output' in result
        ? (result as { output: unknown }).output
        : result;
      const references = result !== null && typeof result === 'object' && Array.isArray((result as { sourceReferences?: unknown }).sourceReferences)
        ? (result as { sourceReferences: SourceReference[] }).sourceReferences
        : [];
      for (const source of references) {
        const key = JSON.stringify(source);
        if (!sourceReferences.some((existing) => JSON.stringify(existing) === key)) sourceReferences.push(source);
      }
      const toolResult = JSON.stringify(output);
      if (new TextEncoder().encode(toolResult).byteLength > this.limits.maxToolResultBytes) throw new Error('Tool result too large');
      const provenanceNote = references.length > 0
        ? `\n[source: ${references.map(r => r.type + (r.relativePath ? ':' + r.relativePath : '') + (r.label ? ':' + r.label : '')).join(', ')}]`
        : '';
      request = {
        messages: [
          ...request.messages,
          {
            role: 'assistant',
            content: '',
            toolCalls: [{
              id: response.call.id,
              toolName: response.call.toolName,
              input: response.call.input,
            }],
          },
          {
            role: 'tool',
            content: toolResult + provenanceNote,
            toolCallId: response.call.id,
            toolName: response.call.toolName,
          },
        ],
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
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
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
