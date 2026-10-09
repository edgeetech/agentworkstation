import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSystemAgentCatalog } from '../../src/infrastructure/agents/FileSystemAgentCatalog';

const packaged = path.resolve('src/agents');
const temporary: string[] = [];
const tempDir = (prefix: string): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporary.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('editable built-in instructions', () => {
  it('uses the packaged instructions until the owner rewrites them', () => {
    const catalog = new FileSystemAgentCatalog(packaged, undefined, undefined, tempDir('aw-overrides-'));
    expect(catalog.get('accountant').systemPrompt).toContain('Work evidence-first');
  });

  it('replaces AGENT.md and RULES.md from the owner\'s folder and keeps tools, workflows, and setup as shipped', () => {
    const overrides = tempDir('aw-overrides-');
    const shipped = new FileSystemAgentCatalog(packaged).get('accountant');
    fs.mkdirSync(path.join(overrides, 'accountant'));
    fs.writeFileSync(path.join(overrides, 'accountant', 'AGENT.md'), '# Skyler\n\nYou are a sharp, careful accountant for EdgeeTech Ltd.');
    const catalog = new FileSystemAgentCatalog(packaged, undefined, undefined, overrides);
    const edited = catalog.get('accountant');

    expect(edited.systemPrompt).toContain('sharp, careful accountant for EdgeeTech Ltd');
    expect(edited.systemPrompt).not.toContain('Work evidence-first');
    expect(edited.toolPolicies).toEqual(shipped.toolPolicies);
    expect(edited.onboarding).toEqual(shipped.onboarding);
    expect(edited.quickActions).toEqual(shipped.quickActions);
    expect(catalog.get('career').systemPrompt).toEqual(new FileSystemAgentCatalog(packaged).get('career').systemPrompt);
  });

  it('only applies overrides to shipped specialists and finds their packaged folders', () => {
    const overrides = tempDir('aw-overrides-');
    const catalog = new FileSystemAgentCatalog(packaged, undefined, undefined, overrides);
    expect(catalog.builtInDirectory('accountant')).toBe(path.join(fs.realpathSync(packaged), 'accountant'));
    expect(catalog.builtInDirectory('saul-goodman')).toBeUndefined();
    expect(catalog.overrideDirectoryFor(path.join(packaged, 'accountant'))).toBe(path.join(overrides, 'accountant'));
  });
});
