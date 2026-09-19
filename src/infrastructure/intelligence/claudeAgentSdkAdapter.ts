import type { ExecutionMode, IntelligencePort, ModelRequest, ModelResponse } from '@domain/intelligence';
import { buildProviderPrompt, parseDelegatedModelResponse } from './delegatedCliAdapter';
import { buildDelegatedChildEnv } from './sessionEnv';

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

// tsc rewrites a literal `import()` into `require()` when emitting CommonJS (this
// project's module target). @anthropic-ai/claude-agent-sdk ships ESM-only, so a
// rewritten require() throws ERR_REQUIRE_ESM. The indirect call below is invisible
// to that rewrite and keeps a real dynamic import at runtime.
const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<ClaudeAgentSdkModule>;

let cachedQuery: ClaudeAgentSdkQueryFn | null = null;
async function loadQuery(): Promise<ClaudeAgentSdkQueryFn> {
  cachedQuery ??= (await importEsm('@anthropic-ai/claude-agent-sdk')).query;
  return cachedQuery;
}

const safeModel = (modelId: string): string => {
  if (!/^[a-zA-Z0-9._:/-]+$/.test(modelId)) throw new Error('Invalid delegated model ID');
  return modelId;
};

function accumulateUsage(usage: ClaudeAgentSdkUsage, source: Record<string, unknown>): void {
  const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
  usage.inputTokens += num(source.input_tokens);
  usage.outputTokens += num(source.output_tokens);
  usage.cacheCreationTokens += num(source.cache_creation_input_tokens);
  usage.cacheReadTokens += num(source.cache_read_input_tokens);
}

/**
 * Runs the Claude provider through the real @anthropic-ai/claude-agent-sdk `query()`
 * stream instead of spawning `claude --print --output-format json` and text-parsing
 * stdout. `tools: []` fully disables the SDK's own tool loop (Agent Workstation's own
 * ToolExecutor/PolicyGate stays the only place that can execute or approve tools);
 * the model is still asked to answer using the JSON envelope protocol so the response
 * shape matches `DelegatedCliIntelligenceAdapter` exactly.
 */
export class ClaudeAgentSdkAdapter implements IntelligencePort {
  private lastUsage: ClaudeAgentSdkUsage | null = null;

  constructor(
    private readonly cwd: string,
    private readonly queryFn?: ClaudeAgentSdkQueryFn,
  ) {}

  getLastUsage(): ClaudeAgentSdkUsage | null {
    return this.lastUsage;
  }

  async execute(
    request: ModelRequest,
    context: { modelId: string; executionMode: ExecutionMode },
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    if (context.executionMode === 'local_only') {
      throw new Error('Delegated provider blocked by local_only policy');
    }
    const query = this.queryFn ?? (await loadQuery());
    const abortController = new AbortController();
    const forwardAbort = (): void => abortController.abort(signal.reason);
    if (signal.aborted) forwardAbort();
    else signal.addEventListener('abort', forwardAbort, { once: true });

    const cleanEnv = buildDelegatedChildEnv();

    const usage: ClaudeAgentSdkUsage = {
      inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCostUsd: null, model: null,
    };
    let text = '';
    try {
      const stream = query({
        prompt: buildProviderPrompt(request),
        options: {
          cwd: this.cwd,
          maxTurns: 1,
          tools: [],
          permissionMode: 'dontAsk',
          env: cleanEnv,
          pathToClaudeCodeExecutable: 'claude',
          abortController,
          systemPrompt: 'You are an intelligence provider inside Agent Workstation. '
            + 'Follow the response protocol described in the user message exactly and do not use any tools.',
          ...(context.modelId !== 'default' ? { model: safeModel(context.modelId) } : {}),
        },
        // The SDK's Options type is intentionally not re-declared here; it is
        // maintained by @anthropic-ai/claude-agent-sdk and changes across versions.
      } as Parameters<ClaudeAgentSdkQueryFn>[0]);

      for await (const message of stream as AsyncIterable<Record<string, unknown>>) {
        if (message.type === 'assistant') {
          const inner = message.message as { content?: unknown; usage?: Record<string, unknown> } | undefined;
          if (Array.isArray(inner?.content)) {
            for (const block of inner.content) {
              if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
                text += (block as { text?: string }).text ?? '';
              }
            }
          }
          if (inner?.usage) accumulateUsage(usage, inner.usage);
        } else if (message.type === 'system' && message.subtype === 'init') {
          usage.model = typeof message.model === 'string' ? message.model : null;
        } else if (message.type === 'result') {
          if (typeof message.total_cost_usd === 'number' && message.total_cost_usd > 0) {
            usage.totalCostUsd = message.total_cost_usd;
          }
          if (message.usage && typeof message.usage === 'object') {
            accumulateUsage(usage, message.usage as Record<string, unknown>);
          }
          if (message.is_error) {
            const detail = typeof message.result === 'string' ? message.result : String(message.subtype ?? 'unknown error');
            throw new Error(`Anthropic Claude failed: ${detail}`);
          }
        } else if (message.type === 'error' && message.status === 429) {
          const retryAfterMs = typeof message.retry_after_ms === 'number' ? message.retry_after_ms : undefined;
          throw new Error(`HTTP 429: Anthropic Claude rate limit${retryAfterMs ? ` (retry after ${retryAfterMs}ms)` : ''}`);
        }
      }
    } finally {
      signal.removeEventListener('abort', forwardAbort);
    }
    this.lastUsage = usage;
    if (!text.trim()) throw new Error('Anthropic Claude returned an empty response');
    return parseDelegatedModelResponse(text);
  }
}
