import type { ChatSessionRecord, WorkspaceRecord } from '../../../shared/api';

export type SessionGroup = {
  id: string;
  label: string;
  workspace: WorkspaceRecord | null;
  sessions: ChatSessionRecord[];
};

export function groupSessionsByWorkspace(
  workspaces: WorkspaceRecord[],
  sessions: ChatSessionRecord[],
): SessionGroup[] {
  const groups: SessionGroup[] = workspaces.map((workspace) => ({
    id: workspace.id,
    label: workspace.id,
    workspace,
    sessions: sessions.filter((session) => session.workspaceId === workspace.id),
  }));
  const unassigned = sessions.filter((session) =>
    !session.workspaceId || !workspaces.some((workspace) => workspace.id === session.workspaceId));
  if (unassigned.length > 0) {
    groups.push({ id: 'unassigned', label: 'Unassigned', workspace: null, sessions: unassigned });
  }
  return groups;
}

export function latestSessionForAgent(
  sessions: ChatSessionRecord[],
  agentId: string,
): ChatSessionRecord | undefined {
  return sessions
    .filter((session) => session.agentId === agentId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export type RecencyBucket = 'today' | 'yesterday' | 'week' | 'older';

/** Groups sessions newest-first into calendar buckets relative to `now` (local time). */
export function groupSessionsByRecency(
  sessions: ChatSessionRecord[],
  now: Date = new Date(),
): Array<{ bucket: RecencyBucket; sessions: ChatSessionRecord[] }> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const bucketOf = (session: ChatSessionRecord): RecencyBucket => {
    const time = Date.parse(session.updatedAt);
    if (Number.isNaN(time) || time >= startOfToday) return 'today';
    if (time >= startOfToday - day) return 'yesterday';
    if (time >= startOfToday - 7 * day) return 'week';
    return 'older';
  };
  const order: RecencyBucket[] = ['today', 'yesterday', 'week', 'older'];
  const sorted = [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return order
    .map((bucket) => ({ bucket, sessions: sorted.filter((session) => bucketOf(session) === bucket) }))
    .filter((group) => group.sessions.length > 0);
}
