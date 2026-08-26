import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceGateway } from '../../src/application/ports';
import {
  WorkspaceService,
  type WorkspaceRegistration,
  type WorkspaceRegistryPort,
} from '../../src/application/workspaces';

function makeRegistry(): WorkspaceRegistryPort {
  const registrations = new Map<string, WorkspaceRegistration>();
  let selectedId: string | null = null;
  return {
    async saveWorkspace(workspace) { registrations.set(workspace.id, workspace); },
    async getWorkspace(id) { return registrations.get(id) ?? null; },
    async listWorkspaces() { return [...registrations.values()].sort((a, b) => a.id.localeCompare(b.id)); },
    async selectWorkspace(id) {
      if (!registrations.has(id)) throw new Error(`Unknown workspace: ${id}`);
      selectedId = id;
    },
    async getSelectedWorkspace() { return selectedId ? registrations.get(selectedId) ?? null : null; },
  };
}

describe('WorkspaceService', () => {
  it('normalizes registrations and delegates deterministic selection', async () => {
    const gateway = { listDirectory: vi.fn() } as unknown as WorkspaceGateway;
    const service = new WorkspaceService(gateway, makeRegistry());

    await service.register({ id: ' project ', rootPath: ' C:\\work\\project ' });
    await service.select('project');

    await expect(service.list()).resolves.toEqual([{ id: 'project', rootPath: 'C:\\work\\project' }]);
    await expect(service.selected()).resolves.toEqual({ id: 'project', rootPath: 'C:\\work\\project' });
  });

  it('rejects blank registration fields', async () => {
    const gateway = { listDirectory: vi.fn() } as unknown as WorkspaceGateway;
    const service = new WorkspaceService(gateway, makeRegistry());

    await expect(service.register({ id: ' ', rootPath: 'C:\\work' })).rejects.toThrow('Workspace id is required');
    await expect(service.register({ id: 'project', rootPath: ' ' })).rejects.toThrow('Workspace root path is required');
  });
});
