import type { PendingAction } from '@domain/actions';

export interface WorkspaceGateway {
  listDirectory(workspaceId: string, relativePath: string): Promise<string[]>;
  readFile(workspaceId: string, relativePath: string): Promise<{ content: string; source: string }>;
  getWorkspaceRoot(workspaceId: string): string;
}

export interface PersistencePort {
  savePendingAction(action: PendingAction): Promise<void>;
  getPendingAction(id: string): Promise<PendingAction | null>;
}

