import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { AgentTool, ToolResult, ToolExecutionContext } from '@application/tools';
import type { SourceReference } from '@domain/intelligence';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER_BYTES = 1024 * 1024;
const DEFAULT_DIFF_BYTES = 32 * 1024;
const MAX_DIFF_BYTES = 64 * 1024;

const workspaceInput = z.object({ workspaceId: z.string().min(1) });
const gitRef = z.string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/~^@{}-]*$/, 'Invalid Git ref');

type GitStatusEntry = {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  kind: 'tracked' | 'untracked' | 'renamed' | 'copied';
};

type GitStatusOutput = {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  entries: GitStatusEntry[];
};

type GitDiffInput = {
  workspaceId: string;
  scope: 'working' | 'staged' | 'range';
  maxBytes?: number;
  from?: string;
  to?: string;
};

type GitDiffOutput = {
  scope: GitDiffInput['scope'];
  diff: string;
  truncated: boolean;
  originalBytes: number;
};

const gitDiffInput = z.discriminatedUnion('scope', [
  workspaceInput.extend({
    scope: z.enum(['working', 'staged']),
    maxBytes: z.number().int().positive().max(MAX_DIFF_BYTES).default(DEFAULT_DIFF_BYTES),
  }),
  workspaceInput.extend({
    scope: z.literal('range'),
    from: gitRef,
    to: gitRef,
    maxBytes: z.number().int().positive().max(MAX_DIFF_BYTES).default(DEFAULT_DIFF_BYTES),
  }),
]);

async function runGit(workspacePath: string, args: string[], signal: AbortSignal): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', workspacePath, ...args], {
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    signal,
    windowsHide: true,
  });
  return stdout;
}

function parseBranch(summary: string): Pick<GitStatusOutput, 'branch' | 'upstream' | 'ahead' | 'behind'> {
  const divergence = summary.match(/ \[ahead (\d+)(?:, behind (\d+))?\]$| \[behind (\d+)\]$/);
  const ahead = Number(divergence?.[1] ?? 0);
  const behind = Number(divergence?.[2] ?? divergence?.[3] ?? 0);
  const withoutDivergence = summary.replace(/ \[(?:ahead|behind).*\]$/, '');
  const [branch, upstream] = withoutDivergence.split('...');
  return { branch, ...(upstream ? { upstream } : {}), ahead, behind };
}

function parseStatus(output: string): GitStatusOutput {
  const records = output.split('\0').filter(Boolean);
  const branchRecord = records.shift();
  if (!branchRecord?.startsWith('## ')) throw new Error('Unexpected git.status output');

  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) throw new Error('Unexpected git.status entry');
    const indexStatus = record[0];
    const worktreeStatus = record[1];
    const path = record.slice(3);
    const renamed = indexStatus === 'R' || worktreeStatus === 'R';
    const copied = indexStatus === 'C' || worktreeStatus === 'C';
    const originalPath = renamed || copied ? records[++index] : undefined;
    const kind = record.startsWith('??')
      ? 'untracked'
      : renamed
        ? 'renamed'
        : copied
          ? 'copied'
          : 'tracked';
    entries.push({ path, ...(originalPath ? { originalPath } : {}), indexStatus, worktreeStatus, kind });
  }

  return { ...parseBranch(branchRecord.slice(3)), entries };
}

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean; originalBytes: number } {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return { value, truncated: false, originalBytes: bytes.length };
  return {
    value: new TextDecoder().decode(bytes.subarray(0, maxBytes)),
    truncated: true,
    originalBytes: bytes.length,
  };
}

function requireWorkspaceRoot(context: ToolExecutionContext, workspaceId: string): string {
  if (!context.workspaceGateway) throw new Error('Workspace gateway unavailable');
  return context.workspaceGateway.getWorkspaceRoot(workspaceId);
}

