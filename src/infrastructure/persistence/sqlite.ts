import type { PersistencePort } from '@application/ports';
import type { WorkspaceRegistration, WorkspaceRegistryPort } from '@application/workspaces';
import type { PendingAction } from '@domain/actions';
import type { ChatMessage, ChatSession } from '@domain/sessions';
import type { AgentMemoryEntry, AgentMemoryStore, OnboardingIntent } from '@domain/onboarding';

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
  close: () => void;
};

type AgentMemoryRow = {
  agentId: string;
  fieldKey: string;
  valueJson: string;
  provenanceJson: string;
  confidence: number;
  confirmationStatus: AgentMemoryEntry['confirmationStatus'];
  confirmedAt: string | null;
  updatedAt: string;
};

function toAgentMemoryEntry(row: AgentMemoryRow): AgentMemoryEntry {
  return {
    agentId: row.agentId,
    fieldKey: row.fieldKey,
    value: JSON.parse(row.valueJson) as unknown,
    provenance: JSON.parse(row.provenanceJson) as AgentMemoryEntry['provenance'],
    confidence: row.confidence,
    confirmationStatus: row.confirmationStatus,
    ...(row.confirmedAt ? { confirmedAt: row.confirmedAt } : {}),
    updatedAt: row.updatedAt,
  };
}

function createDatabase(filePath: string): DbLike {
  try {
    const BetterSqlite3 = require('better-sqlite3') as (path: string) => {
      exec: (sql: string) => void;
      prepare: (sql: string) => DbStatement;
      transaction: <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => (...args: TArgs) => TResult;
      close: () => void;
    };
    return BetterSqlite3(filePath);
  } catch {
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => {
      exec: (sql: string) => void;
      prepare: (sql: string) => DbStatement;
      close: () => void;
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
      close: () => sqlite.close(),
    };
  }
}

