import { z } from 'zod';
import type { AgentTool } from '@application/tools';

export const filesystemReadTool: AgentTool<{ workspaceId: string; relativePath: string }, string> = {
  id: 'filesystem.read',
  description: 'Read a workspace file',
  inputSchema: z.object({ workspaceId: z.string(), relativePath: z.string() }),
  metadata: { readOnly: true, sideEffect: 'none', sensitive: true },
  async execute(input, context) {
    if (!context.workspaceGateway) throw new Error('Workspace gateway unavailable');
    const result = await context.workspaceGateway.readFile(input.workspaceId, input.relativePath);
    return result.content;
  },
};
