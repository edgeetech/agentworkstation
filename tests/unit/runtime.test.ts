import { describe, expect, it } from 'vitest';
import { AgentRuntime } from '../../src/application/intelligence';
import { MockIntelligenceAdapter } from '../../src/infrastructure/mock/mockIntelligence';

describe('agent runtime', () => {
  it('returns final text', async () => {
    const runtime = new AgentRuntime(
      new MockIntelligenceAdapter([{ type: 'text', content: 'done' }]),
      { execute: async () => ({ output: 'ok' }) },
      { decide: () => 'allow' },
      { maxSteps: 3, maxToolCalls: 3, maxToolResultBytes: 1024, modelTimeoutMs: 1000, toolTimeoutMs: 1000 },
    );
    await expect(runtime.run({ messages: [{ role: 'user', content: 'hi' }] }, { modelId: 'mock', executionMode: 'local_only', workspaceId: 'w' }, new AbortController().signal)).resolves.toBe('done');
  });
});

