import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { AgentTool, ToolResult } from '@application/tools';
import type { SourceReference } from '@domain/intelligence';

const execFileAsync = promisify(execFile);

export const gitLogTool: AgentTool<{ workspaceId: string; limit: number }, ToolResult> = {
  id: 'git.log',
  description: 'Read recent git history',
  inputSchema: z.object({ workspaceId: z.string(), limit: z.number().int().positive().max(20) }),
  metadata: { readOnly: true, sideEffect: 'none', sensitive: false },
  async execute(input, context): Promise<ToolResult> {
    if (!context.workspaceGateway) throw new Error('Workspace gateway unavailable');
    const workspacePath = context.workspaceGateway.getWorkspaceRoot(input.workspaceId);
    const { stdout } = await execFileAsync('git', ['-C', workspacePath, 'log', `-${input.limit}`, '--oneline'], {});
    const sourceRef: SourceReference = {
      type: 'git_commit',
      workspaceId: input.workspaceId,
      label: `git.log(limit=${input.limit})`,
    };
    return { output: stdout.trim(), sourceReferences: [sourceRef] };
  },
};
