import { describe, expect, it } from 'vitest';
import { gitLogTool } from '../../src/infrastructure/git/gitTools';

describe('git log tool', () => {
  it('requires workspaceId input', () => {
    expect(gitLogTool.inputSchema.parse({ workspaceId: 'w1', limit: 1 })).toEqual({ workspaceId: 'w1', limit: 1 });
    expect(() => gitLogTool.inputSchema.parse({ workspacePath: '/tmp/workspace', limit: 1 })).toThrow();
  });

  it('requires workspace gateway in execution context', async () => {
    await expect(gitLogTool.execute({ workspaceId: 'w1', limit: 1 }, { workspaceId: 'w1', signal: new AbortController().signal })).rejects.toThrow(
      'Workspace gateway unavailable',
    );
  });
});
