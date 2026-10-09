import { describe, expect, it } from 'vitest';
import {
  USER_KNOWLEDGE_INSTRUCTIONS,
  buildUserKnowledgeMemory,
  createRememberTool,
  summarizeAgentFolders,
} from '../../src/application/agents/userKnowledge';
import { parseDelegatedModelResponse } from '../../src/infrastructure/intelligence/delegatedCliAdapter';
import { AgentRuntime } from '../../src/application/intelligence';
import type { AgentMemoryEntry, AgentMemoryStore } from '../../src/domain/onboarding';

class MemoryStore implements AgentMemoryStore {
  entries: AgentMemoryEntry[] = [];
  async getAgentMemory(agentId: string) { return this.entries.filter((entry) => entry.agentId === agentId); }
  async getMemoryEntry(agentId: string, fieldKey: string) {
    return this.entries.find((entry) => entry.agentId === agentId && entry.fieldKey === fieldKey) ?? null;
  }
  async saveMemoryEntry(entry: AgentMemoryEntry) {
    this.entries = [...this.entries.filter((existing) => existing.agentId !== entry.agentId || existing.fieldKey !== entry.fieldKey), entry];
  }
  async getActiveOnboardingIntent() { return null; }
  async setActiveOnboardingIntent() {}
}

const registrations = [
  { id: 'organized-edgeetech', rootPath: 'C:/Users/me/OneDrive/Organized EdgeeTech', kind: 'project' as const },
  { id: 'Local', rootPath: 'C:/Workspace', kind: 'project' as const },
];

describe('knowing the user', () => {
  it('ranks the folders a specialist used before, ignoring unknown and unregistered ones', () => {
    const folders = summarizeAgentFolders([
      JSON.stringify([{ type: 'file', workspaceId: 'organized-edgeetech' }, { type: 'file', workspaceId: 'organized-edgeetech' }]),
      JSON.stringify([{ type: 'file', workspaceId: 'Local' }, { type: 'web', url: 'https://gov.uk' }, { type: 'file', workspaceId: 'removed' }]),
      'not json',
    ], registrations);
    expect(folders).toEqual([
      { id: 'organized-edgeetech', rootPath: 'C:/Users/me/OneDrive/Organized EdgeeTech', uses: 2 },
      { id: 'Local', rootPath: 'C:/Workspace', uses: 1 },
    ]);
  });

  it('tells every specialist to answer from the user\'s own material first', () => {
    expect(USER_KNOWLEDGE_INSTRUCTIONS).toContain('not a general assistant');
    expect(USER_KNOWLEDGE_INSTRUCTIONS).toContain('look in their own material first');
    expect(USER_KNOWLEDGE_INSTRUCTIONS).toContain('Go beyond a README');
    expect(USER_KNOWLEDGE_INSTRUCTIONS).toContain('memory.remember');
  });

  it('remembers durable facts by topic and shows them with setup answers and folders', async () => {
    const store = new MemoryStore();
    const remember = createRememberTool(store, 'accountant', () => new Date('2026-10-09T12:00:00Z'));
    await remember.execute({ fact: 'Payroll has one employee and one director.', topic: 'Payroll staff' }, { workspaceId: '', signal: new AbortController().signal });
    await remember.execute({ fact: 'Statutory Maternity Pay started on 1 September 2026.', topic: 'SMP' }, { workspaceId: '', signal: new AbortController().signal });
    await remember.execute({ fact: 'Payroll has two employees and one director.', topic: 'payroll staff' }, { workspaceId: '', signal: new AbortController().signal });
    await store.saveMemoryEntry({
      agentId: 'accountant', fieldKey: 'accountant.company', value: { name: 'EdgeeTech Ltd' },
      provenance: { source: 'user_message', questionId: 'company', capturedAt: '2026-09-30T00:00:00Z' },
      confidence: 1, confirmationStatus: 'confirmed', updatedAt: '2026-09-30T00:00:00Z',
    });
    const memory = await store.getAgentMemory('accountant');
    expect(memory.filter((entry) => entry.fieldKey.startsWith('learned.'))).toHaveLength(2);

    const text = buildUserKnowledgeMemory({ memory, folders: summarizeAgentFolders([JSON.stringify([{ workspaceId: 'organized-edgeetech' }])], registrations) });
    expect(text).toContain('accountant.company: {"name":"EdgeeTech Ltd"}');
    expect(text).toContain('- Payroll has two employees and one director.');
    expect(text).not.toContain('one employee');
    expect(text).toContain('- Statutory Maternity Pay started on 1 September 2026.');
    expect(text).toContain('workspace "organized-edgeetech" (C:/Users/me/OneDrive/Organized EdgeeTech), used in 1 earlier answers');
  });

  it('says plainly when nothing is known yet', () => {
    expect(buildUserKnowledgeMemory({ memory: [], folders: [] })).toContain('Nothing yet');
  });
});

