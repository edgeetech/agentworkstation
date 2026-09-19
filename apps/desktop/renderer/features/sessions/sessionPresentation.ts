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
