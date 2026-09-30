import type { ExecutionMode, IntelligencePort, ModelRequest, SourceReference, TaskKind } from '@domain/intelligence';
import type { ToolMetadata } from '@domain/intelligence';

export type ExecutionLimits = {
  maxSteps: number;
  maxToolCalls: number;
  maxToolResultBytes: number;
  modelTimeoutMs: number;
  toolTimeoutMs: number;
  /**
   * When set, running out of steps or tool calls pauses the run instead of failing it:
   * the model summarizes its progress and the caller can resume from the checkpoint.
   */
  pauseWhenBudgetExhausted?: boolean;
};

export type RunBudgetPause = {
  reason: 'steps' | 'tool_calls';
  stepsUsed: number;
  toolCallsUsed: number;
  /** The request as it stood when the budget ran out; pass it back to resume. */
  checkpoint: ModelRequest;
};

export type AgentRunResult = {
  content: string;
  sourceReferences: SourceReference[];
  paused?: RunBudgetPause;
};

const BUDGET_SUMMARY_INSTRUCTION = [
  "You have used this turn's step budget and cannot call more tools right now.",
  "Reply in the user's language with plain text only: summarize what you found so far,",
  'then list briefly what is still left to do. The user will be asked whether you should continue.',
].join(' ');

/** Progress signals a caller can surface while a run is in flight. */
export type AgentRunEvent =
  | { type: 'thinking'; step: number }
  | { type: 'tool'; step: number; toolName: string; target?: string }
  | { type: 'tool_failed'; step: number; toolName: string }
  | { type: 'text_delta'; step: number; delta: string };

export type AgentRunObserver = (event: AgentRunEvent) => void;

const toolTarget = (input: unknown): string | undefined => {
  if (input === null || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ['relativePath', 'path', 'url', 'targetPath', 'agent', 'query']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 160);
  }
  return undefined;
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

  async runWithTrace(
    request: ModelRequest,
    context: { modelId: string; executionMode: ExecutionMode; workspaceId?: string; taskKind?: TaskKind },
    signal: AbortSignal,
    observe?: AgentRunObserver,
  ): Promise<AgentRunResult> {
    let toolCalls = 0;
    let steps = 0;
    const sourceReferences: SourceReference[] = [];
    const emit = (event: AgentRunEvent): void => {
      try { observe?.(event); } catch { /* observers never change the run outcome */ }
    };
    for (let step = 0; step < this.limits.maxSteps; step += 1) {
      signal.throwIfAborted();
      steps = step + 1;
      emit({ type: 'thinking', step });
      const modelAbort = new AbortController();
      const response = await this.withTimeout(
        () => this.intelligence.execute(request, {
          modelId: context.modelId,
          executionMode: context.executionMode,
          taskKind: context.taskKind,
          ...(observe ? { onTextDelta: (delta: string) => emit({ type: 'text_delta', step, delta }) } : {}),
        }, AbortSignal.any([signal, modelAbort.signal])),
        this.limits.modelTimeoutMs,
        modelAbort,
        'Model timeout exceeded',
      );
      if (response.type === 'text') return { content: response.content, sourceReferences };
      if (response.type === 'error') throw new Error(response.error);
      if (toolCalls >= this.limits.maxToolCalls) {
        if (!this.limits.pauseWhenBudgetExhausted) throw new Error('Max tool calls exceeded');
        return this.pause('tool_calls', request, context, signal, emit, steps, toolCalls, sourceReferences);
      }
      toolCalls += 1;
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
      const target = toolTarget(response.call.input);
      emit({ type: 'tool', step, toolName: response.call.toolName, ...(target ? { target } : {}) });
      const toolAbort = new AbortController();
      let result: { output: unknown; sourceReferences: SourceReference[] };
      try {
        result = await this.withTimeout(
          () => this.toolExecutor.execute(response.call.toolName, response.call.input, { workspaceId: workspaceId ?? '', signal: AbortSignal.any([signal, toolAbort.signal]) }),
          metadata.timeoutMs ?? this.limits.toolTimeoutMs,
          toolAbort,
          'Tool timeout exceeded',
        );
      } catch (error) {
        emit({ type: 'tool_failed', step, toolName: response.call.toolName });
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
      let toolResult = JSON.stringify(output);
      const oversized = new TextEncoder().encode(toolResult).byteLength > this.limits.maxToolResultBytes;
      if (oversized) {
        emit({ type: 'tool_failed', step, toolName: response.call.toolName });
        toolResult = JSON.stringify({
          error: `Tool result exceeded ${this.limits.maxToolResultBytes} bytes. Request a smaller slice (for example a lower limit or a narrower path) and try again.`,
        });
      }
      for (const source of oversized ? [] : references) {
        const key = JSON.stringify(source);
        if (!sourceReferences.some((existing) => JSON.stringify(existing) === key)) sourceReferences.push(source);
      }
      const provenanceNote = !oversized && references.length > 0
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
    if (!this.limits.pauseWhenBudgetExhausted) throw new Error('Max steps exceeded');
    return this.pause('steps', request, context, signal, emit, steps, toolCalls, sourceReferences);
  }

  private async pause(
    reason: RunBudgetPause['reason'],
    checkpoint: ModelRequest,
    context: { modelId: string; executionMode: ExecutionMode; taskKind?: TaskKind },
    signal: AbortSignal,
    emit: (event: AgentRunEvent) => void,
    stepsUsed: number,
    toolCallsUsed: number,
    sourceReferences: SourceReference[],
  ): Promise<AgentRunResult> {
    const paused: RunBudgetPause = { reason, stepsUsed, toolCallsUsed, checkpoint };
    let content = '';
    try {
      const summaryAbort = new AbortController();
      const response = await this.withTimeout(
        () => this.intelligence.execute(
          { messages: [...checkpoint.messages, { role: 'user', content: BUDGET_SUMMARY_INSTRUCTION }], tools: [] },
          {
            modelId: context.modelId,
            executionMode: context.executionMode,
            taskKind: context.taskKind,
            onTextDelta: (delta: string) => emit({ type: 'text_delta', step: stepsUsed, delta }),
          },
          AbortSignal.any([signal, summaryAbort.signal]),
        ),
        this.limits.modelTimeoutMs,
        summaryAbort,
        'Model timeout exceeded',
      );
      if (response.type === 'text') content = response.content;
    } catch {
      // The pause itself is the outcome; a failed summary only loses the progress note.
      signal.throwIfAborted();
    }
    return { content, sourceReferences, paused };
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
