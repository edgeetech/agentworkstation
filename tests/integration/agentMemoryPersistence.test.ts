import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqlitePersistence } from '../../src/infrastructure/persistence/sqlite';

const temporaryFiles: string[] = [];

afterEach(() => {
  for (const file of temporaryFiles.splice(0)) fs.rmSync(file, { force: true });
});

describe('agent memory SQLite persistence', () => {
  it('round-trips JSON-compatible values with provenance and confirmation state', async () => {
    const file = path.join(os.tmpdir(), `agent-memory-${crypto.randomUUID()}.db`);
    temporaryFiles.push(file, `${file}-shm`, `${file}-wal`);
    const persistence = new SqlitePersistence(file);
    await persistence.saveMemoryEntry({
      agentId: 'career',
      fieldKey: 'career.sources',
      value: [{ type: 'github', identifier: 'asozyurt' }],
      provenance: { source: 'user_message', questionId: 'choose-career-sources', capturedAt: '2026-09-11T10:00:00.000Z' },
      confidence: 0.98,
      confirmationStatus: 'confirmed',
      confirmedAt: '2026-09-11T10:01:00.000Z',
      updatedAt: '2026-09-11T10:01:00.000Z',
    });

    await expect(persistence.getMemoryEntry('career', 'career.sources')).resolves.toMatchObject({
      value: [{ type: 'github', identifier: 'asozyurt' }],
      provenance: { source: 'user_message', questionId: 'choose-career-sources' },
      confidence: 0.98,
      confirmationStatus: 'confirmed',
    });
    await expect(persistence.getAgentMemory('career')).resolves.toHaveLength(1);
    await expect(persistence.getAgentMemory('blogger')).resolves.toEqual([]);
    await persistence.setActiveOnboardingIntent('career', 'publish');
    await expect(persistence.getActiveOnboardingIntent('career')).resolves.toBe('publish');
    persistence.close();

    const inspection = new DatabaseSync(file, { readOnly: true });
    const stored = inspection.prepare('select rawAnswer from agent_memory where agentId = ?').get('career') as { rawAnswer: string };
    expect(stored.rawAnswer).toBe('');
    inspection.close();

    const reopened = new SqlitePersistence(file);
    await expect(reopened.getMemoryEntry('career', 'career.sources')).resolves.toMatchObject({
      confirmationStatus: 'confirmed',
      value: [{ type: 'github', identifier: 'asozyurt' }],
    });
    await expect(reopened.getActiveOnboardingIntent('career')).resolves.toBe('publish');
    await reopened.setActiveOnboardingIntent('career', null);
    await expect(reopened.getActiveOnboardingIntent('career')).resolves.toBeNull();
    reopened.close();
  });
});
