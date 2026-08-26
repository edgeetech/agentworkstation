import { describe, expect, it } from 'vitest';
import { DefaultNetworkGateway } from '../../src/infrastructure/network/DefaultNetworkGateway';

describe('NetworkGateway security', () => {
  it('blocks external destinations in local-only mode before fetch', async () => {
    let fetched = false;
    const gateway = new DefaultNetworkGateway(async () => {
      fetched = true;
      return new Response('unexpected');
    });

    await expect(gateway.send({
      url: 'https://api.openai.com/v1/chat/completions',
      method: 'POST',
      headers: {},
      purpose: 'model-inference',
      executionMode: 'local_only',
    }, new AbortController().signal)).rejects.toThrow('External network blocked');
    expect(fetched).toBe(false);
  });

  it('classifies and reports local activity', async () => {
    const observed: string[] = [];
    const gateway = new DefaultNetworkGateway(
      async () => new Response('ok', { status: 200 }),
      (activity) => observed.push(activity.destinationClass),
    );

    const response = await gateway.send({
      url: 'http://127.0.0.1:11434/v1/chat/completions',
      method: 'POST',
      headers: {},
      purpose: 'model-inference',
      executionMode: 'local_only',
    }, new AbortController().signal);

    expect(response.activity.destinationClass).toBe('local');
    expect(observed).toEqual(['local']);
  });
});
