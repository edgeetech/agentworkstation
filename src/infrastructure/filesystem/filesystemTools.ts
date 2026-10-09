import { promises as fs } from 'node:fs';
import { z } from 'zod';
import type { ApprovalService } from '@application/approvals';
import type { WorkspaceEntry } from '@application/ports';
import type { AgentTool, ToolExecutionContext, ToolResult } from '@application/tools';
import type { SourceReference } from '@domain/intelligence';
import { documentFormatFor, extractDocumentText } from './documentText';

const MAX_READ_CHARACTERS = 40_000;
const MAX_LIST_ENTRIES = 1_000;
const MAX_SEARCH_FILES_READ = 900;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.venv', '__pycache__', 'dist', 'build']);

async function resolveInWorkspace(context: ToolExecutionContext, workspaceId: string, relativePath: string): Promise<string> {
  const gateway = context.workspaceGateway;
  if (!gateway?.resolveExisting) throw new Error('Workspace gateway unavailable');
  return gateway.resolveExisting(workspaceId, relativePath);
}

export const filesystemReadTool: AgentTool<{ workspaceId: string; relativePath: string; offset?: number }, ToolResult> = {
  id: 'filesystem.read',
  description: 'Read a workspace file. Text files are returned as-is; PDF, Word (.docx) and Excel (.xlsx) files are returned as extracted text. Long files come back in slices: pass the returned nextOffset to continue.',
  inputSchema: z.object({ workspaceId: z.string(), relativePath: z.string(), offset: z.number().int().nonnegative().optional() }),
  inputJsonSchema: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string' },
      relativePath: { type: 'string' },
      offset: { type: 'integer', minimum: 0, description: 'Character offset for the next slice of a long file' },
    },
    required: ['workspaceId', 'relativePath'],
    additionalProperties: false,
  },
  metadata: { readOnly: true, sideEffect: 'none', sensitive: true, requiresWorkspace: true, timeoutMs: 60_000 },
  async execute(input, context): Promise<ToolResult> {
    if (!context.workspaceGateway) throw new Error('Workspace gateway unavailable');
    const sourceRef: SourceReference = { type: 'file', workspaceId: input.workspaceId, relativePath: input.relativePath };
    if (!context.workspaceGateway.resolveExisting) {
      const result = await context.workspaceGateway.readFile(input.workspaceId, input.relativePath);
      return { output: result.content, sourceReferences: [sourceRef] };
    }
    const document = await extractDocumentText(await resolveInWorkspace(context, input.workspaceId, input.relativePath));
    const offset = input.offset ?? 0;
    const slice = document.text.slice(offset, offset + MAX_READ_CHARACTERS);
    const nextOffset = offset + slice.length < document.text.length ? offset + slice.length : undefined;
    if (document.format === 'text' && offset === 0 && nextOffset === undefined) {
      return { output: document.text, sourceReferences: [sourceRef] };
    }
    return {
      output: {
        format: document.format,
        ...(document.pages ? { pages: document.pages } : {}),
        ...(document.sheets ? { sheets: document.sheets } : {}),
        ...(document.note ? { note: document.note } : {}),
        text: slice,
        totalCharacters: document.text.length,
        ...(nextOffset !== undefined ? { nextOffset } : {}),
      },
      sourceReferences: [sourceRef],
    };
  },
};

type ListedEntry = { path: string; kind: 'file' | 'directory'; size?: number; modified?: string };

async function walkWorkspace(
  context: ToolExecutionContext,
  workspaceId: string,
  start: string,
  recursive: boolean,
  visit: (entry: WorkspaceEntry) => Promise<boolean>,
): Promise<boolean> {
  const gateway = context.workspaceGateway;
  if (!gateway) throw new Error('Workspace gateway unavailable');
  const queue = [start];
  while (queue.length > 0) {
    context.signal.throwIfAborted();
    const directory = queue.shift() as string;
    for (const entry of await gateway.listDirectoryEntries(workspaceId, directory)) {
      if (!(await visit(entry))) return false;
      if (recursive && entry.kind === 'directory' && !SKIPPED_DIRECTORIES.has(entry.name)) queue.push(entry.relativePath);
    }
  }
  return true;
}

