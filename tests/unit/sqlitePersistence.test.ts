import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
      routingJson: '{\"providerId\":\"codex\"}',
    });
    await expect(db.getPendingAction('1')).resolves.toMatchObject({
      id: '1', targetPath: 'README.md', routingJson: '{\"providerId\":\"codex\"}',
    });
  });

  it('persists multiple workspaces in deterministic order and remembers selection', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'app.db');
    const db = new SqlitePersistence(file);
    await db.saveWorkspace({ id: 'zeta', rootPath: 'C:\\work\\zeta' });
    await db.saveWorkspace({ id: 'Alpha', rootPath: 'C:\\work\\alpha' });
    await db.saveWorkspace({ id: 'alpha', rootPath: 'C:\\work\\alpha-lower' });

    await expect(db.listWorkspaces()).resolves.toEqual([
      { id: 'Alpha', rootPath: 'C:\\work\\alpha', kind: 'project', note: '' },
      { id: 'alpha', rootPath: 'C:\\work\\alpha-lower', kind: 'project', note: '' },
      { id: 'zeta', rootPath: 'C:\\work\\zeta', kind: 'project', note: '' },
    ]);

    await db.selectWorkspace('zeta');
    await expect(db.getSelectedWorkspace()).resolves.toEqual({ id: 'zeta', rootPath: 'C:\\work\\zeta', kind: 'project', note: '' });

    const reopened = new SqlitePersistence(file);
    await expect(reopened.getSelectedWorkspace()).resolves.toEqual({ id: 'zeta', rootPath: 'C:\\work\\zeta', kind: 'project', note: '' });
  });

  it('rejects selection of an unknown workspace without clearing the current selection', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'app.db');
    const db = new SqlitePersistence(file);
    await db.saveWorkspace({ id: 'known', rootPath: 'C:\\work\\known' });
    await db.selectWorkspace('known');

    await expect(db.selectWorkspace('missing')).rejects.toThrow('Unknown workspace: missing');
    await expect(db.getSelectedWorkspace()).resolves.toEqual({ id: 'known', rootPath: 'C:\\work\\known', kind: 'project', note: '' });
  });

  it('re-selects another workspace when removing the selected workspace', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'app.db');
    const db = new SqlitePersistence(file);
    await db.saveWorkspace({ id: 'b', rootPath: 'C:\\work\\b' });
    await db.saveWorkspace({ id: 'a', rootPath: 'C:\\work\\a' });
    await db.selectWorkspace('b');

    await db.removeWorkspace('b');

    await expect(db.getSelectedWorkspace()).resolves.toEqual({ id: 'a', rootPath: 'C:\\work\\a', kind: 'project', note: '' });
    await expect(db.listWorkspaces()).resolves.toEqual([{ id: 'a', rootPath: 'C:\\work\\a', kind: 'project', note: '' }]);
  });

  it('gives each specialist its own sources and forgets assignments with the source', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'app.db');
    const db = new SqlitePersistence(file);
    await db.saveWorkspace({ id: 'books', rootPath: 'C:\books', note: 'Payroll and HMRC records' });
    await db.saveWorkspace({ id: 'taksim', rootPath: 'C:\taksim' });
    await db.saveWorkspace({ id: 'site', rootPath: 'https://taksim.dev/pricing' });
    await db.assignSource('accountant', 'books');
    await db.assignSource('siyo', 'taksim');
    await db.assignSource('siyo', 'site');
    await db.assignSource('siyo', 'books');
    await db.assignSource('siyo', 'books');

    await expect(db.listAgentSources('accountant')).resolves.toEqual([{ id: 'books', rootPath: 'C:\books', kind: 'project', note: 'Payroll and HMRC records' }]);
    expect((await db.listAgentSources('siyo')).map((source) => source.id)).toEqual(['books', 'site', 'taksim']);
    await expect(db.listAgentSources('career')).resolves.toEqual([]);

    await db.unassignSource('siyo', 'books');
    expect((await db.listAgentSources('siyo')).map((source) => source.id)).toEqual(['site', 'taksim']);
    await db.setWorkspaceNote('taksim', 'Product repo');
    expect((await db.listAgentSources('siyo')).find((source) => source.id === 'taksim')?.note).toBe('Product repo');

    await db.removeWorkspace('books');
    await expect(db.listAgentSources('accountant')).resolves.toEqual([]);
    expect(await db.listSourceAssignments()).toEqual([{ agentId: 'siyo', workspaceId: 'site' }, { agentId: 'siyo', workspaceId: 'taksim' }]);
  });

  it('applies a one-time source assignment exactly once, so later removals stick', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'app.db');
    const db = new SqlitePersistence(file);
    await db.saveWorkspace({ id: 'books', rootPath: 'C:/books' });
    await db.assignSourcesOnce('sources.assigned', [{ agentId: 'accountant', workspaceId: 'books' }]);
    await db.unassignSource('accountant', 'books');
    await db.assignSourcesOnce('sources.assigned', [{ agentId: 'accountant', workspaceId: 'books' }]);
    await expect(db.listAgentSources('accountant')).resolves.toEqual([]);
    await expect(db.getSetting('sources.assigned')).resolves.toEqual(expect.any(String));
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

    await db.saveChatSession({
      id: 'session-1',
      name: 'Career Agent Session',
      mode: 'autopilot',
      workspaceId: 'profile',
      agentId: 'career',
      intelligencePreference: 'auto',
      permissionMode: 'interactive',
      isolationMode: 'read_only',
      createdAt: now,
      updatedAt: now,
    });
    await db.selectChatSession('session-1');
    await db.appendChatMessage({
      sessionId: 'session-1',
      sequence: 1,
      role: 'user',
      content: 'hello',
      sourceReferencesJson: '[]',
      mode: 'autopilot',
      createdAt: now,
    });
    await db.appendChatMessage({
      sessionId: 'session-1',
      sequence: 2,
      role: 'assistant',
      content: 'hi there',
      sourceReferencesJson: '[{\"type\":\"memory\"}]',
      routingJson: '{\"providerId\":\"ollama\"}',
      createdAt: now,
    });

    await expect(db.getSelectedChatSession()).resolves.toMatchObject({
      id: 'session-1', name: 'Career Agent Session', mode: 'autopilot',
      workspaceId: 'profile', agentId: 'career', intelligencePreference: 'auto',
      permissionMode: 'interactive', isolationMode: 'read_only',
    });
    await expect(db.listChatSessions()).resolves.toHaveLength(1);
    await expect(db.listChatMessages('session-1')).resolves.toEqual([
      expect.objectContaining({ sequence: 1, role: 'user', content: 'hello', mode: 'autopilot' }),
      expect.objectContaining({ sequence: 2, role: 'assistant', content: 'hi there' }),
    ]);
    await expect(db.listChatMessages('session-1')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ sequence: 2, routingJson: '{\"providerId\":\"ollama\"}' }),
    ]));

    await db.deleteChatSession('session-1');
    await expect(db.listChatSessions()).resolves.toEqual([]);
    await expect(db.listChatMessages('session-1')).resolves.toEqual([]);
    await expect(db.getSelectedChatSession()).resolves.toBeNull();
  });

  it('migrates existing chats to an autopilot default and preserves historical messages', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'legacy.db');
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      create table chat_sessions (
        id text primary key,
        name text not null,
        createdAt text not null,
        updatedAt text not null,
        selected integer not null default 0 check (selected in (0, 1))
      );
      insert into chat_sessions (id, name, createdAt, updatedAt, selected)
      values ('legacy-chat', 'Existing chat', 'now', 'now', 1);
      create table chat_messages (
        id integer primary key autoincrement,
        sessionId text not null,
        sequence integer not null,
        role text not null,
        content text not null,
        sourceReferencesJson text not null default '[]',
        createdAt text not null
      );
      insert into chat_messages (sessionId, sequence, role, content, createdAt)
      values ('legacy-chat', 1, 'user', 'Historical prompt', 'now');
    `);
    legacy.close();

    const db = new SqlitePersistence(file);
    await expect(db.getSelectedChatSession()).resolves.toMatchObject({
      id: 'legacy-chat', mode: 'autopilot', workspaceId: null,
      agentId: 'career', intelligencePreference: 'auto',
      permissionMode: 'interactive', isolationMode: 'read_only',
    });
    await expect(db.listChatMessages('legacy-chat')).resolves.toEqual([
      expect.objectContaining({ content: 'Historical prompt', mode: null }),
    ]);
  });
});
