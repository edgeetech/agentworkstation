import { describe, expect, it } from 'vitest';
import { OpenAICompatibleLocalAdapter } from '../../src/infrastructure/intelligence/openaiCompatibleLocalAdapter';

describe('openai-compatible local adapter', () => {
  it('maps response content', async () => {
    const adapter = new OpenAICompatibleLocalAdapter('http://local', async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }), { status: 200 }));
    await expect(adapter.execute({ messages: [{ role: 'user', content: 'hi' }] }, { modelId: 'm', executionMode: 'local_only' }, new AbortController().signal)).resolves.toEqual({ type: 'text', content: 'hello' });
  });
});

