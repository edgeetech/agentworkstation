import { describe, expect, it } from 'vitest';
import { OpenAICompatibleLocalAdapter } from '../../src/infrastructure/intelligence/openaiCompatibleLocalAdapter';
import type { NetworkGateway } from '../../src/application/ports/NetworkGateway';

const activity = {
  url: 'http://localhost:11434/v1/chat/completions',
  method: 'POST',
  purpose: 'model-inference',
  destinationClass: 'local' as const,
  status: 200,
  startedAt: '2026-08-26T00:00:00.000Z',
  durationMs: 1,
};

describe('openai-compatible local adapter', () => {
  it('maps response content', async () => {
    const mockGateway: NetworkGateway = {
      async send() {
        return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'hello' } }] }), activity };
      },
    };
    const adapter = new OpenAICompatibleLocalAdapter('http://localhost:11434', mockGateway);
    await expect(adapter.execute({ messages: [{ role: 'user', content: 'hi' }] }, { modelId: 'm', executionMode: 'local_only' }, new AbortController().signal)).resolves.toEqual({ type: 'text', content: 'hello' });
  });

  it('preserves tool call identity and arguments', async () => {
    const mockGateway: NetworkGateway = {
      async send() {
        return {
          status: 200,
          body: JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'call-1', function: { name: 'git.log', arguments: '{"limit":2}' } }] } }] }),
          activity,
        };
      },
    };
    const adapter = new OpenAICompatibleLocalAdapter('http://localhost:11434', mockGateway);
    await expect(adapter.execute({ messages: [{ role: 'user', content: 'recent work' }] }, { modelId: 'm', executionMode: 'local_only' }, new AbortController().signal)).resolves.toEqual({
      type: 'tool_call',
      call: { id: 'call-1', toolName: 'git.log', input: { limit: 2 } },
    });
  });

  it('serializes tool definitions and tool results using the OpenAI-compatible protocol', async () => {
    let sentBody = '';
    const mockGateway: NetworkGateway = {
      async send(request) {
        sentBody = request.body ?? '';
        return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'done' } }] }), activity };
      },
    };
    const adapter = new OpenAICompatibleLocalAdapter('http://localhost:11434', mockGateway);
    await adapter.execute({
      messages: [
        { role: 'user', content: 'recent work' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', toolName: 'git.log', input: { limit: 2 } }] },
        { role: 'tool', content: 'abc123 commit', toolCallId: 'call-1', toolName: 'git.log' },
      ],
      tools: [{
        name: 'git.log',
        description: 'Read git history',
        inputSchema: { type: 'object', required: ['limit'] },
      }],
    }, { modelId: 'm', executionMode: 'local_only' }, new AbortController().signal);

    const body = JSON.parse(sentBody) as { messages: Array<Record<string, unknown>>; tools: Array<{ function: { parameters: unknown } }> };
    expect(body.messages[1].tool_calls).toBeDefined();
    expect(body.messages[2].tool_call_id).toBe('call-1');
    expect(body.tools[0].function.parameters).toEqual({ type: 'object', required: ['limit'] });
  });
});