export const gitStatusTool: AgentTool<{ workspaceId: string }, ToolResult> = {
  id: 'git.status',
  description: 'Read structured working-tree and branch status',
  inputSchema: workspaceInput,
  inputJsonSchema: {
    type: 'object',
    properties: { workspaceId: { type: 'string', minLength: 1 } },
    required: ['workspaceId'],
    additionalProperties: false,
  },
  metadata: { readOnly: true, sideEffect: 'none', sensitive: false },
  async execute(input, context): Promise<ToolResult> {
    const workspacePath = requireWorkspaceRoot(context, input.workspaceId);
    const output = await runGit(workspacePath, ['status', '--porcelain=v1', '--branch', '-z'], context.signal);
    const sourceRef: SourceReference = {
      type: 'git_status',
      workspaceId: input.workspaceId,
      label: 'git.status',
    };
    return { output: parseStatus(output), sourceReferences: [sourceRef] };
  },
};

export const gitLogTool: AgentTool<{ workspaceId: string; limit: number }, ToolResult> = {
  id: 'git.log',
  description: 'Read recent git history',
  inputSchema: workspaceInput.extend({ limit: z.number().int().positive().max(20) }),
  inputJsonSchema: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
    required: ['workspaceId', 'limit'],
    additionalProperties: false,
  },
  metadata: { readOnly: true, sideEffect: 'none', sensitive: false },
  async execute(input, context): Promise<ToolResult> {
    const workspacePath = requireWorkspaceRoot(context, input.workspaceId);
    const stdout = await runGit(workspacePath, ['log', `-${input.limit}`, '--oneline'], context.signal);
    const sourceRef: SourceReference = {
      type: 'git_commit',
      workspaceId: input.workspaceId,
      label: `git.log(limit=${input.limit})`,
    };
    return { output: stdout.trim(), sourceReferences: [sourceRef] };
  },
};

export const gitDiffTool: AgentTool<GitDiffInput, ToolResult> = {
  id: 'git.diff',
  description: 'Read a bounded working-tree, staged, or commit-range diff',
  inputSchema: gitDiffInput,
  inputJsonSchema: {
    oneOf: [
      {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', minLength: 1 },
          scope: { enum: ['working', 'staged'] },
          maxBytes: { type: 'integer', minimum: 1, maximum: MAX_DIFF_BYTES, default: DEFAULT_DIFF_BYTES },
        },
        required: ['workspaceId', 'scope'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', minLength: 1 },
          scope: { const: 'range' },
          from: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._/~^@{}-]*$' },
          to: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._/~^@{}-]*$' },
          maxBytes: { type: 'integer', minimum: 1, maximum: MAX_DIFF_BYTES, default: DEFAULT_DIFF_BYTES },
        },
        required: ['workspaceId', 'scope', 'from', 'to'],
        additionalProperties: false,
      },
    ],
  },
  metadata: { readOnly: true, sideEffect: 'none', sensitive: false },
  async execute(input, context): Promise<ToolResult> {
    const workspacePath = requireWorkspaceRoot(context, input.workspaceId);
    const maxBytes = input.maxBytes ?? DEFAULT_DIFF_BYTES;

    let args: string[];
    let label: string;
    if (input.scope === 'working') {
      args = ['diff', '--no-ext-diff', '--'];
      label = 'git.diff(working)';
    } else if (input.scope === 'staged') {
      args = ['diff', '--cached', '--no-ext-diff', '--'];
      label = 'git.diff(staged)';
    } else {
      const from = input.from ?? '';
      const to = input.to ?? '';
      args = ['diff', '--no-ext-diff', `${from}..${to}`, '--'];
      label = `git.diff(${from}..${to})`;
    }

    const stdout = await runGit(workspacePath, args, context.signal);
    const bounded = truncateUtf8(stdout, maxBytes);
    const output: GitDiffOutput = {
      scope: input.scope,
      diff: bounded.value,
      truncated: bounded.truncated,
      originalBytes: bounded.originalBytes,
    };

    const rangeRef = input.scope === 'range' ? { from: input.from ?? '', to: input.to ?? '' } : undefined;
    const sourceRef: SourceReference = {
      type: 'git_diff',
      workspaceId: input.workspaceId,
      label: rangeRef ? `git.diff(${rangeRef.from}..${rangeRef.to})` : label,
    };
    return { output, sourceReferences: [sourceRef] };
  },
};
