import { describe, expect, it } from 'vitest';
import type { NetworkGateway } from '../../src/application/ports/NetworkGateway';
import { discoverOllamaModels, isOllamaCloudModel } from '../../src/infrastructure/intelligence/ollamaModelDiscovery';

describe('Ollama model discovery', () => {
  it('recognizes both Ollama cloud naming forms', () => {
    expect(isOllamaCloudModel('gpt-oss:120b-cloud')).toBe(true);
    expect(isOllamaCloudModel('minimax-m3:cloud')).toBe(true);
    expect(isOllamaCloudModel('qwen3:8b')).toBe(false);
  });

  it('loads, normalizes, and sorts installed models through the local-only gateway', async () => {
    const requests: Array<Parameters<NetworkGateway['send']>[0]> = [];
    const gateway: NetworkGateway = {
      async send(value) {
        requests.push(value);
        return {
          status: 200,
          body: value.url.endsWith('/api/tags')
            ? JSON.stringify({ models: [
                { name: 'qwen2.5:3b', size: 1_900_000_000 },
                { name: 'deepseek-coder:6.7b', size: 3_800_000_000 },
                { name: 'gpt-oss:120b-cloud', size: 512 },
              ] })
            : JSON.stringify({
                capabilities: value.body?.includes('deepseek-coder') ? ['completion'] : ['completion', 'tools'],
              }),
          activity: {
            url: value.url,
            method: value.method,
            purpose: value.purpose,
            destinationClass: 'local',
            status: 200,
            startedAt: new Date(0).toISOString(),
            durationMs: 1,
          },
        };
      },
    };

    await expect(discoverOllamaModels('http://localhost:11434/v1/', gateway, new AbortController().signal))
      .resolves.toEqual([
        { id: 'deepseek-coder:6.7b', size: 3_800_000_000, capabilities: ['completion'], toolCalling: false, location: 'local' },
        { id: 'gpt-oss:120b-cloud', size: 512, capabilities: ['completion', 'tools'], toolCalling: true, location: 'cloud' },
        { id: 'qwen2.5:3b', size: 1_900_000_000, capabilities: ['completion', 'tools'], toolCalling: true, location: 'local' },
      ]);
    expect(requests[0]).toMatchObject({
      url: 'http://localhost:11434/api/tags',
      method: 'GET',
      executionMode: 'local_only',
    });
    expect(requests.slice(1)).toHaveLength(3);
    expect(requests[1]).toMatchObject({ url: 'http://localhost:11434/api/show', method: 'POST' });
  });

  it('fails clearly on an invalid response', async () => {
    const gateway: NetworkGateway = {
      async send() {
        return {
          status: 200,
          body: 'not-json',
          activity: {
            url: 'http://localhost:11434/api/tags',
            method: 'GET',
            purpose: 'ollama-model-discovery',
            destinationClass: 'local',
            status: 200,
            startedAt: new Date(0).toISOString(),
            durationMs: 1,
          },
        };
      },
    };
    await expect(discoverOllamaModels('http://localhost:11434', gateway, new AbortController().signal))
      .rejects.toThrow('invalid model-list JSON');
  });
});
