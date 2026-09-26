import type { ExecutionMode, IntelligencePort, ModelMessage, ModelRequest, ModelResponse } from '@domain/intelligence';
import { buildProviderPrompt, parseDelegatedModelResponse } from './delegatedCliAdapter';
import { buildDelegatedChildEnv } from './sessionEnv';
import { EnvelopeTextStream } from './envelopeTextStream';
type ClaudeAgentSdkModule = typeof import('@anthropic-ai/claude-agent-sdk');
export type ClaudeAgentSdkQueryFn = ClaudeAgentSdkModule['query'];

export type ClaudeAgentSdkUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCostUsd: number | null;
  model: string | null;
};

type SdkMessage = Record<string, unknown>;
type UserMessage = { type: 'user'; message: { role: 'user'; content: string }; parent_tool_use_id: null };

// tsc rewrites a literal import() into require() for CommonJS output, and the SDK is
// ESM-only; this indirect call keeps a real dynamic import at runtime.
const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<ClaudeAgentSdkModule>;

const safeModel = (modelId: string): string => {
  if (!/^[a-zA-Z0-9._:/-]+$/.test(modelId)) throw new Error('Invalid delegated model ID');
  return modelId;
};

class PromptQueue implements AsyncIterable<UserMessage> {
  private readonly pending: UserMessage[] = [];
  private wake: (() => void) | null = null;
  private ended = false;

  push(content: string): void {
    this.pending.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });
    this.wake?.();
  }

  end(): void {
    this.ended = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<UserMessage> {
    while (!this.ended) {
      if (this.pending.length === 0) {
        await new Promise<void>((resolve) => { this.wake = resolve; });
        this.wake = null;
        continue;
      }
      yield this.pending.shift()!;
    }
  }
}

type LiveSession = {
  queue: PromptQueue;
  stream: AsyncIterable<SdkMessage> & { interrupt?: () => Promise<void>; return?: () => Promise<unknown> };
  iterator: AsyncIterator<SdkMessage>;
  sent: string[];
  toolsKey: string;
  modelId: string;
  busy: boolean;
  totalCostUsd: number;
  idleTimer?: ReturnType<typeof setTimeout>;
};

const key = (message: ModelMessage): string => JSON.stringify(message);

/** In a long session the model sometimes drops the envelope for a final prose answer; accept that as text. */
function parseReply(text: string): ModelResponse {
  const trimmed = text.trim();
  if (trimmed && !trimmed.startsWith('{') && !trimmed.startsWith('`')) return { type: 'text', content: trimmed };
  return parseDelegatedModelResponse(text);
}

/**
 * Runs the Claude provider through one long-lived Agent SDK session per
 * conversation instead of starting a fresh `claude` process for every model step.
 * Agent Workstation still owns the tool loop (ADR-007): the SDK's own tools stay
 * disabled and each step only sends the messages the session has not seen yet.
 * Text answers stream to `onTextDelta` as they are generated.
 */
export class ClaudeWarmSessionAdapter implements IntelligencePort {
  private readonly sessions: LiveSession[] = [];
  private lastUsage: ClaudeAgentSdkUsage | null = null;

  constructor(
    private readonly cwd: string,
    private readonly queryFn?: ClaudeAgentSdkQueryFn,
    private readonly limits: { maxSessions: number; idleMs: number } = { maxSessions: 3, idleMs: 10 * 60_000 },
  ) {}

  getLastUsage(): ClaudeAgentSdkUsage | null {
    return this.lastUsage;
  }

  async execute(
    request: ModelRequest,
    context: { modelId: string; executionMode: ExecutionMode; onTextDelta?: (delta: string) => void },
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    if (context.executionMode === 'local_only') throw new Error('Delegated provider blocked by local_only policy');
    signal.throwIfAborted();
    const toolsKey = JSON.stringify(request.tools ?? []);
    const messageKeys = request.messages.map(key);
    let session = this.sessions.find((candidate) => !candidate.busy
      && candidate.modelId === context.modelId
      && candidate.toolsKey === toolsKey
      && candidate.sent.length < messageKeys.length
      && candidate.sent.every((sent, index) => sent === messageKeys[index]));
    let prompt: string;
    if (session) {
      const fresh = request.messages.slice(session.sent.length);
      prompt = [
        'New messages since your last reply. Keep following the same response protocol:',
        'return exactly one JSON object, either {"type":"text","content":"..."} or',
        '{"type":"tool_call","call":{"id":"unique-id","toolName":"name","input":{}}}.',
        JSON.stringify({ messages: fresh }),
      ].join('\n');
    } else {
      session = await this.open(context.modelId, toolsKey);
      prompt = buildProviderPrompt(request);
    }
    session.busy = true;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    try {
      const text = await this.turn(session, prompt, signal, context.onTextDelta);
      const response = parseReply(text);
      const reply: ModelMessage = response.type === 'tool_call'
        ? { role: 'assistant', content: '', toolCalls: [{ id: response.call.id, toolName: response.call.toolName, input: response.call.input }] }
        : { role: 'assistant', content: response.type === 'text' ? response.content : '' };
      session.sent = [...messageKeys, key(reply)];
      session.busy = false;
      this.scheduleIdleClose(session);
      return response;
    } catch (error) {
      this.close(session);
      throw error;
    }
  }

