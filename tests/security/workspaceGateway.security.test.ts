import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DefaultWorkspaceGateway } from '../../src/infrastructure/filesystem/workspaceGateway';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sec-'));
}

describe('workspace gateway security', () => {
  it('blocks absolute paths', async () => {
    const root = makeTempDir();
    const gateway = new DefaultWorkspaceGateway({ a: root });
    await expect(gateway.readFile('a', path.join(root, 'x.txt'))).rejects.toThrow('Invalid path');
  });

  it('blocks path traversal with ..', async () => {
    const root = makeTempDir();
    const gateway = new DefaultWorkspaceGateway({ a: root });
    await expect(gateway.readFile('a', '../secrets.txt')).rejects.toThrow('Invalid path');
  });

  it('rejects unknown workspace', async () => {
    const gateway = new DefaultWorkspaceGateway({});
    await expect(gateway.readFile('unknown', 'file.txt')).rejects.toThrow('Unknown workspace');
  });

  it('rejects files exceeding size limit', async () => {
    const root = makeTempDir();
    const bigFile = path.join(root, 'big.txt');
    fs.writeFileSync(bigFile, 'x'.repeat(1024 * 1024 + 1));
    const gateway = new DefaultWorkspaceGateway({ a: root });
    await expect(gateway.readFile('a', 'big.txt')).rejects.toThrow('File too large');
  });

  it('blocks .env files (case-sensitive check)', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=abc');
    const gateway = new DefaultWorkspaceGateway({ a: root });
    await expect(gateway.readFile('a', '.env')).rejects.toThrow('Sensitive file denied');
  });

  it('blocks .pem certificate files', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'server.pem'), 'cert');
    const gateway = new DefaultWorkspaceGateway({ a: root });
    await expect(gateway.readFile('a', 'server.pem')).rejects.toThrow('Sensitive file denied');
  });

  it('lists directory without sensitive files leaking in names', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'README.md'), '# hi');
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=x');
    const gateway = new DefaultWorkspaceGateway({ a: root });
    const entries = await gateway.listDirectory('a', '.');
    // .env may appear in listing (listing is names-only), but read must be blocked
    await expect(gateway.readFile('a', '.env')).rejects.toThrow('Sensitive file denied');
    expect(entries).toContain('README.md');
  });

  it('reads a legitimate file successfully', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'README.md'), '# hello');
    const gateway = new DefaultWorkspaceGateway({ a: root });
    const result = await gateway.readFile('a', 'README.md');
    expect(result.content).toBe('# hello');
    expect(result.source).toBe('file:README.md');
  });
});

