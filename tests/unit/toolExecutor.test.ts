import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolExecutor, ToolRegistry } from '../../src/application/tools';

describe('ToolExecutor result validation', () => {
  it('rejects malformed provenance envelopes before AgentRuntime receives them', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'malformed',
      description: 'Return malformed provenance',
      inputSchema: z.object({}),
      inputJsonSchema: { type: 'object', properties: {} },
      metadata: { readOnly: true, sideEffect: 'none', sensitive: false },
      async execute() {
        return { output: 'value', sourceReferences: 'not-an-array' };
      },
    });
    const executor = new ToolExecutor(registry);

    await expect(executor.execute('malformed', {}, {
      workspaceId: 'workspace',
      signal: new AbortController().signal,
    })).rejects.toThrow('Malformed ToolResult from tool: malformed');
  });
});
