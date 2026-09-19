import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentMemoryEntry, AgentMemoryStore, OnboardingIntent } from '@domain/onboarding';

type MemoryDocument = { version: 1; agentId: string; entries: AgentMemoryEntry[] };
const forbiddenKey = /(?:password|secret|credential|private.?key|access.?token|refresh.?token|api.?key)/i;

function assertSafeValue(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error('Agent memory is too deeply nested');
  if (Array.isArray(value)) {
    value.forEach((item) => assertSafeValue(item, depth + 1));
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenKey.test(key)) throw new Error(`Agent memory contains a sensitive field: ${key}`);
      assertSafeValue(nested, depth + 1);
    }
  }
}

function validateDocument(value: unknown, agentId: string): MemoryDocument {
  if (!value || typeof value !== 'object') throw new Error('Agent memory JSON must be an object');
  const document = value as Partial<MemoryDocument>;
  if (document.version !== 1 || document.agentId !== agentId || !Array.isArray(document.entries)) {
    throw new Error('Agent memory JSON has an invalid version, agent ID, or entries list');
  }
  for (const entry of document.entries) {
    if (!entry || entry.agentId !== agentId || typeof entry.fieldKey !== 'string'
      || forbiddenKey.test(entry.fieldKey) || !['pending', 'confirmed', 'rejected'].includes(entry.confirmationStatus)
      || typeof entry.updatedAt !== 'string' || typeof entry.confidence !== 'number'
      || entry.confidence < 0 || entry.confidence > 1) {
      throw new Error('Agent memory JSON contains an invalid entry');
    }
    assertSafeValue(entry.value);
  }
  return document as MemoryDocument;
}

/** JSON is the editable source of truth; existing SQLite memories migrate on first access. */
export class EditableAgentMemoryStore implements AgentMemoryStore {
  constructor(private readonly directory: string, private readonly legacy: AgentMemoryStore) {}

  filePath(agentId: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(agentId)) throw new Error('Invalid agent ID');
    return join(this.directory, agentId, 'memory.json');
  }

  private write(agentId: string, entries: AgentMemoryEntry[]): void {
    const path = this.filePath(agentId);
    const content = `${JSON.stringify({ version: 1, agentId, entries }, null, 2)}\n`;
    if (Buffer.byteLength(content, 'utf8') > 128 * 1024) throw new Error('Agent memory JSON is too large');
    mkdirSync(join(this.directory, agentId), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, path);
  }

  async getAgentMemory(agentId: string): Promise<AgentMemoryEntry[]> {
    const path = this.filePath(agentId);
    if (!existsSync(path)) {
      this.write(agentId, await this.legacy.getAgentMemory(agentId));
    }
    const content = readFileSync(path, 'utf8');
    if (Buffer.byteLength(content, 'utf8') > 128 * 1024) throw new Error('Agent memory JSON is too large');
    return validateDocument(JSON.parse(content) as unknown, agentId).entries;
  }

  async getMemoryEntry(agentId: string, fieldKey: string): Promise<AgentMemoryEntry | null> {
    return (await this.getAgentMemory(agentId)).find((entry) => entry.fieldKey === fieldKey) ?? null;
  }

  async saveMemoryEntry(entry: AgentMemoryEntry): Promise<void> {
    validateDocument({ version: 1, agentId: entry.agentId, entries: [entry] }, entry.agentId);
    const entries = await this.getAgentMemory(entry.agentId);
    this.write(entry.agentId, [...entries.filter((current) => current.fieldKey !== entry.fieldKey), entry]);
  }

  getActiveOnboardingIntent(agentId: string): Promise<OnboardingIntent | null> {
    return this.legacy.getActiveOnboardingIntent(agentId);
  }

  setActiveOnboardingIntent(agentId: string, intent: OnboardingIntent | null): Promise<void> {
    return this.legacy.setActiveOnboardingIntent(agentId, intent);
  }
}
