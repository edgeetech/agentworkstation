import { describe, expect, it } from 'vitest';
import type { ChatSessionRecord, WorkspaceRecord } from '../../apps/desktop/shared/api';
import { groupSessionsByWorkspace, latestSessionForAgent } from '../../apps/desktop/renderer/features/sessions/sessionPresentation';

const workspace = (id: string): WorkspaceRecord => ({
  id,
  rootPath: `C:/work/${id}`,
  kind: 'project',
  selected: id === 'profile',
});

const session = (id: string, workspaceId?: string | null): ChatSessionRecord => ({
  id,
  name: id,
  mode: 'autopilot',
  workspaceId,
  agentId: 'career',
  intelligencePreference: 'auto',
  permissionMode: 'interactive',
  isolationMode: 'read_only',
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
  selected: false,
});

describe('groupSessionsByWorkspace', () => {
  it('keeps every session under its workspace and isolates legacy or missing workspaces', () => {
    const groups = groupSessionsByWorkspace(
      [workspace('profile'), workspace('website')],
      [session('profile review', 'profile'), session('site review', 'website'), session('legacy'), session('missing', 'removed')],
    );

    expect(groups.map((group) => [group.label, group.sessions.map((item) => item.id)])).toEqual([
      ['profile', ['profile review']],
      ['website', ['site review']],
      ['Unassigned', ['legacy', 'missing']],
    ]);
  });

  it('keeps registered workspaces visible when they have no sessions', () => {
    const groups = groupSessionsByWorkspace([workspace('profile')], []);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.sessions).toEqual([]);
  });
});

describe('latestSessionForAgent', () => {
  it('returns only the most recently updated conversation for the requested agent', () => {
    const oldCareer = session('old career', 'profile');
    const newCareer = { ...session('new career', 'profile'), updatedAt: '2026-09-01T00:00:00.000Z' };
    const blogger = { ...session('blogger', 'website'), agentId: 'blogger', updatedAt: '2026-09-02T00:00:00.000Z' };

    expect(latestSessionForAgent([blogger, newCareer, oldCareer], 'career')?.id).toBe('new career');
    expect(latestSessionForAgent([blogger], 'career')).toBeUndefined();
  });
});
