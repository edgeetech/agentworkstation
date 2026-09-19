import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentMemoryEntry, AgentMemoryStore, OnboardingIntent } from '../../src/domain/onboarding';
import { EditableAgentMemoryStore } from '../../src/infrastructure/persistence/EditableAgentMemoryStore';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const entry: AgentMemoryEntry = {
  agentId: 'blogger', fieldKey: 'blogger.voiceSources',
  value: [{ type: 'url', identifier: 'https://example.com/writing' }],
  provenance: { source: 'user_message', questionId: 'choose-writing-sources', capturedAt: '2026-09-16T10:00:00.000Z' },
  confidence: 0.95, confirmationStatus: 'confirmed',
  confirmedAt: '2026-09-16T10:01:00.000Z', updatedAt: '2026-09-16T10:01:00.000Z',
};

function legacy(entries: AgentMemoryEntry[] = []): AgentMemoryStore {
  return {
    getAgentMemory: async (agentId) => entries.filter((value) => value.agentId === agentId),
    getMemoryEntry: async (agentId, fieldKey) => entries.find((value) => value.agentId === agentId && value.fieldKey === fieldKey) ?? null,
    saveMemoryEntry: async () => undefined,
    getActiveOnboardingIntent: async () => null,
    setActiveOnboardingIntent: async (_agentId: string, _intent: OnboardingIntent | null) => undefined,
  };
}

function store(entries: AgentMemoryEntry[] = []): EditableAgentMemoryStore {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentworkstation-memory-'));
  directories.push(directory);
  return new EditableAgentMemoryStore(directory, legacy(entries));
}

describe('editable agent memory', () => {
  it('migrates existing memories to a per-agent JSON file and reloads external edits', async () => {
    const memory = store([entry]);
    await expect(memory.getAgentMemory('blogger')).resolves.toEqual([entry]);
    const file = memory.filePath('blogger');
    const document = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries: AgentMemoryEntry[] };
    document.entries[0].value = [{ type: 'url', identifier: 'https://example.com/new-writing' }];
    fs.writeFileSync(file, JSON.stringify(document, null, 2));
    await expect(memory.getMemoryEntry('blogger', entry.fieldKey)).resolves.toMatchObject({ value: document.entries[0].value });
  });

  it('saves updates atomically without duplicating fields', async () => {
    const memory = store();
    await memory.saveMemoryEntry(entry);
    await memory.saveMemoryEntry({ ...entry, confidence: 0.99 });
    await expect(memory.getAgentMemory('blogger')).resolves.toEqual([{ ...entry, confidence: 0.99 }]);
    expect(fs.readdirSync(path.dirname(memory.filePath('blogger')))).toEqual(['memory.json']);
  });

  it('rejects path traversal and sensitive values in edited JSON', async () => {
    const memory = store();
    expect(() => memory.filePath('../other')).toThrow('Invalid agent ID');
    await memory.getAgentMemory('blogger');
    const file = memory.filePath('blogger');
    fs.writeFileSync(file, JSON.stringify({ version: 1, agentId: 'blogger', entries: [
      { ...entry, value: { apiKey: 'do-not-load' } },
    ] }));
    await expect(memory.getAgentMemory('blogger')).rejects.toThrow('sensitive field');
  });
});
