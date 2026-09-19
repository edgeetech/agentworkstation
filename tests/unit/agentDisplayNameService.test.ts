import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AgentDisplayNameService,
  agentDisplayNameSettingPrefix,
} from '../../src/application/agents/AgentDisplayNameService';
import { SqlitePersistence } from '../../src/infrastructure/persistence/sqlite';

describe('agent display name service', () => {
  it('persists a trimmed override in app settings and restores it after reopening SQLite', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agent-name-')), 'app.db');
    const first = new SqlitePersistence(file);
    const names = new AgentDisplayNameService(first);

    await names.save('career', '  Portfolio Coach  ');
    await expect(first.getSetting(`${agentDisplayNameSettingPrefix}career`)).resolves.toBe('Portfolio Coach');
    first.close();

    const reopened = new SqlitePersistence(file);
    await expect(new AgentDisplayNameService(reopened).resolve('career', 'Career')).resolves.toBe('Portfolio Coach');
    reopened.close();
  });

  it('resets to the packaged name without changing the agent identity', async () => {
    const settings = new Map<string, string>();
    const names = new AgentDisplayNameService({
      async getSetting(key) { return settings.get(key) ?? null; },
      async setSetting(key, value) { settings.set(key, value); },
    });

    await names.save('blogger', 'Writer');
    await expect(names.resolve('blogger', 'Blogger')).resolves.toBe('Writer');
    await names.save('blogger', null);
    await expect(names.resolve('blogger', 'Blogger')).resolves.toBe('Blogger');
  });

  it('rejects invalid names and falls back safely when a stored value is corrupt', async () => {
    const settings = new Map<string, string>([[`${agentDisplayNameSettingPrefix}career`, 'Bad\nName']]);
    const names = new AgentDisplayNameService({
      async getSetting(key) { return settings.get(key) ?? null; },
      async setSetting(key, value) { settings.set(key, value); },
    });

    await expect(names.resolve('career', 'Career')).resolves.toBe('Career');
    await expect(names.save('career', '   ')).rejects.toThrow('required');
    await expect(names.save('career', 'x'.repeat(49))).rejects.toThrow('at most 48');
    await expect(names.save('../career', 'Career')).rejects.toThrow('Invalid agent id');
  });
});
