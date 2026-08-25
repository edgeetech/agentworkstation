import Database from 'better-sqlite3';
import type { PersistencePort } from '@application/ports';
import type { PendingAction } from '@domain/actions';

export class SqlitePersistence implements PersistencePort {
  private readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.exec('create table if not exists pending_actions (id text primary key, sessionId text, createdAt text, expectedOriginalHash text, proposedContentHash text, targetPath text, proposedContent text)');
  }

  async savePendingAction(action: PendingAction): Promise<void> {
    const stmt = this.db.prepare('insert or replace into pending_actions values (?, ?, ?, ?, ?, ?, ?)');
    stmt.run(action.id, action.sessionId, action.createdAt, action.expectedOriginalHash, action.proposedContentHash, action.targetPath, action.proposedContent);
  }

  async getPendingAction(id: string): Promise<PendingAction | null> {
    const row = this.db.prepare('select * from pending_actions where id = ?').get(id) as PendingAction | undefined;
    return row ?? null;
  }
}

