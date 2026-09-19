import { describe, expect, it } from 'vitest';
import { CopilotAgentSdkAdapter, type CopilotSdkFacade } from '../../src/infrastructure/intelligence/copilotAgentSdkAdapter';

type SessionEvent = { type: 'assistant.usage' | 'session.error'; data: Record<string, unknown> };

function fakeCopilotSdk(events: SessionEvent[], finalContent: string | undefined): {
  sdk: CopilotSdkFacade;
  calls: { clientOptions: unknown[]; sessionConfigs: unknown[]; sendAndWaitCalls: unknown[]; stopped: boolean; forceStopped: boolean };
} {
  const calls = {
    clientOptions: [] as unknown[],
    sessionConfigs: [] as unknown[],
    sendAndWaitCalls: [] as unknown[],
    stopped: false,
    forceStopped: false,
  };

  class FakeSession {
    handlers: Record<string, Array<(event: SessionEvent) => void>> = {};
    on(type: SessionEvent['type'], handler: (event: SessionEvent) => void): () => void {
      (this.handlers[type] ??= []).push(handler);
      return () => undefined;
    }
    async sendAndWait(options: { prompt: string }, timeout: number): Promise<{ data: { content: string } } | undefined> {
      calls.sendAndWaitCalls.push({ options, timeout });
      for (const event of events) {
        for (const handler of this.handlers[event.type] ?? []) handler(event);
      }
      return finalContent !== undefined ? { data: { content: finalContent } } : undefined;
    }
    async disconnect(): Promise<void> {}
  }

  class FakeClient {
    constructor(options: unknown) { calls.clientOptions.push(options); }
    async createSession(config: unknown): Promise<FakeSession> {
      calls.sessionConfigs.push(config);
      return new FakeSession();
    }
    async stop(): Promise<unknown[]> { calls.stopped = true; return []; }
    async forceStop(): Promise<void> { calls.forceStopped = true; }
  }

  const sdk: CopilotSdkFacade = {
    CopilotClient: FakeClient as unknown as CopilotSdkFacade['CopilotClient'],
    RuntimeConnection: { forStdio: (options) => ({ type: 'stdio', ...options }) },
    approveAll: () => ({ kind: 'approved' }),
  };
  return { sdk, calls };
}

describe('Copilot Agent SDK adapter', () => {
  it('blocks execution under local-only policy without creating a client', async () => {
    const { sdk, calls } = fakeCopilotSdk([], '{"type":"text","content":"hi"}');
    const adapter = new CopilotAgentSdkAdapter('/tmp', sdk);
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hello' }] },
      { modelId: 'auto', executionMode: 'local_only' },
      new AbortController().signal,
    )).rejects.toThrow('blocked by local_only');
    expect(calls.clientOptions).toHaveLength(0);
  });

  it('disables built-in tools and forbids interactive permission prompts', async () => {
    const { sdk, calls } = fakeCopilotSdk([], '{"type":"text","content":"hi"}');
    const adapter = new CopilotAgentSdkAdapter('/tmp', sdk);
    await adapter.execute(
      { messages: [{ role: 'user', content: 'hello' }] },
      { modelId: 'auto', executionMode: 'provider_allowed' },
      new AbortController().signal,
    );
    const config = calls.sessionConfigs[0] as { availableTools: string[]; model?: string };
    expect(config.availableTools).toEqual([]);
    expect(config.model).toBeUndefined();
    const call = calls.sendAndWaitCalls[0] as { options: { prompt: string } };
    expect(call.options.prompt).toContain('Do not use your own tools');
  });

  it('passes a specific model id through when one is configured', async () => {
    const { sdk, calls } = fakeCopilotSdk([], '{"type":"text","content":"hi"}');
    const adapter = new CopilotAgentSdkAdapter('/tmp', sdk);
    await adapter.execute(
      { messages: [{ role: 'user', content: 'hello' }] },
      { modelId: 'gpt-5', executionMode: 'provider_allowed' },
      new AbortController().signal,
    );
    expect((calls.sessionConfigs[0] as { model?: string }).model).toBe('gpt-5');
  });

  it('parses the final assistant message through the shared JSON envelope', async () => {
    const { sdk } = fakeCopilotSdk([], '{"type":"text","content":"hello there"}');
    const adapter = new CopilotAgentSdkAdapter('/tmp', sdk);
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'auto', executionMode: 'provider_allowed' },
      new AbortController().signal,
    )).resolves.toEqual({ type: 'text', content: 'hello there' });
  });

  it('parses a tool_call envelope the same way the CLI adapter does', async () => {
    const { sdk } = fakeCopilotSdk([], '{"type":"tool_call","call":{"id":"c1","toolName":"git.log","input":{"maxCount":2}}}');
    const adapter = new CopilotAgentSdkAdapter('/tmp', sdk);
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'auto', executionMode: 'provider_allowed' },
      new AbortController().signal,
    )).resolves.toEqual({ type: 'tool_call', call: { id: 'c1', toolName: 'git.log', input: { maxCount: 2 } } });
  });

  it('captures usage and cost from assistant.usage events', async () => {
    const { sdk } = fakeCopilotSdk([
      { type: 'assistant.usage', data: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 1, cost: 0.02, model: 'gpt-5' } },
    ], '{"type":"text","content":"hi"}');
    const adapter = new CopilotAgentSdkAdapter('/tmp', sdk);
    await adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'auto', executionMode: 'provider_allowed' },
      new AbortController().signal,
    );
    expect(adapter.getLastUsage()).toEqual({
      inputTokens: 10, outputTokens: 4, cacheCreationTokens: 0, cacheReadTokens: 1, totalCostUsd: 0.02, model: 'gpt-5',
    });
  });

  it('surfaces a rate limit as an HTTP 429 error the router can detect', async () => {
    const { sdk } = fakeCopilotSdk([
      { type: 'session.error', data: { errorType: 'rate_limit', message: 'too many requests' } },
    ], '{"type":"text","content":"hi"}');
    const adapter = new CopilotAgentSdkAdapter('/tmp', sdk);
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'auto', executionMode: 'provider_allowed' },
      new AbortController().signal,
    )).rejects.toThrow(/HTTP 429/);
  });

  it('rejects on a non-rate-limit session error', async () => {
    const { sdk } = fakeCopilotSdk([
      { type: 'session.error', data: { errorType: 'authentication', message: 'not signed in' } },
    ], '{"type":"text","content":"hi"}');
    const adapter = new CopilotAgentSdkAdapter('/tmp', sdk);
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'auto', executionMode: 'provider_allowed' },
      new AbortController().signal,
    )).rejects.toThrow('not signed in');
  });

  it('rejects on an empty final response', async () => {
    const { sdk } = fakeCopilotSdk([], undefined);
    const adapter = new CopilotAgentSdkAdapter('/tmp', sdk);
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'auto', executionMode: 'provider_allowed' },
      new AbortController().signal,
    )).rejects.toThrow('empty response');
  });

  it('always disconnects the session and stops the client', async () => {
    const { sdk, calls } = fakeCopilotSdk([], '{"type":"text","content":"hi"}');
    const adapter = new CopilotAgentSdkAdapter('/tmp', sdk);
    await adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'auto', executionMode: 'provider_allowed' },
      new AbortController().signal,
    );
    expect(calls.stopped).toBe(true);
  });
});
