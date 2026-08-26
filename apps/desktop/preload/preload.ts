import { buildDeterministicCareerAuditScenario } from '../../../src/application/careerAuditScenario';
import { ApprovalService } from '../../../src/application/approvals';
import { DefaultWorkspaceGateway } from '../../../src/infrastructure/filesystem/workspaceGateway';
import { SqlitePersistence } from '../../../src/infrastructure/persistence/sqlite';
import { DefaultPlatformService } from '../../../src/infrastructure/platform/defaultPlatformService';
import type { PendingAction } from '../../../src/domain/actions';
import { join } from 'node:path';

type CareerAuditApi = {
  getDemoAudit: () => Promise<ReturnType<typeof buildDeterministicCareerAuditScenario>>;
  listPendingActions: () => Promise<PendingAction[]>;
  proposeReadmeUpdate: () => Promise<PendingAction>;
  approvePendingAction: (actionId: string) => Promise<PendingAction>;
  rejectPendingAction: (actionId: string, reason: string) => Promise<PendingAction>;
};

declare global {
  interface Window {
    agentWorkstation?: CareerAuditApi;
  }
}

const platform = new DefaultPlatformService();
let persistencePromise: Promise<SqlitePersistence> | null = null;
const sessionId = `desktop-${Date.now()}`;

async function ensureWorkspaceSelection(): Promise<{ selectedWorkspaceId: string; gateway: DefaultWorkspaceGateway }> {
  const persistence = await getPersistence();
  const workspaces = await persistence.listWorkspaces();
  if (workspaces.length === 0) {
    await persistence.saveWorkspace({ id: 'agentworkstation', rootPath: process.cwd() });
    await persistence.selectWorkspace('agentworkstation');
  }
  const current = await persistence.getSelectedWorkspace() ?? (await persistence.listWorkspaces())[0];
  if (!current) throw new Error('No workspace configured');
  const all = await persistence.listWorkspaces();
  const roots = Object.fromEntries(all.map((workspace) => [workspace.id, workspace.rootPath]));
  return { selectedWorkspaceId: current.id, gateway: new DefaultWorkspaceGateway(roots) };
}

async function approvals(): Promise<{ service: ApprovalService; workspaceId: string }> {
  const persistence = await getPersistence();
  const context = await ensureWorkspaceSelection();
  return {
    service: new ApprovalService(persistence, context.gateway),
    workspaceId: context.selectedWorkspaceId,
  };
}

async function getPersistence(): Promise<SqlitePersistence> {
  if (persistencePromise) return persistencePromise;
  persistencePromise = (async () => {
    const appDataDirectory = await platform.getAppDataDirectory();
    return new SqlitePersistence(join(appDataDirectory, 'agentworkstation.db'));
  })();
  return persistencePromise;
}

window.agentWorkstation = {
  getDemoAudit: async () => buildDeterministicCareerAuditScenario(),
  listPendingActions: async () => {
    const { service } = await approvals();
    return service.listPending();
  },
  proposeReadmeUpdate: async () => {
    const { service, workspaceId } = await approvals();
    const existing = await service.proposeWrite({
      workspaceId,
      targetPath: 'README.md',
      proposedContent: '# Agent Workstation\n\nLocal Career Agent workstation for evidence-backed profile audits.\n',
      sessionId,
    });
    return existing;
  },
  approvePendingAction: async (actionId) => {
    const { service, workspaceId } = await approvals();
    return service.approveAndExecute(actionId, workspaceId);
  },
  rejectPendingAction: async (actionId, reason) => {
    const { service } = await approvals();
    return service.rejectAction(actionId, reason);
  },
};
