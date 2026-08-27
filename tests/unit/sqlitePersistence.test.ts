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
      workspaceId: 'project',
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
      { id: 'Alpha', rootPath: 'C:\\work\\alpha', kind: 'project' },
      { id: 'alpha', rootPath: 'C:\\work\\alpha-lower', kind: 'project' },
      { id: 'zeta', rootPath: 'C:\\work\\zeta', kind: 'project' },
    ]);

    await db.selectWorkspace('zeta');
    await expect(db.getSelectedWorkspace()).resolves.toEqual({ id: 'zeta', rootPath: 'C:\\work\\zeta', kind: 'project' });

    const reopened = new SqlitePersistence(file);
    await expect(reopened.getSelectedWorkspace()).resolves.toEqual({ id: 'zeta', rootPath: 'C:\\work\\zeta', kind: 'project' });
  });

  it('rejects selection of an unknown workspace without clearing the current selection', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'app.db');
    const db = new SqlitePersistence(file);
    await db.saveWorkspace({ id: 'known', rootPath: 'C:\\work\\known' });
    await db.selectWorkspace('known');

    await expect(db.selectWorkspace('missing')).rejects.toThrow('Unknown workspace: missing');
    await expect(db.getSelectedWorkspace()).resolves.toEqual({ id: 'known', rootPath: 'C:\\work\\known', kind: 'project' });
  });

  it('re-selects another workspace when removing the selected workspace', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'app.db');
    const db = new SqlitePersistence(file);
    await db.saveWorkspace({ id: 'b', rootPath: 'C:\\work\\b' });
    await db.saveWorkspace({ id: 'a', rootPath: 'C:\\work\\a' });
    await db.selectWorkspace('b');

    await db.removeWorkspace('b');

    await expect(db.getSelectedWorkspace()).resolves.toEqual({ id: 'a', rootPath: 'C:\\work\\a', kind: 'project' });
    await expect(db.listWorkspaces()).resolves.toEqual([{ id: 'a', rootPath: 'C:\\work\\a', kind: 'project' }]);
  });

  it('stores and reads endpoint settings', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'app.db');
    const db = new SqlitePersistence(file);

    await db.setSetting('endpoint', '{"mode":"mock"}');
    await expect(db.getSetting('endpoint')).resolves.toBe('{"mode":"mock"}');
  });

  it('persists chat sessions and ordered chat messages', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'app.db');
    const db = new SqlitePersistence(file);
    const now = new Date().toISOString();

    await db.saveChatSession({ id: 'session-1', name: 'Career Agent Session', createdAt: now, updatedAt: now });
    await db.selectChatSession('session-1');
    await db.appendChatMessage({
      sessionId: 'session-1',
      sequence: 1,
      role: 'user',
      content: 'hello',
      sourceReferencesJson: '[]',
      createdAt: now,
    });
    await db.appendChatMessage({
      sessionId: 'session-1',
      sequence: 2,
      role: 'assistant',
      content: 'hi there',
      sourceReferencesJson: '[{\"type\":\"memory\"}]',
      createdAt: now,
    });

    await expect(db.getSelectedChatSession()).resolves.toMatchObject({ id: 'session-1', name: 'Career Agent Session' });
    await expect(db.listChatSessions()).resolves.toHaveLength(1);
    await expect(db.listChatMessages('session-1')).resolves.toEqual([
      expect.objectContaining({ sequence: 1, role: 'user', content: 'hello' }),
      expect.objectContaining({ sequence: 2, role: 'assistant', content: 'hi there' }),
    ]);
  });
});
