import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApprovalRecord, buildModelTurnRecord } from '../../src/application/usage/usageLedger';
import { JsonlUsageLedger, hashSessionKey } from '../../src/infrastructure/usage/JsonlUsageLedger';

const temporaryRoots: string[] = [];

function createTemporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-usage-ledger-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('hashSessionKey', () => {
  it('derives the same 16 hex character key from the same session id', () => {
    const first = hashSessionKey('chat-session-123');
    const second = hashSessionKey('chat-session-123');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
  });

  it('derives different keys for different session ids', () => {
    expect(hashSessionKey('chat-session-123')).not.toBe(hashSessionKey('chat-session-456'));
  });

  it('never contains the original session id', () => {
    const sessionId = 'session-with-a-recognizable-name';
    expect(hashSessionKey(sessionId)).not.toContain(sessionId);
  });
});

describe('JsonlUsageLedger', () => {
  it('creates the usage directory and appends one JSON object per line', async () => {
    const usageDir = path.join(createTemporaryRoot(), 'usage');
    const ledger = new JsonlUsageLedger(usageDir);

    const first = buildModelTurnRecord({
      id: '00000000-0000-4000-8000-000000000001',
      occurredAt: '2026-09-15T10:30:00.000Z',
      sessionKey: hashSessionKey('session-a'),
      agentId: 'accountant',
      taskKind: 'chat',
      providerId: 'claude',
      providerLabel: 'Anthropic Claude',
      modelId: 'default',
      reportedModel: 'claude-sonnet-5',
      location: 'external',
      fallback: false,
      costUsd: 0.0067,
      durationMs: 12844,
      steps: 3,
      toolCalls: 2,
      outcome: 'answered',
      errorKind: null,
    });
    const second = buildApprovalRecord({
      id: '00000000-0000-4000-8000-000000000002',
      occurredAt: '2026-09-15T10:31:00.000Z',
      sessionKey: hashSessionKey('session-a'),
      agentId: 'career',
      decision: 'approved',
      actionKind: 'file_write',
    });

    await ledger.append(first);
    await ledger.append(second);

    const filePath = path.join(usageDir, 'aw-usage-2026-09.jsonl');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(first);
    expect(JSON.parse(lines[1])).toEqual(second);
  });

  it('names the file after the UTC month of occurredAt, one file per month', async () => {
    const usageDir = path.join(createTemporaryRoot(), 'usage');
    const ledger = new JsonlUsageLedger(usageDir);

    await ledger.append(buildApprovalRecord({
      id: '00000000-0000-4000-8000-000000000003',
      occurredAt: '2026-09-30T23:59:59.000Z',
      sessionKey: hashSessionKey('session-b'),
      agentId: 'career',
      decision: 'rejected',
      actionKind: 'file_write',
    }));
    await ledger.append(buildApprovalRecord({
      id: '00000000-0000-4000-8000-000000000004',
      occurredAt: '2026-10-01T00:00:01.000Z',
      sessionKey: hashSessionKey('session-b'),
      agentId: 'career',
      decision: 'approved',
      actionKind: 'file_write',
    }));

    expect(fs.readdirSync(usageDir).sort()).toEqual(['aw-usage-2026-09.jsonl', 'aw-usage-2026-10.jsonl']);
  });

  it('never throws when the target directory cannot be created', async () => {
    // A file (not a directory) at the usage path makes mkdir fail; append must swallow the error.
    const root = createTemporaryRoot();
    const blockingFile = path.join(root, 'usage');
    fs.writeFileSync(blockingFile, 'not a directory');
    const ledger = new JsonlUsageLedger(blockingFile);

    await expect(ledger.append(buildApprovalRecord({
      id: '00000000-0000-4000-8000-000000000005',
      occurredAt: '2026-09-15T10:30:00.000Z',
      sessionKey: hashSessionKey('session-c'),
      agentId: 'career',
      decision: 'approved',
      actionKind: 'file_write',
    }))).resolves.toBeUndefined();
  });
});
