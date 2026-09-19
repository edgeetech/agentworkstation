import { describe, expect, it } from 'vitest';
import { ClaudeAgentSdkAdapter, type ClaudeAgentSdkQueryFn } from '../../src/infrastructure/intelligence/claudeAgentSdkAdapter';

type FakeMessage = Record<string, unknown>;

function fakeQuery(messages: FakeMessage[]): { queryFn: ClaudeAgentSdkQueryFn; calls: unknown[] } {
  const calls: unknown[] = [];
  const queryFn = ((input: unknown) => {
    calls.push(input);
    return (async function* generate(): AsyncGenerator<FakeMessage> {
      for (const message of messages) yield message;
    })();
  }) as unknown as ClaudeAgentSdkQueryFn;
  return { queryFn, calls };
}

function assistantText(text: string, usage?: Record<string, number>): FakeMessage {
  return { type: 'assistant', message: { content: [{ type: 'text', text }], ...(usage ? { usage } : {}) } };
}

describe('Claude Agent SDK adapter', () => {
  it('blocks execution under local-only policy without loading the SDK', async () => {
    const { queryFn, calls } = fakeQuery([]);
    const adapter = new ClaudeAgentSdkAdapter('/tmp', queryFn);
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hello' }] },
      { modelId: 'default', executionMode: 'local_only' },
      new AbortController().signal,
    )).rejects.toThrow('blocked by local_only');
    expect(calls).toHaveLength(0);
  });

  it('disables the SDK\'s own tools and forbids prompting for permission', async () => {
    const { queryFn, calls } = fakeQuery([
      assistantText('{"type":"text","content":"hi"}'),
      { type: 'result', total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 3 } },
    ]);
    const adapter = new ClaudeAgentSdkAdapter('/tmp', queryFn);
    await adapter.execute(
      { messages: [{ role: 'user', content: 'hello' }] },
      { modelId: 'default', executionMode: 'provider_allowed' },
      new AbortController().signal,
    );
    const call = calls[0] as { prompt: string; options: Record<string, unknown> };
    expect(call.options.tools).toEqual([]);
    expect(call.options.permissionMode).toBe('dontAsk');
    expect(call.options.pathToClaudeCodeExecutable).toBe('claude');
    expect(call.prompt).toContain('Do not use your own tools');
    expect(call.options.model).toBeUndefined();
  });

  it('strips nested-session and local-gateway env vars from the child process env', async () => {
    const original = { ...process.env };
    process.env.CLAUDECODE = '1';
    process.env.CLAUDE_CODE_MESSAGING_SOCKET = '\\\\.\\pipe\\test';
    process.env.CLAUDE_HOOKS_ENDPOINT = 'http://127.0.0.1:1/hooks';
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1';
    process.env.TAKSIM_EDGE_BASE_URL = 'http://127.0.0.1:2';
    try {
      const { queryFn, calls } = fakeQuery([assistantText('{"type":"text","content":"hi"}')]);
      const adapter = new ClaudeAgentSdkAdapter('/tmp', queryFn);
      await adapter.execute(
        { messages: [{ role: 'user', content: 'hello' }] },
        { modelId: 'default', executionMode: 'provider_allowed' },
        new AbortController().signal,
      );
      const env = (calls[0] as { options: { env: Record<string, string | undefined> } }).options.env;
      expect(env.CLAUDECODE).toBeUndefined();
      expect(env.CLAUDE_CODE_MESSAGING_SOCKET).toBeUndefined();
      expect(env.CLAUDE_HOOKS_ENDPOINT).toBeUndefined();
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(env.TAKSIM_EDGE_BASE_URL).toBeUndefined();
    } finally {
      process.env = original;
    }
  });

  it('passes a specific model id through when one is configured', async () => {
    const { queryFn, calls } = fakeQuery([assistantText('{"type":"text","content":"hi"}')]);
    const adapter = new ClaudeAgentSdkAdapter('/tmp', queryFn);
    await adapter.execute(
      { messages: [{ role: 'user', content: 'hello' }] },
      { modelId: 'claude-sonnet-4-6', executionMode: 'provider_allowed' },
      new AbortController().signal,
    );
    expect((calls[0] as { options: Record<string, unknown> }).options.model).toBe('claude-sonnet-4-6');
  });

  it('concatenates streamed text blocks and parses the JSON envelope', async () => {
    const { queryFn } = fakeQuery([
      assistantText('{"type":"text",'),
      assistantText('"content":"hello there"}'),
    ]);
    const adapter = new ClaudeAgentSdkAdapter('/tmp', queryFn);
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'default', executionMode: 'provider_allowed' },
      new AbortController().signal,
    )).resolves.toEqual({ type: 'text', content: 'hello there' });
  });

  it('parses a tool_call envelope the same way the CLI adapter does', async () => {
    const { queryFn } = fakeQuery([
      assistantText('{"type":"tool_call","call":{"id":"c1","toolName":"git.log","input":{"maxCount":2}}}'),
    ]);
    const adapter = new ClaudeAgentSdkAdapter('/tmp', queryFn);
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'default', executionMode: 'provider_allowed' },
      new AbortController().signal,
    )).resolves.toEqual({ type: 'tool_call', call: { id: 'c1', toolName: 'git.log', input: { maxCount: 2 } } });
  });

  it('captures usage, model, and cost from the stream', async () => {
    const { queryFn } = fakeQuery([
      { type: 'system', subtype: 'init', model: 'claude-sonnet-4-6' },
      assistantText('{"type":"text","content":"hi"}', { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 1 }),
      { type: 'result', total_cost_usd: 0.02, usage: { input_tokens: 2 } },
    ]);
    const adapter = new ClaudeAgentSdkAdapter('/tmp', queryFn);
    await adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'default', executionMode: 'provider_allowed' },
      new AbortController().signal,
    );
    expect(adapter.getLastUsage()).toEqual({
      inputTokens: 12, outputTokens: 4, cacheCreationTokens: 0, cacheReadTokens: 1, totalCostUsd: 0.02, model: 'claude-sonnet-4-6',
    });
  });

  it('surfaces a rate limit as an HTTP 429 error the router can detect', async () => {
    const { queryFn } = fakeQuery([{ type: 'error', status: 429, retry_after_ms: 5_000 }]);
    const adapter = new ClaudeAgentSdkAdapter('/tmp', queryFn);
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'default', executionMode: 'provider_allowed' },
      new AbortController().signal,
    )).rejects.toThrow(/HTTP 429/);
  });

  it('rejects when the turn ends in an SDK error result', async () => {
    const { queryFn } = fakeQuery([{ type: 'result', is_error: true, result: 'boom' }]);
    const adapter = new ClaudeAgentSdkAdapter('/tmp', queryFn);
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'default', executionMode: 'provider_allowed' },
      new AbortController().signal,
    )).rejects.toThrow('boom');
  });

  it('rejects on an empty final response', async () => {
    const { queryFn } = fakeQuery([{ type: 'result' }]);
    const adapter = new ClaudeAgentSdkAdapter('/tmp', queryFn);
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'default', executionMode: 'provider_allowed' },
      new AbortController().signal,
    )).rejects.toThrow('empty response');
  });

  it('aborts the SDK abort controller when the caller signal aborts', async () => {
    const calls: unknown[] = [];
    const queryFn = ((input: unknown) => {
      calls.push(input);
      const options = (input as { options: { abortController: AbortController } }).options;
      return (async function* generate(): AsyncGenerator<FakeMessage> {
        await new Promise((resolve) => options.abortController.signal.addEventListener('abort', resolve, { once: true }));
        throw new Error('aborted');
      })();
    }) as unknown as ClaudeAgentSdkQueryFn;
    const adapter = new ClaudeAgentSdkAdapter('/tmp', queryFn);
    const controller = new AbortController();
    const pending = adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'default', executionMode: 'provider_allowed' },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });
});