export class SqlitePersistence implements PersistencePort, WorkspaceRegistryPort, AgentMemoryStore {
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
        routingJson text,
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
        mode text not null default 'autopilot' check (mode in ('standard', 'autopilot')),
        workspaceId text,
        agentId text not null default 'career',
        intelligencePreference text not null default 'auto',
        permissionMode text not null default 'interactive',
        isolationMode text not null default 'read_only',
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
        routingJson text,
        mode text check (mode is null or mode in ('standard', 'autopilot')),
        createdAt text not null,
        foreign key(sessionId) references chat_sessions(id) on delete cascade
      )
    `);
    this.db.exec(`
      create table if not exists agent_memory (
        agentId text not null,
        fieldKey text not null,
        valueJson text not null check (json_valid(valueJson)),
        rawAnswer text not null,
        provenanceJson text not null check (json_valid(provenanceJson)),
        confidence real not null check (confidence >= 0 and confidence <= 1),
        confirmationStatus text not null check (confirmationStatus in ('pending', 'confirmed', 'rejected')),
        confirmedAt text,
        updatedAt text not null,
        primary key (agentId, fieldKey)
      )
    `);
    this.db.exec('create index if not exists agent_memory_by_agent on agent_memory(agentId, updatedAt)');
    this.db.exec(`
      create table if not exists agent_onboarding_state (
        agentId text primary key,
        activeIntent text check (activeIntent in ('publish', 'linkedin'))
      )
    `);
    this.db.exec('create unique index if not exists one_chat_message_sequence_per_session on chat_messages(sessionId, sequence)');
    this.ensurePendingActionColumns();
    this.ensureWorkspaceColumns();
    this.ensureChatSessionColumns();
    this.ensureChatMessageColumns();
  }

  async savePendingAction(action: PendingAction): Promise<void> {
    const stmt = this.db.prepare(`
      insert into pending_actions (
        id, sessionId, createdAt, status, expectedOriginalHash,
        workspaceId, proposedContentHash, targetPath, proposedContent, diff, routingJson, decidedAt, rejectionReason
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        routingJson = excluded.routingJson,
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
      action.routingJson ?? null,
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

  /** Most recent proposals (any status) whose session belongs to the given agent, newest first. */
  async listPendingActionsByAgent(agentId: string, limit: number): Promise<PendingAction[]> {
    return this.db.prepare(`
      select pa.* from pending_actions pa
      join chat_sessions cs on cs.id = pa.sessionId
      where cs.agentId = ?
      order by pa.createdAt desc, pa.id desc
      limit ?
    `).all(agentId, limit) as PendingAction[];
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

  async saveMemoryEntry(entry: AgentMemoryEntry): Promise<void> {
    this.db.prepare(`
      insert into agent_memory (
        agentId, fieldKey, valueJson, rawAnswer, provenanceJson,
        confidence, confirmationStatus, confirmedAt, updatedAt
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(agentId, fieldKey) do update set
        valueJson = excluded.valueJson,
        rawAnswer = excluded.rawAnswer,
        provenanceJson = excluded.provenanceJson,
        confidence = excluded.confidence,
        confirmationStatus = excluded.confirmationStatus,
        confirmedAt = excluded.confirmedAt,
        updatedAt = excluded.updatedAt
    `).run(
      entry.agentId,
      entry.fieldKey,
      JSON.stringify(entry.value),
      '',
      JSON.stringify(entry.provenance),
      entry.confidence,
      entry.confirmationStatus,
      entry.confirmedAt ?? null,
      entry.updatedAt,
    );
  }

  async getMemoryEntry(agentId: string, fieldKey: string): Promise<AgentMemoryEntry | null> {
    const row = this.db.prepare(`
      select agentId, fieldKey, valueJson, provenanceJson,
        confidence, confirmationStatus, confirmedAt, updatedAt
      from agent_memory where agentId = ? and fieldKey = ?
    `).get(agentId, fieldKey) as AgentMemoryRow | undefined;
    return row ? toAgentMemoryEntry(row) : null;
  }

  async getAgentMemory(agentId: string): Promise<AgentMemoryEntry[]> {
    const rows = this.db.prepare(`
      select agentId, fieldKey, valueJson, provenanceJson,
        confidence, confirmationStatus, confirmedAt, updatedAt
      from agent_memory where agentId = ? order by updatedAt asc, fieldKey asc
    `).all(agentId) as AgentMemoryRow[];
    return rows.map(toAgentMemoryEntry);
  }

  async getActiveOnboardingIntent(agentId: string): Promise<OnboardingIntent | null> {
    const row = this.db.prepare('select activeIntent from agent_onboarding_state where agentId = ?')
      .get(agentId) as { activeIntent: OnboardingIntent | null } | undefined;
    return row?.activeIntent ?? null;
  }

  async setActiveOnboardingIntent(agentId: string, intent: OnboardingIntent | null): Promise<void> {
    if (intent === 'initial') throw new Error('Initial onboarding does not require an explicit active state');
    if (intent === null) {
      this.db.prepare('delete from agent_onboarding_state where agentId = ?').run(agentId);
      return;
    }
    this.db.prepare(`
      insert into agent_onboarding_state (agentId, activeIntent) values (?, ?)
      on conflict(agentId) do update set activeIntent = excluded.activeIntent
    `).run(agentId, intent);
  }

  close(): void {
    this.db.close();
  }

  async saveChatSession(session: ChatSession): Promise<void> {
    this.db.prepare(`
      insert into chat_sessions (
        id, name, mode, workspaceId, agentId, intelligencePreference,
        permissionMode, isolationMode, createdAt, updatedAt
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        name = excluded.name,
        mode = excluded.mode,
        workspaceId = excluded.workspaceId,
        agentId = excluded.agentId,
        intelligencePreference = excluded.intelligencePreference,
        permissionMode = excluded.permissionMode,
        isolationMode = excluded.isolationMode,
        updatedAt = excluded.updatedAt
    `).run(
      session.id,
      session.name,
      session.mode,
      session.workspaceId ?? null,
      session.agentId,
      session.intelligencePreference,
      session.permissionMode,
      session.isolationMode,
      session.createdAt,
      session.updatedAt,
    );
  }

  async listChatSessions(): Promise<ChatSession[]> {
    return this.db.prepare(`
      select id, name, mode, workspaceId, agentId, intelligencePreference,
        permissionMode, isolationMode, createdAt, updatedAt
      from chat_sessions
      order by updatedAt desc, id desc
    `)
      .all() as ChatSession[];
  }

  async deleteChatSession(id: string): Promise<void> {
    const remove = this.db.transaction((sessionId: string) => {
      this.db.prepare('delete from chat_messages where sessionId = ?').run(sessionId);
      this.db.prepare('delete from chat_sessions where id = ?').run(sessionId);
    });
    remove(id);
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
    const row = this.db.prepare(`
      select id, name, mode, workspaceId, agentId, intelligencePreference,
        permissionMode, isolationMode, createdAt, updatedAt
      from chat_sessions
      where selected = 1
    `)
      .get() as ChatSession | undefined;
    return row ?? null;
  }

  async appendChatMessage(input: Omit<ChatMessage, 'id'>): Promise<ChatMessage> {
    const result = this.db.prepare(`
      insert into chat_messages (sessionId, sequence, role, content, sourceReferencesJson, routingJson, mode, createdAt)
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.sessionId,
      input.sequence,
      input.role,
      input.content,
      input.sourceReferencesJson,
      input.routingJson ?? null,
      input.mode ?? null,
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
      select id, sessionId, sequence, role, content, sourceReferencesJson, routingJson, mode, createdAt
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
      !existing.has('routingJson') ? 'alter table pending_actions add column routingJson text' : null,
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

  private ensureChatSessionColumns(): void {
    const columns = this.db.prepare('pragma table_info(chat_sessions)').all() as Array<{ name: string }>;
    const existing = new Set(columns.map((column) => column.name));
    const statements = [
      !existing.has('mode') ? "alter table chat_sessions add column mode text not null default 'autopilot'" : null,
      !existing.has('workspaceId') ? 'alter table chat_sessions add column workspaceId text' : null,
      !existing.has('agentId') ? "alter table chat_sessions add column agentId text not null default 'career'" : null,
      !existing.has('intelligencePreference') ? "alter table chat_sessions add column intelligencePreference text not null default 'auto'" : null,
      !existing.has('permissionMode') ? "alter table chat_sessions add column permissionMode text not null default 'interactive'" : null,
      !existing.has('isolationMode') ? "alter table chat_sessions add column isolationMode text not null default 'read_only'" : null,
    ].filter((statement): statement is string => Boolean(statement));
    for (const statement of statements) this.db.exec(statement);
  }

  private ensureChatMessageColumns(): void {
    const columns = this.db.prepare('pragma table_info(chat_messages)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'routingJson')) {
      this.db.exec('alter table chat_messages add column routingJson text');
    }
    if (!columns.some((column) => column.name === 'mode')) {
      this.db.exec('alter table chat_messages add column mode text');
    }
  }
}
