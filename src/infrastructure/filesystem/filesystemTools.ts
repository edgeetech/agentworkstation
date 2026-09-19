import { z } from 'zod';
import type { ApprovalService } from '@application/approvals';
import type { AgentTool, ToolResult } from '@application/tools';
import type { SourceReference } from '@domain/intelligence';

export const filesystemReadTool: AgentTool<{ workspaceId: string; relativePath: string }, ToolResult> = {
  id: 'filesystem.read',
  description: 'Read a workspace file',
  inputSchema: z.object({ workspaceId: z.string(), relativePath: z.string() }),
  inputJsonSchema: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string' },
      relativePath: { type: 'string' },
    },
    required: ['workspaceId', 'relativePath'],
    additionalProperties: false,
  },
  metadata: { readOnly: true, sideEffect: 'none', sensitive: true, requiresWorkspace: true },
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

export function createFilesystemProposeWriteTool(
  approvals: ApprovalService,
  sessionId: string,
): AgentTool<{ workspaceId: string; targetPath: string; proposedContent: string }, ToolResult> {
  return {
    id: 'filesystem.proposeWrite',
    description: 'Propose a workspace file write and create a pending approval action',
    inputSchema: z.object({
      workspaceId: z.string().min(1),
      targetPath: z.string().min(1),
      proposedContent: z.string().max(256 * 1024),
    }),
    inputJsonSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', minLength: 1 },
        targetPath: { type: 'string', minLength: 1 },
        proposedContent: { type: 'string', maxLength: 256 * 1024 },
      },
      required: ['workspaceId', 'targetPath', 'proposedContent'],
      additionalProperties: false,
    },
    metadata: { readOnly: false, sideEffect: 'propose', sensitive: true, requiresWorkspace: true },
    async execute(input): Promise<ToolResult> {
      const pendingAction = await approvals.proposeWrite({
        workspaceId: input.workspaceId,
        targetPath: input.targetPath,
        proposedContent: input.proposedContent,
        sessionId,
      });
      const sourceRef: SourceReference = {
        type: 'file',
        workspaceId: input.workspaceId,
        relativePath: input.targetPath,
        label: `pending:${pendingAction.id}`,
      };
      return {
        output: {
          actionId: pendingAction.id,
          status: pendingAction.status,
          targetPath: pendingAction.targetPath,
          diff: pendingAction.diff,
        },
        sourceReferences: [sourceRef],
      };
    },
  };
}
