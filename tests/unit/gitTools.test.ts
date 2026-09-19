import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ToolExecutionContext, ToolResult } from '../../src/application/tools';
import { gitDiffTool, gitLogTool, gitStatusTool } from '../../src/infrastructure/git/gitTools';

function makeRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-git-tools-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), 'initial\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: repo });
  return repo;
}

function makeContext(repo: string): ToolExecutionContext {
  return {
    workspaceId: 'w1',
    signal: new AbortController().signal,
    workspaceGateway: {
      getWorkspaceRoot: () => repo,
      listDirectory: async () => [],
      listDirectoryEntries: async () => [],
      readFile: async () => ({ content: '', source: '' }),
      readFileIfExists: async () => null,
      writeFileAtomic: async () => undefined,
    },
  };
}

describe('git tools', () => {
  it('requires workspaceId input for git.log', () => {
    expect(gitLogTool.inputSchema.parse({ workspaceId: 'w1', limit: 1 })).toEqual({ workspaceId: 'w1', limit: 1 });
    expect(() => gitLogTool.inputSchema.parse({ workspacePath: '/tmp/workspace', limit: 1 })).toThrow();
  });

  it('requires workspace gateway in execution context', async () => {
    await expect(gitLogTool.execute({ workspaceId: 'w1', limit: 1 }, {
      workspaceId: 'w1',
      signal: new AbortController().signal,
    })).rejects.toThrow('Workspace gateway unavailable');
  });

  it('returns structured branch and file status with provenance', async () => {
    const repo = makeRepo();
    fs.appendFileSync(path.join(repo, 'README.md'), 'working tree change\n');
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'untracked\n');

    const result = await gitStatusTool.execute({ workspaceId: 'w1' }, makeContext(repo)) as ToolResult;
    const output = result.output as {
      branch: string;
      entries: Array<{ path: string; kind: string; worktreeStatus: string }>;
    };

    expect(output.branch).toBe('main');
    expect(output.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'README.md', kind: 'tracked', worktreeStatus: 'M' }),
      expect.objectContaining({ path: 'notes.txt', kind: 'untracked' }),
    ]));
    expect(result.sourceReferences).toEqual([
      { type: 'git_status', workspaceId: 'w1', label: 'git.status' },
    ]);
  });

  it('returns bounded working and staged diffs with provenance', async () => {
    const repo = makeRepo();
    fs.appendFileSync(path.join(repo, 'README.md'), 'working tree change\n');

    const working = await gitDiffTool.execute({
      workspaceId: 'w1',
      scope: 'working',
      maxBytes: 4096,
    }, makeContext(repo)) as ToolResult;
    expect(working.output).toMatchObject({ scope: 'working', truncated: false });
    expect((working.output as { diff: string }).diff).toContain('+working tree change');
    expect(working.sourceReferences[0]).toMatchObject({ type: 'git_diff', label: 'git.diff(working)' });

    execFileSync('git', ['add', 'README.md'], { cwd: repo });
    const staged = await gitDiffTool.execute({
      workspaceId: 'w1',
      scope: 'staged',
      maxBytes: 4096,
    }, makeContext(repo)) as ToolResult;
    expect((staged.output as { diff: string }).diff).toContain('+working tree change');
  });

  it('validates range refs and truncates oversized diffs', async () => {
    expect(() => gitDiffTool.inputSchema.parse({
      workspaceId: 'w1',
      scope: 'range',
      from: '--output=outside',
      to: 'HEAD',
    })).toThrow('Invalid Git ref');
    expect(gitDiffTool.inputSchema.parse({ workspaceId: 'w1', scope: 'working' })).toMatchObject({
      maxBytes: 32 * 1024,
    });

    const repo = makeRepo();
    fs.appendFileSync(path.join(repo, 'README.md'), 'x'.repeat(2048));
    const result = await gitDiffTool.execute({
      workspaceId: 'w1',
      scope: 'working',
      maxBytes: 128,
    }, makeContext(repo)) as ToolResult;
    const output = result.output as { diff: string; truncated: boolean; originalBytes: number };
    expect(output.truncated).toBe(true);
    expect(Buffer.byteLength(output.diff)).toBeLessThanOrEqual(128);
    expect(output.originalBytes).toBeGreaterThan(128);
  });
});