export const filesystemListTool: AgentTool<{ workspaceId: string; relativePath?: string; recursive?: boolean }, ToolResult> = {
  id: 'filesystem.list',
  description: 'List the files and folders in a workspace folder, with sizes and modification dates. Set recursive to include every subfolder.',
  inputSchema: z.object({ workspaceId: z.string(), relativePath: z.string().optional(), recursive: z.boolean().optional() }),
  inputJsonSchema: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string' },
      relativePath: { type: 'string', description: 'Folder inside the workspace; omit for the root' },
      recursive: { type: 'boolean' },
    },
    required: ['workspaceId'],
    additionalProperties: false,
  },
  metadata: { readOnly: true, sideEffect: 'none', sensitive: false, requiresWorkspace: true, timeoutMs: 60_000 },
  async execute(input, context): Promise<ToolResult> {
    const start = (input.relativePath ?? '').replace(/^[\\/.]+$/, '');
    const entries: ListedEntry[] = [];
    const complete = await walkWorkspace(context, input.workspaceId, start, input.recursive ?? false, async (entry) => {
      const listed: ListedEntry = { path: entry.relativePath, kind: entry.kind };
      if (entry.kind === 'file' && context.workspaceGateway?.resolveExisting) {
        try {
          const stat = await fs.stat(await context.workspaceGateway.resolveExisting(input.workspaceId, entry.relativePath));
          listed.size = stat.size;
          listed.modified = stat.mtime.toISOString().slice(0, 10);
        } catch {
          // Unreadable entries are still listed by name.
        }
      }
      entries.push(listed);
      return entries.length < MAX_LIST_ENTRIES;
    });
    return {
      output: {
        folder: start || '.',
        entries,
        ...(complete ? {} : { truncated: `Stopped at ${MAX_LIST_ENTRIES} entries; list a subfolder or use filesystem.search.` }),
      },
      sourceReferences: [{ type: 'file', workspaceId: input.workspaceId, relativePath: start || '.', label: `list ${start || '.'}` }],
    };
  },
};

function namePattern(pattern: string): RegExp {
  const escaped = pattern.trim().toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(pattern.includes('*') || pattern.includes('?') ? `^${escaped}$` : escaped, 'i');
}

export const filesystemSearchTool: AgentTool<{ workspaceId: string; relativePath?: string; name?: string; text?: string; maxResults?: number }, ToolResult> = {
  id: 'filesystem.search',
  description: 'Find workspace files by name (substring or wildcard such as *.pdf) and/or by text they contain, including text inside PDF, Word and Excel files. Narrow a text search with name or relativePath on large folders.',
  inputSchema: z.object({
    workspaceId: z.string(),
    relativePath: z.string().optional(),
    name: z.string().min(1).max(200).optional(),
    text: z.string().min(2).max(200).optional(),
    maxResults: z.number().int().min(1).max(500).optional(),
  }).refine((value) => value.name || value.text, 'Give a name pattern, a text to find, or both'),
  inputJsonSchema: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string' },
      relativePath: { type: 'string', description: 'Folder to search in; omit for the whole workspace' },
      name: { type: 'string', description: 'File name substring or wildcard, for example *invoice*.pdf' },
      text: { type: 'string', description: 'Case-insensitive text the file must contain' },
      maxResults: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
    },
    required: ['workspaceId'],
    additionalProperties: false,
  },
  metadata: { readOnly: true, sideEffect: 'none', sensitive: true, requiresWorkspace: true, timeoutMs: 240_000 },
  async execute(input, context): Promise<ToolResult> {
    const limit = input.maxResults ?? 100;
    const matcher = input.name ? namePattern(input.name) : null;
    const needle = input.text?.toLowerCase();
    const results: Array<{ path: string; snippet?: string }> = [];
    let filesRead = 0;
    let readLimitReached = false;
    await walkWorkspace(context, input.workspaceId, (input.relativePath ?? '').replace(/^[\\/.]+$/, ''), true, async (entry) => {
      if (entry.kind !== 'file' || (matcher && !matcher.test(entry.name))) return true;
      if (!needle) {
        results.push({ path: entry.relativePath });
        return results.length < limit;
      }
      // A file named after what is searched for is a hit without reading it.
      if (entry.name.toLowerCase().includes(needle)) {
        results.push({ path: entry.relativePath, snippet: '(file name matches)' });
        return results.length < limit;
      }
      const format = documentFormatFor(entry.name);
      if (format === 'image' || format === 'unsupported') return true;
      if (filesRead >= MAX_SEARCH_FILES_READ) {
        readLimitReached = true;
        return false;
      }
      filesRead += 1;
      try {
        const { text } = await extractDocumentText(await resolveInWorkspace(context, input.workspaceId, entry.relativePath));
        const index = text.toLowerCase().indexOf(needle);
        if (index >= 0) {
          results.push({ path: entry.relativePath, snippet: text.slice(Math.max(0, index - 80), index + needle.length + 80).replace(/\s+/g, ' ').trim() });
        }
      } catch {
        // Unreadable files simply do not match.
      }
      return results.length < limit;
    });
    return {
      output: {
        results,
        ...(results.length >= limit ? { note: `Stopped at ${limit} results.` } : {}),
        ...(readLimitReached ? { note: `Read ${MAX_SEARCH_FILES_READ} files without finishing; narrow the search with name or relativePath.` } : {}),
      },
      sourceReferences: [{ type: 'file', workspaceId: input.workspaceId, relativePath: input.relativePath ?? '.', label: `search ${input.name ?? ''} ${input.text ?? ''}`.trim() }],
    };
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
