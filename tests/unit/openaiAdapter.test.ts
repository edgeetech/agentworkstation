import { describe, expect, it } from 'vitest';
import { OpenAICompatibleLocalAdapter } from '../../src/infrastructure/intelligence/openaiCompatibleLocalAdapter';
import type { NetworkGateway } from '../../src/application/ports/NetworkGateway';

describe('openai-compatible local adapter', () => {
  it('maps response content', async () => {
    const mockGateway: NetworkGateway = {
      async send() {
        return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'hello' } }] }) };
      },
    };
    const adapter = new OpenAICompatibleLocalAdapter('http://localhost:11434', mockGateway);
    await expect(adapter.execute({ messages: [{ role: 'user', content: 'hi' }] }, { modelId: 'm', executionMode: 'local_only' }, new AbortController().signal)).resolves.toEqual({ type: 'text', content: 'hello' });
  });
});

