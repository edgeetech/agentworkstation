import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DefaultWorkspaceGateway } from '../../src/infrastructure/filesystem/workspaceGateway';

describe('workspace gateway security', () => {
  it('blocks absolute paths', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-'));
    const gateway = new DefaultWorkspaceGateway({ a: root });
    await expect(gateway.readFile('a', path.join(root, 'x.txt'))).rejects.toThrow('Invalid path');
  });
});

