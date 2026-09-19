import { z } from 'zod';
import type { ModelToolDefinition, SourceReference, ToolMetadata } from '@domain/intelligence';
import type { WorkspaceGateway } from '@application/ports';
import type { AgentToolPolicy } from '@application/agents/types';

export type ToolExecutionContext = {
  workspaceId: string;
  signal: AbortSignal;
  workspaceGateway?: WorkspaceGateway;
};

export type AgentTool<TInput, TOutput> = {
  id: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  inputJsonSchema: Record<string, unknown>;
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

  getModelTools(): ModelToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.id,
      description: tool.description,
      inputSchema: tool.inputJsonSchema,
    }));
  }
}

export type ToolResult = { output: unknown; sourceReferences: SourceReference[] };

function isSourceReference(value: unknown): value is SourceReference {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (!['file', 'git_commit', 'git_diff', 'git_status', 'memory', 'web'].includes(String(candidate.type))) return false;
  return ['workspaceId', 'relativePath', 'commitSha', 'url', 'label']
    .every((key) => candidate[key] === undefined || typeof candidate[key] === 'string');
}

function hasToolResultKeys(value: object): boolean {
  return 'output' in value || 'sourceReferences' in value;
}

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
    const rawOutput = await tool.execute(parsed, context);
    if (rawOutput !== null && typeof rawOutput === 'object' && hasToolResultKeys(rawOutput)) {
      if (!('output' in rawOutput)
        || !('sourceReferences' in rawOutput)
        || !Array.isArray(rawOutput.sourceReferences)
        || !rawOutput.sourceReferences.every(isSourceReference)) {
        throw new Error(`Malformed ToolResult from tool: ${toolName}`);
      }
      return { output: rawOutput.output, sourceReferences: rawOutput.sourceReferences };
    }
    return { output: rawOutput, sourceReferences: [] };
  }
}

export class PolicyGate {
  decide(toolMetadata: ToolMetadata, _toolName?: string): 'allow' | 'require_approval' | 'deny' {
    if (toolMetadata.sideEffect === 'external') return 'deny';
    if (toolMetadata.sideEffect === 'propose') return 'require_approval';
    return 'allow';
  }
}

export class AgentPolicyGate extends PolicyGate {
  constructor(private readonly policies: Readonly<Record<string, AgentToolPolicy>>) {
    super();
  }

  override decide(toolMetadata: ToolMetadata, toolName?: string): 'allow' | 'require_approval' | 'deny' {
    if (toolMetadata.sideEffect === 'external') return 'deny';
    if (!toolName) return 'deny';
    const configured = this.policies[toolName];
    if (!configured || configured === 'deny') return 'deny';
    if (configured === 'require_approval') return 'require_approval';
    return super.decide(toolMetadata, toolName);
  }
}