  closeAll(): void {
    for (const session of [...this.sessions]) this.close(session);
  }

  private async open(modelId: string, toolsKey: string): Promise<LiveSession> {
    while (this.sessions.length >= this.limits.maxSessions) {
      const idle = this.sessions.find((candidate) => !candidate.busy);
      if (!idle) break;
      this.close(idle);
    }
    const query = this.queryFn ?? (await importEsm('@anthropic-ai/claude-agent-sdk')).query;
    const queue = new PromptQueue();
    const stream = query({
      prompt: queue,
      options: {
        cwd: this.cwd,
        tools: [],
        permissionMode: 'dontAsk',
        includePartialMessages: true,
        // Isolation: never load the user's Claude Code settings, hooks, plugins, or CLAUDE.md.
        settingSources: [],
        env: buildDelegatedChildEnv(),
        pathToClaudeCodeExecutable: 'claude',
        systemPrompt: 'You are an intelligence provider inside Agent Workstation. '
          + 'Follow the response protocol described in the user messages exactly and do not use any tools.',
        ...(modelId !== 'default' ? { model: safeModel(modelId) } : {}),
      },
    } as Parameters<ClaudeAgentSdkQueryFn>[0]) as unknown as LiveSession['stream'];
    const session: LiveSession = {
      queue, stream, iterator: stream[Symbol.asyncIterator](), sent: [], toolsKey, modelId, busy: false, totalCostUsd: 0,
    };
    this.sessions.push(session);
    return session;
  }

  private async turn(
    session: LiveSession,
    prompt: string,
    signal: AbortSignal,
    onTextDelta?: (delta: string) => void,
  ): Promise<string> {
    const usage: ClaudeAgentSdkUsage = {
      inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCostUsd: null, model: null,
    };
    const streamer = onTextDelta ? new EnvelopeTextStream(onTextDelta) : null;
    let text = '';
    const onAbort = (): void => { void session.stream.interrupt?.().catch(() => undefined); };
    signal.addEventListener('abort', onAbort, { once: true });
    session.queue.push(prompt);
    try {
      for (;;) {
        const next = await session.iterator.next();
        signal.throwIfAborted();
        if (next.done) throw new Error('Anthropic Claude session ended unexpectedly');
        const message = next.value;
        if (message.type === 'stream_event') {
          const event = message.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
          if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
            streamer?.push(event.delta.text);
          }
        } else if (message.type === 'assistant') {
          const inner = message.message as { content?: Array<{ type?: string; text?: string }>; usage?: Record<string, number> } | undefined;
          for (const block of inner?.content ?? []) if (block.type === 'text') text += block.text ?? '';
          if (inner?.usage) {
            usage.inputTokens += inner.usage.input_tokens ?? 0;
            usage.outputTokens += inner.usage.output_tokens ?? 0;
            usage.cacheCreationTokens += inner.usage.cache_creation_input_tokens ?? 0;
            usage.cacheReadTokens += inner.usage.cache_read_input_tokens ?? 0;
          }
        } else if (message.type === 'system' && message.subtype === 'init') {
          usage.model = typeof message.model === 'string' ? message.model : null;
        } else if (message.type === 'error' && message.status === 429) {
          throw new Error('HTTP 429: Anthropic Claude rate limit');
        } else if (message.type === 'result') {
          if (message.is_error) {
            const detail = typeof message.result === 'string' ? message.result : String(message.subtype ?? 'unknown error');
            throw new Error(`Anthropic Claude failed: ${detail}`);
          }
          const resultUsage = message.usage as Record<string, number> | undefined;
          if (resultUsage) {
            usage.inputTokens += resultUsage.input_tokens ?? 0;
            usage.outputTokens += resultUsage.output_tokens ?? 0;
            usage.cacheCreationTokens += resultUsage.cache_creation_input_tokens ?? 0;
            usage.cacheReadTokens += resultUsage.cache_read_input_tokens ?? 0;
          }
          if (typeof message.total_cost_usd === 'number' && message.total_cost_usd > 0) {
            // The SDK reports the session's cumulative cost; keep the per-step share.
            usage.totalCostUsd = Math.max(0, message.total_cost_usd - session.totalCostUsd);
            session.totalCostUsd = message.total_cost_usd;
          }
          break;
        }
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    this.lastUsage = usage;
    if (!text.trim()) throw new Error('Anthropic Claude returned an empty response');
    return text;
  }

  private scheduleIdleClose(session: LiveSession): void {
    session.idleTimer = setTimeout(() => this.close(session), this.limits.idleMs);
    session.idleTimer.unref?.();
  }

  private close(session: LiveSession): void {
    const index = this.sessions.indexOf(session);
    if (index >= 0) this.sessions.splice(index, 1);
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.queue.end();
    void session.stream.return?.().catch(() => undefined);
  }
}
