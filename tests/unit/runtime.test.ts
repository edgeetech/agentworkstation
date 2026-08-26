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
      new MockIntelligenceAdapter([{ type: 'tool_call', call: { id: 'call-dangerous', toolName: 'dangerous', input: {} } }]),
      { execute: async () => ({ output: 'ok' }), getMetadata: () => ({ readOnly: false, sideEffect: 'external', sensitive: false }) },
      { decide: (metadata) => (metadata.sideEffect === 'external' ? 'deny' : 'allow') },
      { maxSteps: 1, maxToolCalls: 1, maxToolResultBytes: 1024, modelTimeoutMs: 1000, toolTimeoutMs: 1000 },
    );
    await expect(runtime.run({ messages: [{ role: 'user', content: 'hi' }] }, { modelId: 'mock', executionMode: 'local_only', workspaceId: 'w' }, new AbortController().signal)).rejects.toThrow('Tool not allowed');
  });

  it('enforces tool result size limits', async () => {
    const runtime = new AgentRuntime(
      new MockIntelligenceAdapter([{ type: 'tool_call', call: { id: 'call-echo', toolName: 'echo', input: {} } }]),
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

  it('returns deduplicated tool provenance from traced runs', async () => {
    const runtime = new AgentRuntime(
      new MockIntelligenceAdapter([
        { type: 'tool_call', call: { id: 'call-1', toolName: 'echo', input: {} } },
        { type: 'tool_call', call: { id: 'call-2', toolName: 'echo', input: {} } },
        { type: 'text', content: 'done' },
      ]),
      {
        execute: async () => ({
          output: 'ok',
          sourceReferences: [{ type: 'git_commit', workspaceId: 'w', commitSha: 'abc' }],
        }),
        getMetadata: () => ({ readOnly: true, sideEffect: 'none', sensitive: false }),
      },
      { decide: () => 'allow' },
      { maxSteps: 3, maxToolCalls: 3, maxToolResultBytes: 1024, modelTimeoutMs: 1000, toolTimeoutMs: 1000 },
    );

    await expect(runtime.runWithTrace(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'mock', executionMode: 'local_only', workspaceId: 'w' },
      new AbortController().signal,
    )).resolves.toEqual({
      content: 'done',
      sourceReferences: [{ type: 'git_commit', workspaceId: 'w', commitSha: 'abc' }],
    });
  });

  it('allows require_approval policy for propose-side-effect tools', async () => {
    const runtime = new AgentRuntime(
      new MockIntelligenceAdapter([
        { type: 'tool_call', call: { id: 'call-propose', toolName: 'filesystem.proposeWrite', input: {} } },
        { type: 'text', content: 'proposal created' },
      ]),
      {
        execute: async () => ({
          output: { actionId: 'pending-1' },
          sourceReferences: [{ type: 'file', workspaceId: 'w', relativePath: 'README.md', label: 'pending:pending-1' }],
        }),
        getMetadata: () => ({ readOnly: false, sideEffect: 'propose', sensitive: true }),
      },
      { decide: () => 'require_approval' },
      { maxSteps: 2, maxToolCalls: 2, maxToolResultBytes: 1024, modelTimeoutMs: 1000, toolTimeoutMs: 1000 },
    );

    await expect(runtime.run(
      { messages: [{ role: 'user', content: 'propose update' }] },
      { modelId: 'mock', executionMode: 'local_only', workspaceId: 'w' },
      new AbortController().signal,
    )).resolves.toBe('proposal created');
  });
});
