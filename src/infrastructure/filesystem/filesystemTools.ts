import { z } from 'zod';
import type { AgentTool, ToolResult } from '@application/tools';
import type { SourceReference } from '@domain/intelligence';

export const filesystemReadTool: AgentTool<{ workspaceId: string; relativePath: string }, ToolResult> = {
  id: 'filesystem.read',
  description: 'Read a workspace file',
  inputSchema: z.object({ workspaceId: z.string(), relativePath: z.string() }),
  metadata: { readOnly: true, sideEffect: 'none', sensitive: true },
  async execute(input, context): Promise<ToolResult> {
    if (!context.workspaceGateway) throw new Error('Workspace gateway unavailable');
    const result = await context.workspaceGateway.readFile(input.workspaceId, input.relativePath);
    const sourceRef: SourceReference = {
      type: 'file',
      workspaceId: input.workspaceId,
      relativePath: input.relativePath,
    };
    return { output: result.content, sourceReferences: [sourceRef] };
  },
};
