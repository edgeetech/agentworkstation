import { describe, expect, it, vi } from 'vitest';
import {
  createConsultTool,
  createSharedMemoryReadTool,
  mentionsOtherSpecialist,
  resolveAgentByName,
  type RosterEntry,
} from '../../src/application/agents/consultation';
import { AgentRuntime } from '../../src/application/intelligence';
import { AgentPolicyGate, ToolExecutor, ToolRegistry } from '../../src/application/tools';

const roster: RosterEntry[] = [
  { id: 'accountant', name: 'Skyler White', canonicalName: 'Accountant' },
  { id: 'blogger', name: 'Harry Wroter', canonicalName: 'Blogger' },
  { id: 'career', name: 'Last CVV', canonicalName: 'Career' },
  { id: 'saul-goodman', name: 'Saul Goodman', canonicalName: 'Saul Goodman' },
];
const context = () => ({ workspaceId: '', signal: new AbortController().signal });

describe('specialist name resolution', () => {
  it('finds a specialist by its current display name, original name, id, or first name', () => {
    expect(resolveAgentByName('Saul Goodman', roster)).toEqual({ kind: 'match', id: 'saul-goodman' });
    expect(resolveAgentByName('saul', roster)).toEqual({ kind: 'match', id: 'saul-goodman' });
    expect(resolveAgentByName('SKYLER', roster)).toEqual({ kind: 'match', id: 'accountant' });
    expect(resolveAgentByName('Accountant', roster)).toEqual({ kind: 'match', id: 'accountant' });
    expect(resolveAgentByName('saul-goodman', roster)).toEqual({ kind: 'match', id: 'saul-goodman' });
  });

  it('ignores Turkish case and diacritics', () => {
    const turkish = [...roster, { id: 'hukuk', name: 'Şükrü Işık', canonicalName: 'Hukuk' }];
    expect(resolveAgentByName('sukru isik', turkish)).toEqual({ kind: 'match', id: 'hukuk' });
    expect(resolveAgentByName('ŞÜKRÜ', turkish)).toEqual({ kind: 'match', id: 'hukuk' });
  });

  it('reports ambiguity instead of guessing and nothing for unknown names', () => {
    const twins = [...roster, { id: 'saul-2', name: 'Saul Berenson', canonicalName: 'Saul Berenson' }];
    expect(resolveAgentByName('Saul', twins)).toMatchObject({ kind: 'ambiguous', candidates: [{ id: 'saul-goodman' }, { id: 'saul-2' }] });
    expect(resolveAgentByName('Kim Wexler', roster)).toEqual({ kind: 'none' });
  });

  it('enables consulting only when the message names another specialist', () => {
    expect(mentionsOtherSpecialist("Saul Goodman'a danış, HMRC ile sorun olur mu?", roster, 'accountant')).toBe(true);
    expect(mentionsOtherSpecialist('saule sor bakalim', roster, 'accountant')).toBe(true);
    expect(mentionsOtherSpecialist("Saul'e sor", roster, 'accountant')).toBe(true);
    expect(mentionsOtherSpecialist('ask saul about this', roster, 'accountant')).toBe(true);
    expect(mentionsOtherSpecialist('ask Goodman about this', roster, 'accountant')).toBe(true);
    expect(mentionsOtherSpecialist('Prepare my VAT return', roster, 'accountant')).toBe(false);
    expect(mentionsOtherSpecialist('Skyler White here', roster, 'accountant')).toBe(false);
  });
});

