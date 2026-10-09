import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceGateway } from '../../src/application/ports';
import {
  buildWorkspaceAccessInstructions,
  isProfileSource,
  localRoots,
  sameSourceLocation,
  sourceIdFor,
  sourceKind,
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
  it('keeps ordinary conversation available when a specialist has no sources', () => {
    const instructions = buildWorkspaceAccessInstructions([]);

    expect(instructions).toContain('Continue normal conversation and reasoning without local files');
    expect(instructions).toContain('ask the user to add it on your Sources page');
    expect(instructions).toContain('Never present missing sources as a failed message');
  });

  it('lists local sources with notes for tool calls and web sources for web.read', () => {
    const instructions = buildWorkspaceAccessInstructions([
      { id: 'books', rootPath: 'C:/Accounts', note: 'Payroll and HMRC records' },
      { id: 'site', rootPath: 'C:/Workspace/site' },
      { id: 'pricing', rootPath: 'https://taksim.dev/pricing', note: 'Live pricing page' },
    ], 'site');

    expect(instructions).toContain('Primary local source ID: "site"');
    expect(instructions).toContain('"id":"books","rootPath":"C:/Accounts","note":"Payroll and HMRC records"');
    expect(instructions).toContain('"id":"site","rootPath":"C:/Workspace/site"}');
    expect(instructions).toContain('Web sources: [{"url":"https://taksim.dev/pricing","note":"Live pricing page"}]');
    expect(instructions).not.toContain('"id":"pricing"');
    expect(instructions).toContain('read it with relativePath "."');
    expect(instructions).toContain('gave these sources to you alone');
  });

  it('bounds local sources while putting the primary one first', () => {
    const registrations = Array.from({ length: 40 }, (_, index) => ({ id: `workspace-${index}`, rootPath: `C:/Workspace/${index}` }));
    const instructions = buildWorkspaceAccessInstructions(registrations, 'workspace-39');

    expect(instructions).toContain('Local sources (32 of 40)');
    expect(instructions.indexOf('workspace-39')).toBeLessThan(instructions.indexOf('workspace-0'));
    expect(new TextEncoder().encode(instructions).byteLength).toBeLessThan(10 * 1024);
  });

  it('keeps web sources out of filesystem roots and matches duplicate locations safely', () => {
    expect(localRoots([
      { id: 'books', rootPath: 'C:/books' },
      { id: 'pricing', rootPath: 'https://taksim.dev/pricing' },
    ])).toEqual({ books: 'C:/books' });
    expect(sameSourceLocation('C:/Books/', 'c:/books')).toBe(true);
    expect(sameSourceLocation(String.raw`C:\Users\me\Books\\`, 'c:/users/me/books')).toBe(true);
    expect(sameSourceLocation('https://taksim.dev/Pricing', 'https://taksim.dev/pricing')).toBe(false);
    expect(sameSourceLocation('https://taksim.dev/pricing', 'https://taksim.dev/pricing')).toBe(true);
    expect(sameSourceLocation('C:/books', 'https://books')).toBe(false);
  });

  it('derives readable unique source IDs and spots CV or profile sources from their notes', () => {
    expect(sourceKind('https://example.com')).toBe('web');
    expect(sourceKind('C:/work')).toBe('local');
    expect(sourceIdFor('C:/Users/me/OneDrive/Organized EdgeeTech', [])).toBe('organized-edgeetech');
    expect(sourceIdFor('C:/a/Organized EdgeeTech/', ['organized-edgeetech'])).toBe('organized-edgeetech-2');
    expect(sourceIdFor('https://www.taksim.dev/pricing/', [])).toBe('taksim-dev-pricing');
    expect(isProfileSource({ id: 'a', rootPath: 'C:/cv', note: 'My current CV' })).toBe(true);
    expect(isProfileSource({ id: 'b', rootPath: 'C:/p', kind: 'profile' })).toBe(true);
    expect(isProfileSource({ id: 'c', rootPath: 'C:/books', note: 'Payroll records' })).toBe(false);
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
