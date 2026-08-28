import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DefaultWorkspaceGateway } from '../../src/infrastructure/filesystem/workspaceGateway';

describe('workspace gateway', () => {
  it('rejects traversal', async () => {
    const gateway = new DefaultWorkspaceGateway({ a: process.cwd() });
    await expect(gateway.readFile('a', '../secrets.txt')).rejects.toThrow('Invalid path');
  });

  it('returns safe typed entries without exposing sensitive names', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-files-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'README.md'), '# Safe');
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=value');
    const gateway = new DefaultWorkspaceGateway({ a: root });

    await expect(gateway.listDirectoryEntries('a', '.')).resolves.toEqual([
      { name: 'src', relativePath: 'src', kind: 'directory' },
      { name: 'README.md', relativePath: 'README.md', kind: 'file' },
    ]);
  });
});