describe('agents.consult', () => {
  it('lists the renamed roster and shareable memory keys for the model', () => {
    const tool = createConsultTool({ selfId: 'accountant', roster, memoryKeys: ['accountant.company'], consult: vi.fn() });
    expect(tool.description).toContain('- Saul Goodman');
    expect(tool.description).toContain('- Harry Wroter (Blogger)');
    expect(tool.description).not.toContain('Skyler White');
    expect(tool.description).toContain('accountant.company');
  });

  it('routes the question to the resolved specialist with memory references, not values', async () => {
    const consult = vi.fn(async () => ({ agentName: 'Saul Goodman', answer: 'Late filing risks penalties.', sourceReferences: [{ type: 'web' as const, url: 'https://www.gov.uk/x' }], partial: false }));
    const tool = createConsultTool({ selfId: 'accountant', roster, memoryKeys: ['accountant.company', 'memory/company.md'], consult });
    const result = await tool.execute({ agent: 'saul', question: 'Is this filing plan a problem with HMRC?', memoryRefs: ['accountant.company', 'accountant.company'] }, context());
    expect(consult).toHaveBeenCalledWith('saul-goodman', 'Is this filing plan a problem with HMRC?', ['accountant.company'], expect.any(AbortSignal));
    expect(result.output).toEqual({ specialist: 'Saul Goodman', answer: 'Late filing risks penalties.' });
    expect(result.sourceReferences).toEqual([{ type: 'web', url: 'https://www.gov.uk/x' }]);
  });

  it('refuses self-consultation, unknown names, ambiguous names, and unknown memory keys', async () => {
    const consult = vi.fn();
    const tool = createConsultTool({ selfId: 'accountant', roster, memoryKeys: ['accountant.company'], consult });
    await expect(tool.execute({ agent: 'Skyler', question: 'q' }, context())).rejects.toThrow('No specialist called');
    await expect(tool.execute({ agent: 'Kim', question: 'q' }, context())).rejects.toThrow('No specialist called');
    await expect(tool.execute({ agent: 'Saul', question: 'q', memoryRefs: ['bank.password'] }, context())).rejects.toThrow('Unknown memory keys');
    expect(consult).not.toHaveBeenCalled();
  });

  it('flags a partial answer when the consulted specialist ran out of budget', async () => {
    const tool = createConsultTool({ selfId: 'accountant', roster, memoryKeys: [], consult: async () => ({ agentName: 'Saul Goodman', answer: 'So far...', sourceReferences: [], partial: true }) });
    const result = await tool.execute({ agent: 'Saul Goodman', question: 'q' }, context());
    expect(result.output).toMatchObject({ note: expect.stringContaining('may be incomplete') });
  });

  it('gets a long timeout so a consultation is not cut off by the default tool timeout', () => {
    const tool = createConsultTool({ selfId: 'accountant', roster, memoryKeys: [], consult: vi.fn() });
    expect(tool.metadata.timeoutMs).toBeGreaterThanOrEqual(120_000);
  });
});

describe('consultation.readSharedMemory', () => {
  it('reads only the shared keys, live from the owner', async () => {
    let company = '{"name":"Old Ltd"}';
    const read = vi.fn(async (key: string) => (key === 'accountant.company' ? company : null));
    const tool = createSharedMemoryReadTool({ ownerName: 'Skyler White', keys: ['accountant.company'], read });
    company = '{"name":"New Ltd"}';
    const result = await tool.execute({ key: 'accountant.company' }, context());
    expect(result.output).toEqual({ key: 'accountant.company', value: '{"name":"New Ltd"}' });
    expect(result.sourceReferences).toEqual([{ type: 'memory', label: 'Skyler White: accountant.company' }]);
    await expect(tool.execute({ key: 'accountant.vat' }, context())).rejects.toThrow('did not share');
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('runtime tool timeouts', () => {
  it('uses a tool\'s own timeout over the runtime default', async () => {
    const registry = new ToolRegistry();
    registry.register(createConsultTool({
      selfId: 'accountant',
      roster,
      memoryKeys: [],
      consult: async () => { await new Promise((resolve) => setTimeout(resolve, 60)); return { agentName: 'Saul Goodman', answer: 'ok', sourceReferences: [], partial: false }; },
    }));
    const runtime = new AgentRuntime(
      {
        execute: vi.fn()
          .mockResolvedValueOnce({ type: 'tool_call', call: { id: 'c1', toolName: 'agents.consult', input: { agent: 'Saul', question: 'q' } } })
          .mockImplementationOnce(async (request) => ({ type: 'text', content: String(request.messages.at(-1)?.content) })),
      },
      new ToolExecutor(registry),
      new AgentPolicyGate({ 'agents.consult': 'allow' }),
      { maxSteps: 3, maxToolCalls: 2, maxToolResultBytes: 64 * 1024, modelTimeoutMs: 1_000, toolTimeoutMs: 10 },
    );
    await expect(runtime.run({ messages: [{ role: 'user', content: 'ask Saul' }] }, { modelId: 'm', executionMode: 'provider_allowed' }, new AbortController().signal))
      .resolves.toContain('"answer":"ok"');
  });
});
