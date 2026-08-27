export type PendingActionStatus = 'PROPOSED' | 'APPROVED' | 'EXECUTED' | 'REJECTED' | 'STALE';

export type PendingAction = {
  id: string;
  sessionId: string;
  createdAt: string;
  status: PendingActionStatus;
  workspaceId: string;
  expectedOriginalHash: string;
  proposedContentHash: string;
  targetPath: string;
  proposedContent: string;
  diff: string;
  decidedAt?: string;
  rejectionReason?: string;
  routingJson?: string | null;
};
