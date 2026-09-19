import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSharedPathReadTool } from '../../src/infrastructure/filesystem/sharedPathReadTool';

const files: string[] = [];
afterEach(() => { for (const file of files.splice(0)) fs.rmSync(file, { force: true }); });

function textFile(content: string): string {
  const file = path.join(os.tmpdir(), `agentworkstation-shared-${crypto.randomUUID()}.txt`);
  files.push(file);
  fs.writeFileSync(file, content);
  return file;
}

describe('explicitly shared path reading', () => {
  const context = { workspaceId: '', signal: new AbortController().signal };

  it('reads exactly the user-provided absolute text file without a workspace', async () => {
    const file = textFile('A writing sample');
    const tool = createSharedPathReadTool([`Please read ${file}`]);
    await expect(tool.execute({ path: file }, context)).resolves.toEqual({
      output: 'A writing sample', sourceReferences: [{ type: 'file', label: file }],
    });
  });

  it('rejects a path not explicitly shared and does not expand the grant', async () => {
    const allowed = textFile('Allowed');
    const other = textFile('Not allowed');
    const tool = createSharedPathReadTool([`Read ${allowed}`]);
    await expect(tool.execute({ path: other }, context)).rejects.toThrow('not shared');
    await expect(tool.execute({ path: path.dirname(allowed) }, context)).rejects.toThrow('not shared');
  });

  it('rejects oversized and binary files', async () => {
    const large = textFile('x'.repeat(48 * 1024 + 1));
    const binary = textFile('text\u0000payload');
    const tool = createSharedPathReadTool([large, binary]);
    await expect(tool.execute({ path: large }, context)).rejects.toThrow('too large');
    await expect(tool.execute({ path: binary }, context)).rejects.toThrow('not a text file');
  });
});
