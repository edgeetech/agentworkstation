import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { AgentTool } from '@application/tools';

const execFileAsync = promisify(execFile);

export const gitLogTool: AgentTool<{ workspaceId: string; limit: number }, string> = {
  id: 'git.log',
  description: 'Read recent git history',
  inputSchema: z.object({ workspaceId: z.string(), limit: z.number().int().positive().max(20) }),
  metadata: { readOnly: true, sideEffect: 'none', sensitive: false },
  async execute(input, context) {
    if (!context.workspaceGateway) throw new Error('Workspace gateway unavailable');
    const workspacePath = context.workspaceGateway.getWorkspaceRoot(input.workspaceId);
    const { stdout } = await execFileAsync('git', ['-C', workspacePath, 'log', `-${input.limit}`, '--oneline'], {});
    return stdout;
  },
};
