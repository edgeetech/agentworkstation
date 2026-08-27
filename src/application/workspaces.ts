import type { WorkspaceGateway } from './ports';

export type WorkspaceRegistration = {
  id: string;
  rootPath: string;
  kind?: 'profile' | 'project' | 'cv';
};

export interface WorkspaceRegistryPort {
  saveWorkspace(workspace: WorkspaceRegistration): Promise<void>;
  getWorkspace(id: string): Promise<WorkspaceRegistration | null>;
  listWorkspaces(): Promise<WorkspaceRegistration[]>;
  selectWorkspace(id: string): Promise<void>;
  removeWorkspace(id: string): Promise<void>;
  getSelectedWorkspace(): Promise<WorkspaceRegistration | null>;
}

export class WorkspaceService {
  constructor(
    private readonly gateway: WorkspaceGateway,
    private readonly registry: WorkspaceRegistryPort,
  ) {}

  async register(workspace: WorkspaceRegistration): Promise<void> {
    const id = workspace.id.trim();
    const rootPath = workspace.rootPath.trim();
    const kind = workspace.kind ?? 'project';
    if (!id) throw new Error('Workspace id is required');
    if (!rootPath) throw new Error('Workspace root path is required');
    await this.registry.saveWorkspace({ id, rootPath, kind });
  }

  async list(): Promise<WorkspaceRegistration[]> {
    return this.registry.listWorkspaces();
  }

  async select(id: string): Promise<void> {
    await this.registry.selectWorkspace(id);
  }

  async remove(id: string): Promise<void> {
    await this.registry.removeWorkspace(id);
  }

  async selected(): Promise<WorkspaceRegistration | null> {
    return this.registry.getSelectedWorkspace();
  }

  async readTopFiles(workspaceId: string, relativePath = '.'): Promise<string[]> {
    return this.gateway.listDirectory(workspaceId, relativePath);
  }
}
