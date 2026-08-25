import { z } from 'zod';
import type { SourceReference, ToolMetadata } from '@domain/intelligence';
import type { WorkspaceGateway } from '@application/ports';

export type ToolExecutionContext = {
  workspaceId: string;
  signal: AbortSignal;
  workspaceGateway?: WorkspaceGateway;
};

export type AgentTool<TInput, TOutput> = {
  id: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  metadata: ToolMetadata;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
};

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool<unknown, unknown>>();

  register<TInput, TOutput>(tool: AgentTool<TInput, TOutput>): void {
    this.tools.set(tool.id, tool as AgentTool<unknown, unknown>);
  }

  get(id: string): AgentTool<unknown, unknown> | undefined {
    return this.tools.get(id);
  }
}

export type ToolResult = { output: unknown; sourceReferences: SourceReference[] };

export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  getMetadata(toolName: string): ToolMetadata {
    const tool = this.registry.get(toolName);
    if (!tool) throw new Error(`Unknown tool: ${toolName}`);
    return tool.metadata;
  }

  async execute(toolName: string, input: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.registry.get(toolName);
    if (!tool) throw new Error(`Unknown tool: ${toolName}`);
    const parsed = tool.inputSchema.parse(input);
    const output = await tool.execute(parsed, context);
    return { output, sourceReferences: [] };
  }
}

export class PolicyGate {
  decide(toolMetadata: ToolMetadata): 'allow' | 'require_approval' | 'deny' {
    if (toolMetadata.sideEffect === 'external') return 'deny';
    if (toolMetadata.sideEffect === 'propose') return 'require_approval';
    return 'allow';
  }
}
