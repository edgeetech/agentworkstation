import { describe, expect, it } from 'vitest';
import { ClaudeWarmSessionAdapter, type ClaudeAgentSdkQueryFn } from '../../src/infrastructure/intelligence/claudeWarmSessionAdapter';
import type { ModelRequest } from '../../src/domain/intelligence';

type FakeMessage = Record<string, unknown>;
type Turn = FakeMessage[];

/** A fake SDK session: each prompt pulled from the input iterable is answered with the next scripted turn. */
function fakeSdk(turns: Turn[]): { queryFn: ClaudeAgentSdkQueryFn; calls: Array<{ options: Record<string, unknown> }>; prompts: string[] } {
  const calls: Array<{ options: Record<string, unknown> }> = [];
  const prompts: string[] = [];
  const queryFn = ((input: { prompt: AsyncIterable<{ message: { content: string } }>; options: Record<string, unknown> }) => {
    calls.push({ options: input.options });
    return (async function* session(): AsyncGenerator<FakeMessage> {
      for await (const user of input.prompt) {
        prompts.push(user.message.content);
        const turn = turns.shift();
        if (!turn) return;
        for (const message of turn) yield message;
      }
    })();
  }) as unknown as ClaudeAgentSdkQueryFn;
  return { queryFn, calls, prompts };
}

const text = (value: string): FakeMessage => ({ type: 'assistant', message: { content: [{ type: 'text', text: value }] } });
const result = (cost = 0.01): FakeMessage => ({ type: 'result', total_cost_usd: cost });
const allowed = { modelId: 'default', executionMode: 'provider_allowed' as const };
const signal = (): AbortSignal => new AbortController().signal;

describe('ClaudeWarmSessionAdapter', () => {
  it('blocks execution under local-only policy without starting a session', async () => {
    const { queryFn, calls } = fakeSdk([]);
    await expect(new ClaudeWarmSessionAdapter('/tmp', queryFn).execute(
      { messages: [{ role: 'user', content: 'hi' }] }, { modelId: 'default', executionMode: 'local_only' }, signal(),
    )).rejects.toThrow('blocked by local_only');
    expect(calls).toHaveLength(0);
  });

  it('isolates the session from user settings, tools, and permission prompts', async () => {
    const { queryFn, calls, prompts } = fakeSdk([[text('{"type":"text","content":"hi"}'), result()]]);
    await new ClaudeWarmSessionAdapter('/tmp', queryFn).execute({ messages: [{ role: 'user', content: 'hello' }] }, allowed, signal());
    expect(calls[0]!.options).toMatchObject({ tools: [], permissionMode: 'dontAsk', settingSources: [], includePartialMessages: true });
    expect(calls[0]!.options.model).toBeUndefined();
    expect(prompts[0]).toContain('Do not use your own tools');
  });

  it('reuses one session across tool steps and sends only unseen messages', async () => {
    const { queryFn, calls, prompts } = fakeSdk([
      [text('{"type":"tool_call","call":{"id":"c1","toolName":"git.log","input":{}}}'), result(0.02)],
      [text('{"type":"text","content":"done"}'), result(0.03)],
    ]);
    const adapter = new ClaudeWarmSessionAdapter('/tmp', queryFn);
    const first: ModelRequest = { messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'what changed?' }] };
    await expect(adapter.execute(first, allowed, signal())).resolves.toMatchObject({ type: 'tool_call' });
    expect(adapter.getLastUsage()?.totalCostUsd).toBe(0.02);
    const second: ModelRequest = {
      messages: [
        ...first.messages,
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', toolName: 'git.log', input: {} }] },
        { role: 'tool', content: '["abc123 fix"]', toolCallId: 'c1', toolName: 'git.log' },
      ],
    };
    await expect(adapter.execute(second, allowed, signal())).resolves.toEqual({ type: 'text', content: 'done' });
    expect(calls).toHaveLength(1);
    expect(prompts[1]).toContain('abc123 fix');
    expect(prompts[1]).not.toContain('what changed?');
    expect(adapter.getLastUsage()?.totalCostUsd).toBeCloseTo(0.01);
  });

  it('starts a new session when the conversation no longer extends what it sent', async () => {
    const { queryFn, calls } = fakeSdk([
      [text('{"type":"text","content":"a"}'), result()],
      [text('{"type":"text","content":"b"}'), result()],
    ]);
    const adapter = new ClaudeWarmSessionAdapter('/tmp', queryFn);
    await adapter.execute({ messages: [{ role: 'user', content: 'one' }] }, allowed, signal());
    await adapter.execute({ messages: [{ role: 'user', content: 'different' }] }, allowed, signal());
    expect(calls).toHaveLength(2);
  });

  it('streams the text of a final answer while it is generated', async () => {
    const delta = (value: string): FakeMessage => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: value } } });
    const { queryFn } = fakeSdk([[
      delta('{"type":"text","con'), delta('tent":"Hel'), delta('lo"}'),
      text('{"type":"text","content":"Hello"}'), result(),
    ]]);
    const streamed: string[] = [];
    await new ClaudeWarmSessionAdapter('/tmp', queryFn).execute(
      { messages: [{ role: 'user', content: 'hi' }] }, { ...allowed, onTextDelta: (value) => streamed.push(value) }, signal(),
    );
    expect(streamed.join('')).toBe('Hello');
  });

  it('accepts a final prose answer without the JSON envelope', async () => {
    const { queryFn } = fakeSdk([[text('Your last commit fixed a typo.'), result()]]);
    await expect(new ClaudeWarmSessionAdapter('/tmp', queryFn).execute({ messages: [{ role: 'user', content: 'hi' }] }, allowed, signal()))
      .resolves.toEqual({ type: 'text', content: 'Your last commit fixed a typo.' });
  });

  it('passes a configured model and surfaces rate limits as HTTP 429', async () => {
    const { queryFn, calls } = fakeSdk([[{ type: 'error', status: 429 }]]);
    await expect(new ClaudeWarmSessionAdapter('/tmp', queryFn).execute(
      { messages: [{ role: 'user', content: 'hi' }] }, { modelId: 'claude-sonnet-5', executionMode: 'provider_allowed' }, signal(),
    )).rejects.toThrow(/HTTP 429/);
    expect(calls[0]!.options.model).toBe('claude-sonnet-5');
  });

  it('discards a session after a failed turn so the next request starts clean', async () => {
    const { queryFn, calls } = fakeSdk([
      [{ type: 'result', is_error: true, result: 'overloaded' }],
      [text('{"type":"text","content":"ok"}'), result()],
    ]);
    const adapter = new ClaudeWarmSessionAdapter('/tmp', queryFn);
    const request: ModelRequest = { messages: [{ role: 'user', content: 'hi' }] };
    await expect(adapter.execute(request, allowed, signal())).rejects.toThrow('overloaded');
    await expect(adapter.execute(request, allowed, signal())).resolves.toEqual({ type: 'text', content: 'ok' });
    expect(calls).toHaveLength(2);
  });
});
