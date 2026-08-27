import type { PendingAction } from '@domain/actions';
import type { PersistencePort, WorkspaceGateway } from './ports';

const MAX_PROPOSAL_BYTES = 256 * 1024;
const MAX_DIFF_LINES = 2_000;

function createActionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function contentHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').split('\n');
}

type DiffLine = { kind: 'context' | 'removed' | 'added'; value: string };

function diffLines(beforeLines: string[], afterLines: string[]): DiffLine[] {
  const lengths = Array.from({ length: beforeLines.length + 1 }, () =>
    Array<number>(afterLines.length + 1).fill(0),
  );

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lengths[beforeIndex][afterIndex] = beforeLines[beforeIndex] === afterLines[afterIndex]
        ? lengths[beforeIndex + 1][afterIndex + 1] + 1
        : Math.max(lengths[beforeIndex + 1][afterIndex], lengths[beforeIndex][afterIndex + 1]);
    }
  }

  const result: DiffLine[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    if (
      beforeIndex < beforeLines.length
      && afterIndex < afterLines.length
      && beforeLines[beforeIndex] === afterLines[afterIndex]
    ) {
      result.push({ kind: 'context', value: beforeLines[beforeIndex] });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (
      afterIndex < afterLines.length
      && (beforeIndex === beforeLines.length
        || lengths[beforeIndex][afterIndex + 1] >= lengths[beforeIndex + 1][afterIndex])
    ) {
      result.push({ kind: 'added', value: afterLines[afterIndex] });
      afterIndex += 1;
    } else {
      result.push({ kind: 'removed', value: beforeLines[beforeIndex] });
      beforeIndex += 1;
    }
  }
  return result;
}

export function buildUnifiedDiff(targetPath: string, before: string, after: string): string {
  if (before === after) return `--- a/${targetPath}\n+++ b/${targetPath}\n@@ no changes @@`;
  const beforeLines = normalizeLines(before);
  const afterLines = normalizeLines(after);
  if (beforeLines.length > MAX_DIFF_LINES || afterLines.length > MAX_DIFF_LINES) {
    throw new Error(`File exceeds the ${MAX_DIFF_LINES}-line safe review limit`);
  }
  const body = diffLines(beforeLines, afterLines).map(({ kind, value }) => {
    if (kind === 'added') return `+${value}`;
    if (kind === 'removed') return `-${value}`;
    return ` ${value}`;
  });
  return [
    `--- a/${targetPath}`,
    `+++ b/${targetPath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...body,
  ].join('\n');
}

export class ApprovalService {
  constructor(
    private readonly persistence: PersistencePort,
    private readonly workspaceGateway: WorkspaceGateway,
  ) {}

  async proposeWrite(input: {
    workspaceId: string;
    targetPath: string;
    proposedContent: string;
    sessionId: string;
  }): Promise<PendingAction> {
    if (new TextEncoder().encode(input.proposedContent).byteLength > MAX_PROPOSAL_BYTES) {
      throw new Error('Proposed content exceeds the 256 KB safe review limit');
    }
    const existing = await this.workspaceGateway.readFileIfExists(input.workspaceId, input.targetPath);
    const currentContent = existing?.content ?? '';
    const now = new Date().toISOString();
    const action: PendingAction = {
      id: createActionId(),
      sessionId: input.sessionId,
      createdAt: now,
      status: 'PROPOSED',
      workspaceId: input.workspaceId,
      expectedOriginalHash: contentHash(currentContent),
      proposedContentHash: contentHash(input.proposedContent),
      targetPath: input.targetPath,
      proposedContent: input.proposedContent,
      diff: buildUnifiedDiff(input.targetPath, currentContent, input.proposedContent),
    };
    await this.persistence.savePendingAction(action);
    return action;
  }

  async listPending(): Promise<PendingAction[]> {
    const actions = await this.persistence.listPendingActions();
    return actions.filter((action) => action.status === 'PROPOSED' || action.status === 'APPROVED');
  }

  async rejectAction(actionId: string, reason: string): Promise<PendingAction> {
    const existing = await this.persistence.getPendingAction(actionId);
    if (!existing) throw new Error(`Pending action not found: ${actionId}`);
    const rejected: PendingAction = {
      ...existing,
      status: 'REJECTED',
      decidedAt: new Date().toISOString(),
      rejectionReason: reason.trim() || 'Rejected by user',
    };
    await this.persistence.savePendingAction(rejected);
    return rejected;
  }

  async approveAndExecute(actionId: string, workspaceId?: string): Promise<PendingAction> {
    const existing = await this.persistence.getPendingAction(actionId);
    if (!existing) throw new Error(`Pending action not found: ${actionId}`);
    if (existing.status === 'REJECTED') throw new Error('Cannot approve a rejected action');
    if (existing.status === 'EXECUTED') return existing;

    const targetWorkspaceId = existing.workspaceId || workspaceId;
    if (!targetWorkspaceId) throw new Error('Pending action missing workspace binding');

    const current = await this.workspaceGateway.readFileIfExists(targetWorkspaceId, existing.targetPath);
    const currentHash = contentHash(current?.content ?? '');
    if (currentHash !== existing.expectedOriginalHash) {
      const stale: PendingAction = {
        ...existing,
        status: 'STALE',
        decidedAt: new Date().toISOString(),
        rejectionReason: 'Target file changed since proposal creation',
      };
      await this.persistence.savePendingAction(stale);
      throw new Error('Approval rejected: target content is stale');
    }

    const approved: PendingAction = {
      ...existing,
      status: 'APPROVED',
      decidedAt: new Date().toISOString(),
    };
    await this.persistence.savePendingAction(approved);
    await this.workspaceGateway.writeFileAtomic(targetWorkspaceId, approved.targetPath, approved.proposedContent);

    const executed: PendingAction = {
      ...approved,
      status: 'EXECUTED',
      decidedAt: new Date().toISOString(),
    };
    await this.persistence.savePendingAction(executed);
    return executed;
  }
}
