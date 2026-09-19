import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceGateway } from '../../src/application/ports';
import {
  buildWorkspaceAccessInstructions,
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
    async removeWorkspace(id) {
      registrations.delete(id);
      if (selectedId === id) selectedId = null;
    },
    async getSelectedWorkspace() { return selectedId ? registrations.get(selectedId) ?? null : null; },
  };
}

describe('WorkspaceService', () => {
  it('keeps ordinary conversation available when no local workspace exists', () => {
    const instructions = buildWorkspaceAccessInstructions([]);

    expect(instructions).toContain('Continue normal conversation and reasoning without local files');
    expect(instructions).toContain('ask the user to add a folder from Workspaces');
    expect(instructions).toContain('Never present missing workspace access as a failed message');
  });

  it('builds trusted ID-to-root instructions for workspace-aware tool calls', () => {
    const instructions = buildWorkspaceAccessInstructions([
      { id: 'site-profile', rootPath: 'C:\\Workspace\\profile', kind: 'profile' },
      { id: 'site', rootPath: 'C:\\Workspace\\site' },
    ], 'site');

    expect(instructions).toContain('Selected workspace ID: "site"');
    expect(instructions).toContain('"id":"site-profile","rootPath":"C:\\\\Workspace\\\\profile","purpose":"profile"');
    expect(instructions).toContain('"id":"site","rootPath":"C:\\\\Workspace\\\\site","purpose":"project"');
    expect(instructions).toContain('workspace-relative path');
    expect(instructions).toContain('Do not claim a mapped workspace is unavailable');
    expect(instructions.indexOf('workspace-relative path')).toBeLessThan(instructions.indexOf('Registered mappings'));
  });

  it('bounds workspace mappings while prioritizing the selected workspace', () => {
    const registrations = Array.from({ length: 40 }, (_, index) => ({
      id: `workspace-${index}`,
      rootPath: `C:\\Workspace\\${index}`,
      kind: 'project' as const,
    }));

    const instructions = buildWorkspaceAccessInstructions(registrations, 'workspace-39');

    expect(instructions).toContain('Registered mappings (32 of 40)');
    expect(instructions.indexOf('workspace-39')).toBeLessThan(instructions.indexOf('workspace-0'));
    expect(new TextEncoder().encode(instructions).byteLength).toBeLessThan(10 * 1024);
  });

  it('normalizes registrations and delegates deterministic selection', async () => {
    const gateway = { listDirectory: vi.fn() } as unknown as WorkspaceGateway;
    const service = new WorkspaceService(gateway, makeRegistry());

    await service.register({ id: ' project ', rootPath: ' C:\\work\\project ' });
    await service.select('project');

    await expect(service.list()).resolves.toEqual([{ id: 'project', rootPath: 'C:\\work\\project', kind: 'project' }]);
    await expect(service.selected()).resolves.toEqual({ id: 'project', rootPath: 'C:\\work\\project', kind: 'project' });
  });

  it('rejects blank registration fields', async () => {
    const gateway = { listDirectory: vi.fn() } as unknown as WorkspaceGateway;
    const service = new WorkspaceService(gateway, makeRegistry());

    await expect(service.register({ id: ' ', rootPath: 'C:\\work' })).rejects.toThrow('Workspace id is required');
    await expect(service.register({ id: 'project', rootPath: ' ' })).rejects.toThrow('Workspace root path is required');
  });
});
