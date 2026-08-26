import Database from 'better-sqlite3';
import type { PersistencePort } from '@application/ports';
import type { WorkspaceRegistration, WorkspaceRegistryPort } from '@application/workspaces';
import type { PendingAction } from '@domain/actions';

export class SqlitePersistence implements PersistencePort, WorkspaceRegistryPort {
  private readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.exec(`
      create table if not exists pending_actions (
        id text primary key,
        sessionId text not null,
        createdAt text not null,
        status text not null default 'PROPOSED',
        expectedOriginalHash text not null,
        proposedContentHash text not null,
        targetPath text not null,
        proposedContent text not null,
        diff text not null default '',
        decidedAt text,
        rejectionReason text
      )
    `);
    this.db.exec('create table if not exists workspace_registrations (id text primary key, rootPath text not null, selected integer not null default 0 check (selected in (0, 1)))');
    this.db.exec('create unique index if not exists one_selected_workspace on workspace_registrations(selected) where selected = 1');
    this.ensurePendingActionColumns();
  }

  async savePendingAction(action: PendingAction): Promise<void> {
    const stmt = this.db.prepare(`
      insert into pending_actions (
        id, sessionId, createdAt, status, expectedOriginalHash,
        proposedContentHash, targetPath, proposedContent, diff, decidedAt, rejectionReason
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        sessionId = excluded.sessionId,
        createdAt = excluded.createdAt,
        status = excluded.status,
        expectedOriginalHash = excluded.expectedOriginalHash,
        proposedContentHash = excluded.proposedContentHash,
        targetPath = excluded.targetPath,
        proposedContent = excluded.proposedContent,
        diff = excluded.diff,
        decidedAt = excluded.decidedAt,
        rejectionReason = excluded.rejectionReason
    `);
    stmt.run(
      action.id,
      action.sessionId,
      action.createdAt,
      action.status,
      action.expectedOriginalHash,
      action.proposedContentHash,
      action.targetPath,
      action.proposedContent,
      action.diff,
      action.decidedAt ?? null,
      action.rejectionReason ?? null,
    );
  }

  async getPendingAction(id: string): Promise<PendingAction | null> {
    const row = this.db.prepare('select * from pending_actions where id = ?').get(id) as PendingAction | undefined;
    return row ?? null;
  }

  async listPendingActions(): Promise<PendingAction[]> {
    return this.db.prepare('select * from pending_actions order by createdAt desc, id desc').all() as PendingAction[];
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

  private ensurePendingActionColumns(): void {
    const columns = this.db.prepare('pragma table_info(pending_actions)').all() as Array<{ name: string }>;
    const existing = new Set(columns.map((column) => column.name));
    const statements = [
      !existing.has('status') ? "alter table pending_actions add column status text not null default 'PROPOSED'" : null,
      !existing.has('diff') ? "alter table pending_actions add column diff text not null default ''" : null,
      !existing.has('decidedAt') ? 'alter table pending_actions add column decidedAt text' : null,
      !existing.has('rejectionReason') ? 'alter table pending_actions add column rejectionReason text' : null,
    ].filter((statement): statement is string => Boolean(statement));
    for (const statement of statements) this.db.exec(statement);
  }
}
