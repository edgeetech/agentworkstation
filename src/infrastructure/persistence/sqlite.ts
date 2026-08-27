import type { PersistencePort } from '@application/ports';
import type { WorkspaceRegistration, WorkspaceRegistryPort } from '@application/workspaces';
import type { PendingAction } from '@domain/actions';
import type { ChatMessage, ChatSession } from '@domain/sessions';

type DbRunResult = { lastInsertRowid?: number | bigint };

type DbStatement = {
  run: (...params: unknown[]) => DbRunResult;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
};

type DbLike = {
  exec: (sql: string) => void;
  prepare: (sql: string) => DbStatement;
  transaction: <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => (...args: TArgs) => TResult;
};

function createDatabase(filePath: string): DbLike {
  try {
    const BetterSqlite3 = require('better-sqlite3') as (path: string) => {
      exec: (sql: string) => void;
      prepare: (sql: string) => DbStatement;
      transaction: <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => (...args: TArgs) => TResult;
    };
    return BetterSqlite3(filePath);
  } catch {
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => {
      exec: (sql: string) => void;
      prepare: (sql: string) => DbStatement;
    } };
    const sqlite = new DatabaseSync(filePath);
    return {
      exec: (sql: string) => sqlite.exec(sql),
      prepare: (sql: string) => sqlite.prepare(sql),
      transaction: <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => (...args: TArgs) => {
        sqlite.exec('begin immediate');
        try {
          const result = fn(...args);
          sqlite.exec('commit');
          return result;
        } catch (error) {
          sqlite.exec('rollback');
          throw error;
        }
      },
    };
  }
}

export class SqlitePersistence implements PersistencePort, WorkspaceRegistryPort {
  private readonly db: DbLike;

  constructor(filePath: string) {
    this.db = createDatabase(filePath);
    this.db.exec(`
      create table if not exists pending_actions (
        id text primary key,
        sessionId text not null,
        createdAt text not null,
        status text not null default 'PROPOSED',
        workspaceId text not null default '',
        expectedOriginalHash text not null,
        proposedContentHash text not null,
        targetPath text not null,
        proposedContent text not null,
        diff text not null default '',
        decidedAt text,
        rejectionReason text
      )
    `);
    this.db.exec(`
      create table if not exists workspace_registrations (
        id text primary key,
        rootPath text not null,
        kind text not null default 'project',
        selected integer not null default 0 check (selected in (0, 1))
      )
    `);
    this.db.exec('create unique index if not exists one_selected_workspace on workspace_registrations(selected) where selected = 1');
    this.db.exec('create table if not exists app_settings (key text primary key, value text not null)');
    this.db.exec(`
      create table if not exists chat_sessions (
        id text primary key,
        name text not null,
        createdAt text not null,
        updatedAt text not null,
        selected integer not null default 0 check (selected in (0, 1))
      )
    `);
    this.db.exec('create unique index if not exists one_selected_chat_session on chat_sessions(selected) where selected = 1');
    this.db.exec(`
      create table if not exists chat_messages (
        id integer primary key autoincrement,
        sessionId text not null,
        sequence integer not null,
        role text not null,
        content text not null,
        sourceReferencesJson text not null default '[]',
        createdAt text not null,
        foreign key(sessionId) references chat_sessions(id) on delete cascade
      )
    `);
    this.db.exec('create unique index if not exists one_chat_message_sequence_per_session on chat_messages(sessionId, sequence)');
    this.ensurePendingActionColumns();
    this.ensureWorkspaceColumns();
  }

  async savePendingAction(action: PendingAction): Promise<void> {
    const stmt = this.db.prepare(`
      insert into pending_actions (
        id, sessionId, createdAt, status, expectedOriginalHash,
        workspaceId, proposedContentHash, targetPath, proposedContent, diff, decidedAt, rejectionReason
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        sessionId = excluded.sessionId,
        createdAt = excluded.createdAt,
        status = excluded.status,
        expectedOriginalHash = excluded.expectedOriginalHash,
        workspaceId = excluded.workspaceId,
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
      action.workspaceId,
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
      insert into workspace_registrations (id, rootPath, kind)
      values (?, ?, ?)
      on conflict(id) do update set
        rootPath = excluded.rootPath,
        kind = excluded.kind
    `).run(workspace.id, workspace.rootPath, workspace.kind ?? 'project');
  }

  async getWorkspace(id: string): Promise<WorkspaceRegistration | null> {
    const row = this.db.prepare('select id, rootPath, kind from workspace_registrations where id = ?')
      .get(id) as WorkspaceRegistration | undefined;
    return row ?? null;
  }

