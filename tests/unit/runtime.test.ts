import { describe, expect, it } from 'vitest';
import { AgentRuntime } from '../../src/application/intelligence';
import { MockIntelligenceAdapter } from '../../src/infrastructure/mock/mockIntelligence';

describe('agent runtime', () => {
  it('returns final text', async () => {
    const runtime = new AgentRuntime(
      new MockIntelligenceAdapter([{ type: 'text', content: 'done' }]),
      { execute: async () => ({ output: 'ok' }), getMetadata: () => ({ readOnly: true, sideEffect: 'none', sensitive: false }) },
      { decide: () => 'allow' },
      { maxSteps: 3, maxToolCalls: 3, maxToolResultBytes: 1024, modelTimeoutMs: 1000, toolTimeoutMs: 1000 },
    );
    await expect(runtime.run({ messages: [{ role: 'user', content: 'hi' }] }, { modelId: 'mock', executionMode: 'local_only', workspaceId: 'w' }, new AbortController().signal)).resolves.toBe('done');
  });

  it('enforces policy based on tool metadata', async () => {
    const runtime = new AgentRuntime(
      new MockIntelligenceAdapter([{ type: 'tool_call', call: { toolName: 'dangerous', input: {} } }]),
      { execute: async () => ({ output: 'ok' }), getMetadata: () => ({ readOnly: false, sideEffect: 'external', sensitive: false }) },
      { decide: (metadata) => (metadata.sideEffect === 'external' ? 'deny' : 'allow') },
      { maxSteps: 1, maxToolCalls: 1, maxToolResultBytes: 1024, modelTimeoutMs: 1000, toolTimeoutMs: 1000 },
    );
    await expect(runtime.run({ messages: [{ role: 'user', content: 'hi' }] }, { modelId: 'mock', executionMode: 'local_only', workspaceId: 'w' }, new AbortController().signal)).rejects.toThrow('Tool not allowed');
  });

  it('enforces tool result size limits', async () => {
    const runtime = new AgentRuntime(
      new MockIntelligenceAdapter([{ type: 'tool_call', call: { toolName: 'echo', input: {} } }]),
      { execute: async () => ({ output: 'this result is too large' }), getMetadata: () => ({ readOnly: true, sideEffect: 'none', sensitive: false }) },
      { decide: () => 'allow' },
      { maxSteps: 1, maxToolCalls: 1, maxToolResultBytes: 5, modelTimeoutMs: 1000, toolTimeoutMs: 1000 },
    );
    await expect(runtime.run({ messages: [{ role: 'user', content: 'hi' }] }, { modelId: 'mock', executionMode: 'local_only', workspaceId: 'w' }, new AbortController().signal)).rejects.toThrow('Tool result too large');
  });

  it('enforces model timeout limits', async () => {
    const runtime = new AgentRuntime(
      {
        execute: async () => new Promise(() => {}),
      },
      { execute: async () => ({ output: 'ok' }), getMetadata: () => ({ readOnly: true, sideEffect: 'none', sensitive: false }) },
      { decide: () => 'allow' },
      { maxSteps: 1, maxToolCalls: 1, maxToolResultBytes: 1024, modelTimeoutMs: 10, toolTimeoutMs: 1000 },
    );
    await expect(runtime.run({ messages: [{ role: 'user', content: 'hi' }] }, { modelId: 'mock', executionMode: 'local_only', workspaceId: 'w' }, new AbortController().signal)).rejects.toThrow('Model timeout exceeded');
  });
});
