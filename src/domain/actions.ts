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

export type ProposalTally = {
  limit: number;
  total: number;
  approved: number;
  rejected: number;
};

/**
 * Tallies approve/reject outcomes over the most recent proposals so the UI can show,
 * e.g., "last 10 proposals: 6 approved, 4 rejected" for the active agent. EXECUTED
 * counts as approved (it is an approved action that has since been applied); PROPOSED
 * and STALE are excluded from the ratio since they have no human decision yet.
 * `actions` must already be ordered most-recent-first.
 */
export function tallyProposals(actions: PendingAction[], limit = 10): ProposalTally {
  const recent = actions.slice(0, limit);
  const approved = recent.filter((action) => action.status === 'APPROVED' || action.status === 'EXECUTED').length;
  const rejected = recent.filter((action) => action.status === 'REJECTED').length;
  return { limit, total: recent.length, approved, rejected };
}