  async listWorkspaces(): Promise<WorkspaceRegistration[]> {
    return this.db.prepare('select id, rootPath, kind from workspace_registrations order by lower(id), id')
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
    const row = this.db.prepare('select id, rootPath, kind from workspace_registrations where selected = 1')
      .get() as WorkspaceRegistration | undefined;
    return row ?? null;
  }

  async removeWorkspace(id: string): Promise<void> {
    const remove = this.db.transaction((workspaceId: string) => {
      const selectedRow = this.db.prepare('select selected from workspace_registrations where id = ?')
        .get(workspaceId) as { selected: number } | undefined;
      if (!selectedRow) return;
      this.db.prepare('delete from workspace_registrations where id = ?').run(workspaceId);
      if (selectedRow.selected === 1) {
        const replacement = this.db.prepare('select id from workspace_registrations order by lower(id), id limit 1')
          .get() as { id: string } | undefined;
        if (replacement) this.db.prepare('update workspace_registrations set selected = 1 where id = ?').run(replacement.id);
      }
    });
    remove(id);
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.db.prepare(`
      insert into app_settings (key, value) values (?, ?)
      on conflict(key) do update set value = excluded.value
    `).run(key, value);
  }

  async getSetting(key: string): Promise<string | null> {
    const row = this.db.prepare('select value from app_settings where key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async saveChatSession(session: ChatSession): Promise<void> {
    this.db.prepare(`
      insert into chat_sessions (id, name, createdAt, updatedAt)
      values (?, ?, ?, ?)
      on conflict(id) do update set
        name = excluded.name,
        updatedAt = excluded.updatedAt
    `).run(session.id, session.name, session.createdAt, session.updatedAt);
  }

  async listChatSessions(): Promise<ChatSession[]> {
    return this.db.prepare('select id, name, createdAt, updatedAt from chat_sessions order by updatedAt desc, id desc')
      .all() as ChatSession[];
  }

  async selectChatSession(id: string): Promise<void> {
    const select = this.db.transaction((sessionId: string) => {
      const exists = this.db.prepare('select 1 from chat_sessions where id = ?').get(sessionId);
      if (!exists) throw new Error(`Unknown chat session: ${sessionId}`);
      this.db.prepare('update chat_sessions set selected = 0 where selected = 1').run();
      this.db.prepare('update chat_sessions set selected = 1 where id = ?').run(sessionId);
    });
    select(id);
  }

  async getSelectedChatSession(): Promise<ChatSession | null> {
    const row = this.db.prepare('select id, name, createdAt, updatedAt from chat_sessions where selected = 1')
      .get() as ChatSession | undefined;
    return row ?? null;
  }

  async appendChatMessage(input: Omit<ChatMessage, 'id'>): Promise<ChatMessage> {
    const result = this.db.prepare(`
      insert into chat_messages (sessionId, sequence, role, content, sourceReferencesJson, createdAt)
      values (?, ?, ?, ?, ?, ?)
    `).run(
      input.sessionId,
      input.sequence,
      input.role,
      input.content,
      input.sourceReferencesJson,
      input.createdAt,
    );
    this.db.prepare('update chat_sessions set updatedAt = ? where id = ?').run(input.createdAt, input.sessionId);
    return {
      id: Number(result.lastInsertRowid),
      ...input,
    };
  }

  async listChatMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.db.prepare(`
      select id, sessionId, sequence, role, content, sourceReferencesJson, createdAt
      from chat_messages
      where sessionId = ?
      order by sequence asc, id asc
    `).all(sessionId) as ChatMessage[];
  }

  private ensurePendingActionColumns(): void {
    const columns = this.db.prepare('pragma table_info(pending_actions)').all() as Array<{ name: string }>;
    const existing = new Set(columns.map((column) => column.name));
    const statements = [
      !existing.has('status') ? "alter table pending_actions add column status text not null default 'PROPOSED'" : null,
      !existing.has('workspaceId') ? "alter table pending_actions add column workspaceId text not null default ''" : null,
      !existing.has('diff') ? "alter table pending_actions add column diff text not null default ''" : null,
      !existing.has('decidedAt') ? 'alter table pending_actions add column decidedAt text' : null,
      !existing.has('rejectionReason') ? 'alter table pending_actions add column rejectionReason text' : null,
    ].filter((statement): statement is string => Boolean(statement));
    for (const statement of statements) this.db.exec(statement);
  }

  private ensureWorkspaceColumns(): void {
    const columns = this.db.prepare('pragma table_info(workspace_registrations)').all() as Array<{ name: string }>;
    const existing = new Set(columns.map((column) => column.name));
    if (!existing.has('kind')) {
      this.db.exec("alter table workspace_registrations add column kind text not null default 'project'");
    }
  }
}
