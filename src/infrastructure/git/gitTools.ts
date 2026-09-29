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
  scope?: 'working' | 'staged' | 'range';
  maxBytes?: number;
  from?: string;
  to?: string;
};

type GitDiffOutput = {
  scope: 'working' | 'staged' | 'range';
  diff: string;
  truncated: boolean;
  originalBytes: number;
};

const gitDiffInput = workspaceInput.extend({
  scope: z.enum(['working', 'staged', 'range']).default('working'),
  from: gitRef.optional(),
  to: gitRef.optional(),
  maxBytes: z.number().int().positive().default(DEFAULT_DIFF_BYTES),
}).superRefine((input, refinementContext) => {
  if (input.scope !== 'range') return;
  if (!input.from) {
    refinementContext.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['from'],
      message: '"from" is required when scope="range"',
    });
  }
  if (!input.to) {
    refinementContext.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: '"to" is required when scope="range"',
    });
  }
});

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
  metadata: { readOnly: true, sideEffect: 'none', sensitive: false, requiresWorkspace: true },
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

const GIT_LOG_MAX_COMMITS = 200;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const gitLogTool: AgentTool<{ workspaceId: string; limit?: number; skip?: number; since?: string }, ToolResult> = {
  id: 'git.log',
  description: 'Read git history as "<sha> <date> <author> <subject>" lines. Page older history with skip, or bound it with since (YYYY-MM-DD).',
  inputSchema: workspaceInput.extend({
    limit: z.number().int().positive().default(30),
    skip: z.number().int().nonnegative().optional(),
    since: isoDate.optional(),
  }),
  inputJsonSchema: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: GIT_LOG_MAX_COMMITS, default: 30 },
      skip: { type: 'integer', minimum: 0 },
      since: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    },
    required: ['workspaceId'],
    additionalProperties: false,
  },
  metadata: { readOnly: true, sideEffect: 'none', sensitive: false, requiresWorkspace: true },
  async execute(input, context): Promise<ToolResult> {
    const workspacePath = requireWorkspaceRoot(context, input.workspaceId);
    const limit = Math.min(input.limit ?? 30, GIT_LOG_MAX_COMMITS);
    const args = ['log', `-${limit}`, '--date=short', '--format=%h %ad %an %s'];
    if (input.skip) args.push(`--skip=${input.skip}`);
    if (input.since) args.push(`--since=${input.since}`);
    const stdout = await runGit(workspacePath, args, context.signal);
    const sourceRef: SourceReference = {
      type: 'git_commit',
      workspaceId: input.workspaceId,
      label: `git.log(limit=${limit})`,
    };
    return { output: stdout.trim(), sourceReferences: [sourceRef] };
  },
};

export const gitDiffTool: AgentTool<GitDiffInput, ToolResult> = {
  id: 'git.diff',
  description: 'Read a bounded working-tree, staged, or commit-range diff',
  inputSchema: gitDiffInput,
  inputJsonSchema: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string', minLength: 1 },
      scope: { enum: ['working', 'staged', 'range'], default: 'working' },
      from: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._/~^@{}-]*$' },
      to: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._/~^@{}-]*$' },
      maxBytes: { type: 'integer', minimum: 1, default: DEFAULT_DIFF_BYTES },
    },
    required: ['workspaceId'],
    additionalProperties: false,
  },
  metadata: { readOnly: true, sideEffect: 'none', sensitive: false, requiresWorkspace: true },
  async execute(input, context): Promise<ToolResult> {
    const workspacePath = requireWorkspaceRoot(context, input.workspaceId);
    const maxBytes = Math.min(input.maxBytes ?? DEFAULT_DIFF_BYTES, MAX_DIFF_BYTES);
    const scope = input.scope ?? 'working';

    let args: string[];
    let label: string;
    if (scope === 'working') {
      args = ['diff', '--no-ext-diff', '--'];
      label = 'git.diff(working)';
    } else if (scope === 'staged') {
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
      scope,
      diff: bounded.value,
      truncated: bounded.truncated,
      originalBytes: bounded.originalBytes,
    };

    const rangeRef = scope === 'range' ? { from: input.from ?? '', to: input.to ?? '' } : undefined;
    const sourceRef: SourceReference = {
      type: 'git_diff',
      workspaceId: input.workspaceId,
      label: rangeRef ? `git.diff(${rangeRef.from}..${rangeRef.to})` : label,
    };
    return { output, sourceReferences: [sourceRef] };
  },
};
