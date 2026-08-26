import type { WorkspaceGateway } from './ports';

export type WorkspaceRegistration = {
  id: string;
  rootPath: string;
};

export class WorkspaceService {
  constructor(private readonly gateway: WorkspaceGateway) {}

  async readTopFiles(workspaceId: string, relativePath = '.'): Promise<string[]> {
    return this.gateway.listDirectory(workspaceId, relativePath);
  }
}

