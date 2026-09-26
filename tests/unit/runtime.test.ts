import { describe, expect, it } from 'vitest';
import { AgentRuntime } from '../../src/application/intelligence';
import { MockIntelligenceAdapter } from '../../src/infrastructure/mock/mockIntelligence';

describe('agent runtime', () => {
  it('reports progress events to an observer without changing the result', async () => {
    const runtime = new AgentRuntime(
      new MockIntelligenceAdapter([
        { type: 'tool_call', call: { id: 'call-read', toolName: 'filesystem.read', input: { workspaceId: 'w', relativePath: 'README.md' } } },
        { type: 'tool_call', call: { id: 'call-fail', toolName: 'git.log', input: {} } },
        { type: 'text', content: 'done' },
      ]),
      {
        execute: async (toolName) => {
          if (toolName === 'git.log') throw new Error('no repo');
          return { output: 'ok', sourceReferences: [] };
        },
        getMetadata: () => ({ readOnly: true, sideEffect: 'none', sensitive: false }),
      },
      { decide: () => 'allow' },
      { maxSteps: 4, maxToolCalls: 4, maxToolResultBytes: 1024, modelTimeoutMs: 1000, toolTimeoutMs: 1000 },
    );
    const events: unknown[] = [];
    const result = await runtime.runWithTrace(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'mock', executionMode: 'local_only', workspaceId: 'w' },
      new AbortController().signal,
      (event) => { events.push(event); if (event.type === 'thinking' && event.step === 2) throw new Error('observer bug'); },
    );
    expect(result.content).toBe('done');
    expect(events).toEqual([
      { type: 'thinking', step: 0 },
      { type: 'tool', step: 0, toolName: 'filesystem.read', target: 'README.md' },
      { type: 'thinking', step: 1 },
      { type: 'tool', step: 1, toolName: 'git.log' },
      { type: 'tool_failed', step: 1, toolName: 'git.log' },
      { type: 'thinking', step: 2 },
    ]);
  });

  it('returns final text', async () => {
    const runtime = new AgentRuntime(
      new MockIntelligenceAdapter([{ type: 'text', content: 'done' }]),
      { execute: async () => ({ output: 'ok', sourceReferences: [] }), getMetadata: () => ({ readOnly: true, sideEffect: 'none', sensitive: false }) },
      { decide: () => 'allow' },
      { maxSteps: 3, maxToolCalls: 3, maxToolResultBytes: 1024, modelTimeoutMs: 1000, toolTimeoutMs: 1000 },
    );
    await expect(runtime.run({ messages: [{ role: 'user', content: 'hi' }] }, { modelId: 'mock', executionMode: 'local_only', workspaceId: 'w' }, new AbortController().signal)).resolves.toBe('done');
  });

  it('returns missing workspace access to the model instead of failing the conversation', async () => {
    const runtime = new AgentRuntime(
      new MockIntelligenceAdapter([
        { type: 'tool_call', call: { id: 'call-files', toolName: 'filesystem.read', input: { workspaceId: 'missing', relativePath: 'README.md' } } },
        { type: 'text', content: 'Please add the folder you want me to inspect, or we can continue without files.' },
      ]),
      {
        execute: async () => { throw new Error('tool executor must not run without a workspace'); },
        getMetadata: () => ({ readOnly: true, sideEffect: 'none', sensitive: true, requiresWorkspace: true }),
      },
      { decide: () => 'allow' },
      { maxSteps: 3, maxToolCalls: 3, maxToolResultBytes: 1024, modelTimeoutMs: 1000, toolTimeoutMs: 1000 },
    );

    await expect(runtime.run(
      { messages: [{ role: 'user', content: 'Read my latest article.' }] },
      { modelId: 'mock', executionMode: 'local_only' },
      new AbortController().signal,
    )).resolves.toContain('add the folder');
  });

  it('enforces policy based on tool metadata', async () => {
    const runtime = new AgentRuntime(
      new MockIntelligenceAdapter([{ type: 'tool_call', call: { id: 'call-dangerous', toolName: 'dangerous', input: {} } }]),
      { execute: async () => ({ output: 'ok', sourceReferences: [] }), getMetadata: () => ({ readOnly: false, sideEffect: 'external', sensitive: false }) },
      { decide: (metadata) => (metadata.sideEffect === 'external' ? 'deny' : 'allow') },
      { maxSteps: 1, maxToolCalls: 1, maxToolResultBytes: 1024, modelTimeoutMs: 1000, toolTimeoutMs: 1000 },
    );
    await expect(runtime.run({ messages: [{ role: 'user', content: 'hi' }] }, { modelId: 'mock', executionMode: 'local_only', workspaceId: 'w' }, new AbortController().signal)).rejects.toThrow('Tool not allowed');
  });

  it('enforces tool result size limits', async () => {
    const runtime = new AgentRuntime(
      new MockIntelligenceAdapter([{ type: 'tool_call', call: { id: 'call-echo', toolName: 'echo', input: {} } }]),
      { execute: async () => ({ output: 'this result is too large', sourceReferences: [] }), getMetadata: () => ({ readOnly: true, sideEffect: 'none', sensitive: false }) },
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
      { execute: async () => ({ output: 'ok', sourceReferences: [] }), getMetadata: () => ({ readOnly: true, sideEffect: 'none', sensitive: false }) },
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

  it('returns bounded tool failures to the model so it can recover', async () => {
    const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    let call = 0;
    const runtime = new AgentRuntime(
      {
        async execute(request) {
          requests.push(request as typeof requests[number]);
          call += 1;
          return call === 1
            ? { type: 'tool_call' as const, call: { id: 'missing-1', toolName: 'filesystem.read', input: { relativePath: 'profile.md' } } }
            : { type: 'text' as const, content: 'recovered' };
        },
      },
      {
        execute: async () => { throw new Error('ENOENT: profile.md'); },
        getMetadata: () => ({ readOnly: true, sideEffect: 'none', sensitive: true }),
      },
      { decide: () => 'allow' },
      { maxSteps: 2, maxToolCalls: 2, maxToolResultBytes: 1024, modelTimeoutMs: 1000, toolTimeoutMs: 1000 },
    );

    await expect(runtime.run(
      { messages: [{ role: 'user', content: 'inspect profile' }] },
      { modelId: 'mock', executionMode: 'local_only', workspaceId: 'w' },
      new AbortController().signal,
    )).resolves.toBe('recovered');
    expect(requests[1].messages.at(-1)?.content).toContain('ENOENT: profile.md');
  });
});
