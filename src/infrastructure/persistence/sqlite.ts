import Database from 'better-sqlite3';
import type { PersistencePort } from '@application/ports';
import type { WorkspaceRegistration, WorkspaceRegistryPort } from '@application/workspaces';
import type { PendingAction } from '@domain/actions';

export class SqlitePersistence implements PersistencePort, WorkspaceRegistryPort {
  private readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.exec('create table if not exists pending_actions (id text primary key, sessionId text, createdAt text, expectedOriginalHash text, proposedContentHash text, targetPath text, proposedContent text)');
    this.db.exec('create table if not exists workspace_registrations (id text primary key, rootPath text not null, selected integer not null default 0 check (selected in (0, 1)))');
    this.db.exec('create unique index if not exists one_selected_workspace on workspace_registrations(selected) where selected = 1');
  }

  async savePendingAction(action: PendingAction): Promise<void> {
    const stmt = this.db.prepare('insert or replace into pending_actions values (?, ?, ?, ?, ?, ?, ?)');
    stmt.run(action.id, action.sessionId, action.createdAt, action.expectedOriginalHash, action.proposedContentHash, action.targetPath, action.proposedContent);
  }

  async getPendingAction(id: string): Promise<PendingAction | null> {
    const row = this.db.prepare('select * from pending_actions where id = ?').get(id) as PendingAction | undefined;
    return row ?? null;
  }

  async saveWorkspace(workspace: WorkspaceRegistration): Promise<void> {
    this.db.prepare(`
      insert into workspace_registrations (id, rootPath)
      values (?, ?)
      on conflict(id) do update set rootPath = excluded.rootPath
    `).run(workspace.id, workspace.rootPath);
  }

  async getWorkspace(id: string): Promise<WorkspaceRegistration | null> {
    const row = this.db.prepare('select id, rootPath from workspace_registrations where id = ?')
      .get(id) as WorkspaceRegistration | undefined;
    return row ?? null;
  }

  async listWorkspaces(): Promise<WorkspaceRegistration[]> {
    return this.db.prepare('select id, rootPath from workspace_registrations order by lower(id), id')
      .all() as WorkspaceRegistration[];
  }

  async selectWorkspace(id: string): Promise<void> {
    const select = this.db.transaction((workspaceId: string) => {
      const exists = this.db.prepare('select 1 from workspace_registrations where id = ?').get(workspaceId);
      if (!exists) throw new Error(`Unknown workspace: ${workspaceId}`);
      this.db.prepare('update workspace_registrations set selected = 0 where selected = 1').run();
      this.db.prepare('update workspace_registrations set selected = 1 where id = ?').run(workspaceId);
    });
    select(id);
  }

  async getSelectedWorkspace(): Promise<WorkspaceRegistration | null> {
    const row = this.db.prepare('select id, rootPath from workspace_registrations where selected = 1')
      .get() as WorkspaceRegistration | undefined;
    return row ?? null;
  }
}