describe('leaked XML tool calls', () => {
  it('turns an XML invoke written inside a text reply into a real tool call', () => {
    const response = parseDelegatedModelResponse(JSON.stringify({
      type: 'text',
      content: '<invoke name="web.read">\n<parameter name="url">https://www.gov.uk/recover-statutory-payments</parameter>\n</invoke>\n</invoke>',
    }));
    expect(response).toMatchObject({ type: 'tool_call', call: { toolName: 'web.read', input: { url: 'https://www.gov.uk/recover-statutory-payments' } } });
  });

  it('parses JSON parameter values and leaves ordinary text alone', () => {
    expect(parseDelegatedModelResponse(JSON.stringify({
      type: 'text', content: '<invoke name="git.log"><parameter name="maxCount">5</parameter></invoke>',
    }))).toMatchObject({ type: 'tool_call', call: { toolName: 'git.log', input: { maxCount: 5 } } });
    expect(parseDelegatedModelResponse(JSON.stringify({ type: 'text', content: 'Use <invoke> tags in XML.' })))
      .toEqual({ type: 'text', content: 'Use <invoke> tags in XML.' });
  });
});

describe('grounding check', () => {
  const executor = {
    execute: async () => ({ output: 'Sevdiye MATB1 received 8 Sep 2026', sourceReferences: [] }),
    getMetadata: () => ({ readOnly: true, sideEffect: 'none' as const, sensitive: false, requiresWorkspace: false }),
  };
  const gate = { decide: () => 'allow' as const };
  const limits = (check?: { toolPrefix: string; message: string }) => ({
    maxSteps: 6, maxToolCalls: 6, maxToolResultBytes: 10_000, modelTimeoutMs: 5_000, toolTimeoutMs: 5_000,
    ...(check ? { groundingCheck: check } : {}),
  });

  it('sends an ungrounded answer back once, then accepts the answer built from the user\'s files', async () => {
    const seen: string[] = [];
    let call = 0;
    const intelligence = {
      async execute(request: { messages: Array<{ role: string; content: string }> }) {
        seen.push(request.messages.at(-1)?.content ?? '');
        call += 1;
        if (call === 1) return { type: 'text' as const, content: 'In general, 28 days.' };
        if (call === 2) return { type: 'tool_call' as const, call: { id: 'c1', toolName: 'filesystem.search', input: { text: 'MATB1' } } };
        return { type: 'text' as const, content: 'Sevdiye sent MATB1 on 8 Sep, so SMP is due in the October payroll.' };
      },
    };
    const runtime = new AgentRuntime(intelligence as never, executor, gate, limits({ toolPrefix: 'filesystem.', message: 'CHECK THEIR FILES' }));
    const result = await runtime.runWithTrace({ messages: [{ role: 'user', content: 'SMP ne zaman?' }] }, { modelId: 'm', executionMode: 'provider_allowed' }, new AbortController().signal);
    expect(result.content).toContain('Sevdiye');
    expect(seen[1]).toBe('CHECK THEIR FILES');
  });

  it('does not loop: a second ungrounded answer is accepted, and no check runs when none is configured', async () => {
    const answer = { type: 'text' as const, content: 'General answer.' };
    let calls = 0;
    const intelligence = { async execute() { calls += 1; return answer; } };
    const checked = new AgentRuntime(intelligence as never, executor, gate, limits({ toolPrefix: 'filesystem.', message: 'CHECK' }));
    expect(await checked.run({ messages: [{ role: 'user', content: 'q' }] }, { modelId: 'm', executionMode: 'provider_allowed' }, new AbortController().signal)).toBe('General answer.');
    expect(calls).toBe(2);
    calls = 0;
    const unchecked = new AgentRuntime(intelligence as never, executor, gate, limits());
    await unchecked.run({ messages: [{ role: 'user', content: 'q' }] }, { modelId: 'm', executionMode: 'provider_allowed' }, new AbortController().signal);
    expect(calls).toBe(1);
  });
});
