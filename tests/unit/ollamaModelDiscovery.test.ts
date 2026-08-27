import { describe, expect, it } from 'vitest';
import type { NetworkGateway } from '../../src/application/ports/NetworkGateway';
import { discoverOllamaModels } from '../../src/infrastructure/intelligence/ollamaModelDiscovery';

describe('Ollama model discovery', () => {
  it('loads, normalizes, and sorts installed models through the local-only gateway', async () => {
    let request: Parameters<NetworkGateway['send']>[0] | undefined;
    const gateway: NetworkGateway = {
      async send(value) {
        request = value;
        return {
          status: 200,
          body: JSON.stringify({ models: [
            { name: 'qwen2.5:3b', size: 1_900_000_000 },
            { name: 'deepseek-coder:6.7b', size: 3_800_000_000 },
          ] }),
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
        { id: 'deepseek-coder:6.7b', size: 3_800_000_000 },
        { id: 'qwen2.5:3b', size: 1_900_000_000 },
      ]);
    expect(request).toMatchObject({
      url: 'http://localhost:11434/api/tags',
      method: 'GET',
      executionMode: 'local_only',
    });
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
