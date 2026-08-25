export type PendingAction = {
  id: string;
  sessionId: string;
  createdAt: string;
  expectedOriginalHash: string;
  proposedContentHash: string;
  targetPath: string;
  proposedContent: string;
};

