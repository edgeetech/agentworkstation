import type { PendingAction } from '@domain/actions';

export type WorkspaceEntry = {
  name: string;
  relativePath: string;
  kind: 'file' | 'directory';
};

export interface WorkspaceGateway {
  listDirectory(workspaceId: string, relativePath: string): Promise<string[]>;
  listDirectoryEntries(workspaceId: string, relativePath: string): Promise<WorkspaceEntry[]>;
  readFile(workspaceId: string, relativePath: string): Promise<{ content: string; source: string }>;
  readFileIfExists(workspaceId: string, relativePath: string): Promise<{ content: string; source: string } | null>;
  writeFileAtomic(workspaceId: string, relativePath: string, content: string): Promise<void>;
  getWorkspaceRoot(workspaceId: string): string;
  /** Absolute path of an existing entry inside the workspace, after the same safety checks as reads. */
  resolveExisting?(workspaceId: string, relativePath: string): Promise<string>;
}

export interface PersistencePort {
  savePendingAction(action: PendingAction): Promise<void>;
  getPendingAction(id: string): Promise<PendingAction | null>;
  listPendingActions(): Promise<PendingAction[]>;
}
