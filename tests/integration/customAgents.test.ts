import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCustomAgentDraftRequest,
  customAgentIdFor,
  parseCustomAgentDraft,
  toolPoliciesFor,
} from '../../src/application/agents/customAgents';
import { FileSystemAgentCatalog } from '../../src/infrastructure/agents/FileSystemAgentCatalog';
import { FileSystemCustomAgentStore } from '../../src/infrastructure/agents/FileSystemCustomAgentStore';

const roots: string[] = [];
const tempRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-agents-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const saul = {
  name: 'Saul Goodman',
  description: 'Answers everyday legal questions and explains options in plain language.',
  instructions: '# Saul Goodman\n\nYou help with legal questions. Research current law before answering.',
  rules: '- You are not a substitute for a licensed lawyer.\n- Never invent statutes or cases.',
  starters: ['My landlord kept my deposit. What can I do?'],
  capabilities: { webResearch: true, readFiles: true, gitHistory: false, proposeFileChanges: false, consultSpecialists: true },
  intelligence: ['claude'],
};

describe('custom agents', () => {
  it('derives readable unique ids, including from Turkish names', () => {
    expect(customAgentIdFor('Saul Goodman', [])).toBe('saul-goodman');
    expect(customAgentIdFor('Saul Goodman', ['saul-goodman'])).toBe('saul-goodman-2');
    expect(customAgentIdFor('Hukuk Danışmanı Şükrü', [])).toBe('hukuk-danismani-sukru');
    expect(customAgentIdFor('!!!', [])).toBe('specialist');
    expect(customAgentIdFor('Career', ['career'])).toBe('career-2');
  });

  it('maps capabilities to tool policies with writes still behind approval', () => {
    expect(toolPoliciesFor({ webResearch: true, readFiles: false, gitHistory: true, proposeFileChanges: true, consultSpecialists: false })).toEqual({
      'web.search': 'allow',
      'web.read': 'allow',
      'git.log': 'allow',
      'git.status': 'allow',
      'git.diff': 'allow',
      'filesystem.proposeWrite': 'require_approval',
    });
  });

  it('creates an agent the catalog loads alongside the built-in specialists', () => {
    const customRoot = tempRoot();
    const store = new FileSystemCustomAgentStore(customRoot);
    const id = store.create(saul, ['career', 'blogger', 'accountant']);
    expect(id).toBe('saul-goodman');

    const catalog = new FileSystemAgentCatalog(path.resolve('src/agents'), 64 * 1024, customRoot);
    expect(catalog.list().map((agent) => agent.id)).toEqual(['accountant', 'blogger', 'career', 'saul-goodman']);
    const agent = catalog.get('saul-goodman');
    expect(agent).toMatchObject({ name: 'Saul Goodman', custom: true, intelligence: ['claude'] });
    expect(agent.toolPolicies).toEqual({
      'web.search': 'allow', 'web.read': 'allow', 'filesystem.read': 'allow', 'filesystem.readSharedPath': 'allow', 'agents.consult': 'allow',
    });
    expect(agent.systemPrompt).toContain('Research current law');
    expect(agent.systemPrompt).toContain('Never invent statutes');
    expect(agent.quickActions).toEqual([{ id: 'starter-1', title: 'My landlord kept my deposit. What can I do?', prompt: saul.starters[0] }]);
    expect(catalog.get('career').custom).toBeUndefined();
  });

  it('reads back, updates, and deletes a custom agent', () => {
    const store = new FileSystemCustomAgentStore(tempRoot());
    const id = store.create(saul, []);
    expect(store.read(id)).toEqual(saul);
    store.update(id, { ...saul, rules: '', intelligence: [], capabilities: { ...saul.capabilities, gitHistory: true } });
    expect(store.read(id)).toMatchObject({ rules: '', intelligence: [], capabilities: { gitHistory: true } });
    expect(fs.existsSync(path.join(store.directory(id), 'RULES.md'))).toBe(false);
    store.delete(id);
    expect(fs.existsSync(store.directory(id))).toBe(false);
  });

  it('never lets a custom agent shadow a built-in specialist', () => {
    const customRoot = tempRoot();
    fs.mkdirSync(path.join(customRoot, 'fake-career'));
    fs.writeFileSync(path.join(customRoot, 'fake-career', 'AGENT.md'), 'fake');
    fs.writeFileSync(path.join(customRoot, 'fake-career', 'agent.yaml'), 'id: career\nname: Fake\ndescription: x\ninstructions: [AGENT.md]\ntoolPolicies: {}\n');
    const catalog = new FileSystemAgentCatalog(path.resolve('src/agents'), 64 * 1024, customRoot);
    expect(catalog.get('career').name).toBe('Career');
    expect(catalog.list().filter((agent) => agent.id === 'career')).toHaveLength(1);
  });

  it('rejects ids that could escape the custom agents folder', () => {
    const store = new FileSystemCustomAgentStore(tempRoot());
    expect(() => store.delete('../career')).toThrow('Invalid custom agent id');
  });

  it('builds a tool-free drafting request and parses the model draft', () => {
    const request = buildCustomAgentDraftRequest({ name: 'Saul Goodman', brief: 'legal questions', language: 'tr' });
    expect(request.tools).toEqual([]);
    expect(request.messages[0]?.content).toContain('Write every field in Turkish');
    const draft = parseCustomAgentDraft('```json\n{"description":"Hukuki sorular.","instructions":"# Saul","rules":"- Avukat değildir.","starters":["a","b","c","d","e"]}\n```');
    expect(draft).toEqual({ description: 'Hukuki sorular.', instructions: '# Saul', rules: '- Avukat değildir.', starters: ['a', 'b', 'c', 'd'] });
    expect(() => parseCustomAgentDraft('no json here')).toThrow('did not return an agent draft');
  });
});
