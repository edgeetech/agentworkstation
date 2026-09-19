import { readFile, stat } from 'node:fs/promises';
import { isAbsolute as isPosixAbsolute } from 'node:path/posix';
import { isAbsolute as isWindowsAbsolute } from 'node:path/win32';
import { z } from 'zod';
import type { AgentTool, ToolResult } from '@application/tools';

const maximumBytes = 48 * 1024;

function isExplicitPath(message: string, path: string): boolean {
  let index = message.indexOf(path);
  while (index !== -1) {
    const before = index === 0 ? '' : message[index - 1];
    const after = message[index + path.length] ?? '';
    if ((before === '' || /[\s"'`(]/.test(before))
      && (after === '' || /[\s"'`),;!?]/.test(after))) return true;
    index = message.indexOf(path, index + 1);
  }
  return false;
}

/** A path is readable only when the user wrote that exact absolute path in this conversation. */
export function createSharedPathReadTool(userMessages: readonly string[]): AgentTool<{ path: string }, ToolResult> {
  return {
    id: 'filesystem.readSharedPath',
    description: 'Read a text file at an absolute path explicitly written by the user in this conversation. No workspace setup is required.',
    inputSchema: z.object({ path: z.string().min(1).max(2048) }),
    inputJsonSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Exact absolute file path from the user message' } },
      required: ['path'], additionalProperties: false,
    },
    metadata: { readOnly: true, sideEffect: 'none', sensitive: true, requiresWorkspace: false },
    async execute(input, context): Promise<ToolResult> {
      context.signal.throwIfAborted();
      if (!(isWindowsAbsolute(input.path) || isPosixAbsolute(input.path))
        || !userMessages.some((message) => isExplicitPath(message, input.path))) {
        throw new Error('This exact absolute file path was not shared by the user');
      }
      const details = await stat(input.path);
      if (!details.isFile()) throw new Error('The shared path is not a file');
      if (details.size > maximumBytes) throw new Error('The shared file is too large to read in chat');
      const content = await readFile(input.path, 'utf8');
      context.signal.throwIfAborted();
      if (content.includes('\u0000')) throw new Error('The shared file is not a text file');
      return { output: content, sourceReferences: [{ type: 'file', label: input.path }] };
    },
  };
}
