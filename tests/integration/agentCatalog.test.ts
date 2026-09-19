import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSystemAgentCatalog } from '../../src/infrastructure/agents/FileSystemAgentCatalog';

const temporaryRoots: string[] = [];

function createTemporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-catalog-'));
  temporaryRoots.push(root);
  return root;
}

function writeAgent(root: string, directory: string, id: string): void {
  const agentDirectory = path.join(root, directory);
  fs.mkdirSync(agentDirectory, { recursive: true });
  fs.writeFileSync(path.join(agentDirectory, 'AGENT.md'), `Instructions for ${id}.`);
  fs.writeFileSync(path.join(agentDirectory, 'agent.yaml'), [
    `id: ${id}`,
    `name: ${id} Agent`,
    `description: ${id} description`,
    'instructions:',
    '  - AGENT.md',
    'workflows: []',
    'quickActions: []',
    'toolPolicies: {}',
    '',
  ].join('\n'));
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('FileSystemAgentCatalog', () => {
  it('discovers and deterministically loads the Career and Blogger agents', () => {
    const catalog = new FileSystemAgentCatalog(path.resolve('src/agents'));

    const agents = catalog.list();

    expect(agents.map((agent) => agent.id)).toEqual(['blogger', 'career']);
    expect(agents.map((agent) => agent.name)).toEqual(['Blogger', 'Career']);
    expect(agents.every((agent) => agent.systemPrompt.length > 0)).toBe(true);
    expect(catalog.get('career').onboarding.map((question) => question.intent))
      .toEqual(['initial', 'initial', 'publish', 'linkedin']);
    expect(catalog.get('blogger').onboarding.map((question) => question.intent))
      .toEqual(['initial', 'initial', 'publish', 'linkedin']);
  });

  it('gets an agent by its configured id', () => {
    const catalog = new FileSystemAgentCatalog(path.resolve('src/agents'));

    expect(catalog.get('career').name).toBe('Career');
    expect(catalog.get('blogger').name).toBe('Blogger');
  });

  it('reports an unknown agent id', () => {
    const catalog = new FileSystemAgentCatalog(path.resolve('src/agents'));

    expect(() => catalog.get('unknown')).toThrow('Unknown agent id: unknown');
  });

  it('rejects traversal and absolute-path lookup values', () => {
    const catalog = new FileSystemAgentCatalog(path.resolve('src/agents'));

    expect(() => catalog.get('../career')).toThrow('Invalid agent id');
    expect(() => catalog.get('..\\career')).toThrow('Invalid agent id');
    expect(() => catalog.get(path.resolve('src/agents/career'))).toThrow('Invalid agent id');
  });

  it('rejects duplicate configured ids in caller-provided roots', () => {
    const root = createTemporaryRoot();
    writeAgent(root, 'first', 'duplicate');
    writeAgent(root, 'second', 'duplicate');

    const catalog = new FileSystemAgentCatalog(root);

    expect(() => catalog.list()).toThrow('Duplicate agent id: duplicate');
  });

  it('isolates an invalid manifest so healthy agents remain available', () => {
    const root = createTemporaryRoot();
    writeAgent(root, 'unsafe', '../career');
    writeAgent(root, 'healthy', 'healthy');

    const catalog = new FileSystemAgentCatalog(root);
    expect(catalog.list().map((agent) => agent.id)).toEqual(['healthy']);
    expect(catalog.get('healthy').name).toBe('healthy Agent');
  });
});
