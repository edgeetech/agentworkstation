import { describe, expect, it } from 'vitest';
import { DefaultWorkspaceGateway } from '../../src/infrastructure/filesystem/workspaceGateway';

describe('workspace gateway', () => {
  it('rejects traversal', async () => {
    const gateway = new DefaultWorkspaceGateway({ a: process.cwd() });
    await expect(gateway.readFile('a', '../secrets.txt')).rejects.toThrow('Invalid path');
  });
});

