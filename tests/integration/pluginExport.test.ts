import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generatePluginArtifacts, writeGeneratedFiles } from '../../scripts/plugin-export/generate';

const repoRoot = path.resolve('.');

function listCommittedFiles(): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(path.relative(repoRoot, full).split(path.sep).join('/'), fs.readFileSync(full));
    }
  };
  for (const root of ['plugins', '.claude-plugin']) {
    const full = path.join(repoRoot, root);
    if (fs.existsSync(full)) walk(full);
  }
  return files;
}

describe('plugin export generator (freshness)', () => {
  const generated = generatePluginArtifacts(repoRoot);

  it('generates exactly the files committed under plugins/ and .claude-plugin/marketplace.json', () => {
    const committed = listCommittedFiles();
    expect(generated.map((file) => file.relativePath).sort()).toEqual([...committed.keys()].sort());
  });

  it('matches the committed content byte-for-byte, so `npm run export:plugins` was run after the last src/agents edit', () => {
    const committed = listCommittedFiles();
    for (const file of generated) {
      const committedContent = committed.get(file.relativePath);
      expect(committedContent, `missing committed file: ${file.relativePath}`).toBeDefined();
      expect(Buffer.from(file.content, 'utf8').equals(committedContent!))
        .toBe(true);
    }
  });

  it('is deterministic across repeated runs', () => {
    const again = generatePluginArtifacts(repoRoot);
    expect(again).toEqual(generated);
  });
});

describe('accountant CLI scripts bundled by the generator', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-export-cli-'));
  writeGeneratedFiles(tempDir, generatePluginArtifacts(repoRoot));
  const scriptsDir = path.join(tempDir, 'plugins', 'accountant', 'skills', 'accountant', 'scripts');

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uk-deadlines.mjs prints the known statutory dates for a 31 March year end', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(scriptsDir, 'uk-deadlines.mjs'), '--period-end', '2026-03-31', '--today', '2026-09-26'],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as { today: string; deadlines: Array<{ id: string; due: string }> };
    const byId = (id: string) => output.deadlines.find((item) => item.id === id);
    expect(output.today).toBe('2026-09-26');
    expect(byId('accounts-2026-03-31')?.due).toBe('2026-12-31');
    expect(byId('ct-payment-2026-03-31')?.due).toBe('2027-01-01');
  });

  it('uk-deadlines.mjs fails clearly when --period-end is missing', () => {
    const result = spawnSync(process.execPath, [path.join(scriptsDir, 'uk-deadlines.mjs')], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--period-end');
  });

  it('summarize-ledger.mjs totals a sample CSV and flags duplicate rows', () => {
    const csvPath = path.join(tempDir, 'sample.csv');
    fs.writeFileSync(csvPath, [
      'Date,Description,Amount',
      '2026-01-05,Client invoice,1200.00',
      '2026-01-10,Office supplies,-45.50',
      '2026-01-10,Office supplies,-45.50',
      '',
    ].join('\n'));

    const result = spawnSync(process.execPath, [path.join(scriptsDir, 'summarize-ledger.mjs'), csvPath], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as { totals: { inflow: number; outflow: number; net: number }; possibleDuplicates: unknown[] };
    expect(output.totals).toEqual({ inflow: 1200, outflow: 91, net: 1109 });
    expect(output.possibleDuplicates).toHaveLength(1);
  });
});
