import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqlitePersistence } from '../../src/infrastructure/persistence/sqlite';

describe('sqlite persistence', () => {
  it('stores pending actions', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'app.db');
    const db = new SqlitePersistence(file);
    await db.savePendingAction({ id: '1', sessionId: 's', createdAt: 'now', expectedOriginalHash: 'a', proposedContentHash: 'b', targetPath: 'README.md', proposedContent: 'x' });
    await expect(db.getPendingAction('1')).resolves.toMatchObject({ id: '1', targetPath: 'README.md' });
  });
});

