import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqlitePersistence } from '../../src/infrastructure/persistence/sqlite';

describe('sqlite persistence', () => {
  it('stores pending actions', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'app.db');
    const db = new SqlitePersistence(file);
    await db.savePendingAction({
      id: '1',
      sessionId: 's',
      createdAt: 'now',
      status: 'PROPOSED',
      expectedOriginalHash: 'a',
      proposedContentHash: 'b',
      targetPath: 'README.md',
      proposedContent: 'x',
      diff: '---',
    });
    await expect(db.getPendingAction('1')).resolves.toMatchObject({ id: '1', targetPath: 'README.md' });
  });

  it('persists multiple workspaces in deterministic order and remembers selection', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'app.db');
    const db = new SqlitePersistence(file);
    await db.saveWorkspace({ id: 'zeta', rootPath: 'C:\\work\\zeta' });
    await db.saveWorkspace({ id: 'Alpha', rootPath: 'C:\\work\\alpha' });
    await db.saveWorkspace({ id: 'alpha', rootPath: 'C:\\work\\alpha-lower' });

    await expect(db.listWorkspaces()).resolves.toEqual([
      { id: 'Alpha', rootPath: 'C:\\work\\alpha' },
      { id: 'alpha', rootPath: 'C:\\work\\alpha-lower' },
      { id: 'zeta', rootPath: 'C:\\work\\zeta' },
    ]);

    await db.selectWorkspace('zeta');
    await expect(db.getSelectedWorkspace()).resolves.toEqual({ id: 'zeta', rootPath: 'C:\\work\\zeta' });

    const reopened = new SqlitePersistence(file);
    await expect(reopened.getSelectedWorkspace()).resolves.toEqual({ id: 'zeta', rootPath: 'C:\\work\\zeta' });
  });

  it('rejects selection of an unknown workspace without clearing the current selection', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'app.db');
    const db = new SqlitePersistence(file);
    await db.saveWorkspace({ id: 'known', rootPath: 'C:\\work\\known' });
    await db.selectWorkspace('known');

    await expect(db.selectWorkspace('missing')).rejects.toThrow('Unknown workspace: missing');
    await expect(db.getSelectedWorkspace()).resolves.toEqual({ id: 'known', rootPath: 'C:\\work\\known' });
  });
});
