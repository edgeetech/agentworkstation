import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { AgentTool } from '@application/tools';

const execFileAsync = promisify(execFile);

export const gitLogTool: AgentTool<{ workspacePath: string; limit: number }, string> = {
  id: 'git.log',
  description: 'Read recent git history',
  inputSchema: z.object({ workspacePath: z.string(), limit: z.number().int().positive().max(20) }),
  metadata: { readOnly: true, sideEffect: 'none', sensitive: false },
  async execute(input) {
    const { stdout } = await execFileAsync('git', ['-C', input.workspacePath, 'log', `-${input.limit}`, '--oneline'], {});
    return stdout;
  },
};

