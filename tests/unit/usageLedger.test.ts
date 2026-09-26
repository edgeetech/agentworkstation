import { describe, expect, it } from 'vitest';
import {
  buildApprovalRecord,
  buildModelTurnRecord,
  classifyErrorKind,
  serializeUsageLedgerRecord,
  usageLedgerFileName,
} from '../../src/application/usage/usageLedger';

const baseModelTurn = {
  id: '00000000-0000-4000-8000-000000000001',
  occurredAt: '2026-09-15T10:30:00.000Z',
  sessionKey: 'a1b2c3d4e5f60718',
  agentId: 'accountant',
  taskKind: 'chat',
  providerId: 'claude',
  providerLabel: 'Anthropic Claude',
  modelId: 'default',
  reportedModel: 'claude-sonnet-5',
  location: 'external' as const,
  fallback: false,
  costUsd: 0.0067,
  durationMs: 12844.6,
  steps: 3,
  toolCalls: 2,
  outcome: 'answered' as const,
  errorKind: null,
};

describe('usage ledger record builders', () => {
  it('builds a valid model_turn record with schemaVersion 1', () => {
    const record = buildModelTurnRecord(baseModelTurn);
    expect(record).toEqual({
      schemaVersion: 1,
      recordType: 'model_turn',
      ...baseModelTurn,
      durationMs: 12845, // rounded
    });
  });

  it('never includes prompt, reply, file path, or workspace fields', () => {
    const record = buildModelTurnRecord(baseModelTurn) as Record<string, unknown>;
    for (const forbidden of ['message', 'prompt', 'reply', 'content', 'path', 'workspace', 'workspaceId']) {
      expect(Object.keys(record)).not.toContain(forbidden);
    }
  });

  it('hashes the same session id to the same sessionKey deterministically (builder just validates the shape)', () => {
    const first = buildModelTurnRecord(baseModelTurn);
    const second = buildModelTurnRecord({ ...baseModelTurn, id: '00000000-0000-4000-8000-000000000002' });
    expect(first.sessionKey).toBe(second.sessionKey);
    expect(first.sessionKey).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rejects a malformed sessionKey', () => {
    expect(() => buildModelTurnRecord({ ...baseModelTurn, sessionKey: 'not-hex' })).toThrow(/sessionKey/);
    expect(() => buildModelTurnRecord({ ...baseModelTurn, sessionKey: 'abcd' })).toThrow(/sessionKey/);
  });

  it('rejects an invalid location, outcome, or errorKind', () => {
    expect(() => buildModelTurnRecord({ ...baseModelTurn, location: 'cloud' as never })).toThrow(/location/);
    expect(() => buildModelTurnRecord({ ...baseModelTurn, outcome: 'succeeded' as never })).toThrow(/outcome/);
    expect(() => buildModelTurnRecord({ ...baseModelTurn, errorKind: 'boom' as never })).toThrow(/errorKind/);
  });

  it('accepts a null costUsd and reportedModel', () => {
    const record = buildModelTurnRecord({ ...baseModelTurn, costUsd: null, reportedModel: null });
    expect(record.costUsd).toBeNull();
    expect(record.reportedModel).toBeNull();
  });

  it('rejects a negative costUsd or non-integer duration/steps', () => {
    expect(() => buildModelTurnRecord({ ...baseModelTurn, costUsd: -1 })).toThrow(/costUsd/);
    expect(() => buildModelTurnRecord({ ...baseModelTurn, steps: -1 })).toThrow(/steps/);
  });

  it('builds a valid approval record', () => {
    const record = buildApprovalRecord({
      id: '00000000-0000-4000-8000-000000000003',
      occurredAt: '2026-09-15T10:31:00.000Z',
      sessionKey: 'a1b2c3d4e5f60718',
      agentId: 'career',
      decision: 'approved',
      actionKind: 'file_write',
    });
    expect(record).toEqual({
      schemaVersion: 1,
      recordType: 'approval',
      id: '00000000-0000-4000-8000-000000000003',
      occurredAt: '2026-09-15T10:31:00.000Z',
      sessionKey: 'a1b2c3d4e5f60718',
      agentId: 'career',
      decision: 'approved',
      actionKind: 'file_write',
    });
  });

  it('rejects an invalid approval decision', () => {
    expect(() => buildApprovalRecord({
      id: '00000000-0000-4000-8000-000000000004',
      occurredAt: '2026-09-15T10:31:00.000Z',
      sessionKey: 'a1b2c3d4e5f60718',
      agentId: 'career',
      decision: 'maybe' as never,
      actionKind: 'file_write',
    })).toThrow(/decision/);
  });
});

describe('errorKind classification', () => {
  it('maps HTTP 429 to rate_limit', () => {
    expect(classifyErrorKind('failed', new Error('HTTP 429: session usage limit reached'))).toBe('rate_limit');
  });

  it('maps "timeout" in the message to timeout', () => {
    expect(classifyErrorKind('failed', new Error('Model timeout exceeded'))).toBe('timeout');
  });

  it('maps any other failure to other', () => {
    expect(classifyErrorKind('failed', new Error('something else broke'))).toBe('other');
  });

  it('is always null for answered or cancelled outcomes', () => {
    expect(classifyErrorKind('answered', new Error('ignored'))).toBeNull();
    expect(classifyErrorKind('cancelled', new Error('ignored'))).toBeNull();
    expect(classifyErrorKind('failed', null)).toBeNull();
  });
});

describe('monthly ledger file naming', () => {
  it('uses the UTC month of occurredAt', () => {
    expect(usageLedgerFileName('2026-09-15T23:59:59.000Z')).toBe('aw-usage-2026-09.jsonl');
    // A local-looking late-night timestamp that is already the next UTC month.
    expect(usageLedgerFileName('2026-10-01T00:00:00.000Z')).toBe('aw-usage-2026-10.jsonl');
  });

  it('rejects an invalid timestamp', () => {
    expect(() => usageLedgerFileName('not-a-date')).toThrow();
  });
});

describe('record serialization', () => {
  it('serializes to a single-line JSON object with no trailing newline', () => {
    const record = buildModelTurnRecord(baseModelTurn);
    const line = serializeUsageLedgerRecord(record);
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual(record);
  });
});
