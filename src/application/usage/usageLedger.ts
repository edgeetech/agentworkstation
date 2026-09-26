/**
 * Privacy-safe, append-only usage ledger records that Taksim imports with
 * `taksim history import --client agentworkstation`. This module only builds
 * and validates records; it never touches the filesystem (see
 * `@infrastructure/usage/JsonlUsageLedger` for the writer) and never routes,
 * prompts, or otherwise changes agent behaviour. See ADR-011.
 *
 * Records must never contain prompt text, replies, file paths, workspace
 * names, or any other user content — only shape, cost, and outcome metadata.
 */

export type UsageLocation = 'local' | 'external' | 'simulated';
export type UsageOutcome = 'answered' | 'failed' | 'cancelled';
export type UsageErrorKind = 'rate_limit' | 'timeout' | 'other' | null;

export type ModelTurnUsageRecord = {
  schemaVersion: 1;
  recordType: 'model_turn';
  id: string;
  occurredAt: string;
  sessionKey: string;
  agentId: string;
  taskKind: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  reportedModel: string | null;
  location: UsageLocation;
  fallback: boolean;
  costUsd: number | null;
  durationMs: number;
  steps: number;
  toolCalls: number;
  outcome: UsageOutcome;
  errorKind: UsageErrorKind;
};

export type ApprovalUsageRecord = {
  schemaVersion: 1;
  recordType: 'approval';
  id: string;
  occurredAt: string;
  sessionKey: string;
  agentId: string;
  decision: 'approved' | 'rejected';
  actionKind: string;
};

export type UsageLedgerRecord = ModelTurnUsageRecord | ApprovalUsageRecord;

/** Infrastructure implements this against the local filesystem; application/domain never touch Node APIs directly. */
export interface UsageLedgerPort {
  append(record: UsageLedgerRecord): Promise<void>;
}

const SESSION_KEY_PATTERN = /^[0-9a-f]{16}$/;
const UUID_PATTERN = /^[0-9a-f-]{8,}$/i;
const LOCATIONS: readonly UsageLocation[] = ['local', 'external', 'simulated'];
const OUTCOMES: readonly UsageOutcome[] = ['answered', 'failed', 'cancelled'];
const ERROR_KINDS: readonly Exclude<UsageErrorKind, null>[] = ['rate_limit', 'timeout', 'other'];

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Usage ledger record requires a non-empty string for "${field}"`);
  }
  return value;
}

function requireSessionKey(value: unknown): string {
  const key = requireNonEmptyString(value, 'sessionKey');
  if (!SESSION_KEY_PATTERN.test(key)) {
    throw new Error('Usage ledger sessionKey must be 16 lowercase hex characters');
  }
  return key;
}

function requireIsoTimestamp(value: unknown): string {
  const raw = requireNonEmptyString(value, 'occurredAt');
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Usage ledger occurredAt must be a valid ISO-8601 timestamp');
  }
  return raw;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Usage ledger record requires a non-negative integer for "${field}"`);
  }
  return value;
}

function requireCostUsd(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Usage ledger costUsd must be a non-negative number or null');
  }
  return value;
}

function requireLocation(value: unknown): UsageLocation {
  if (typeof value !== 'string' || !LOCATIONS.includes(value as UsageLocation)) {
    throw new Error(`Usage ledger location must be one of ${LOCATIONS.join(', ')}`);
  }
  return value as UsageLocation;
}

function requireOutcome(value: unknown): UsageOutcome {
  if (typeof value !== 'string' || !OUTCOMES.includes(value as UsageOutcome)) {
    throw new Error(`Usage ledger outcome must be one of ${OUTCOMES.join(', ')}`);
  }
  return value as UsageOutcome;
}

function requireErrorKind(value: unknown): UsageErrorKind {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !ERROR_KINDS.includes(value as Exclude<UsageErrorKind, null>)) {
    throw new Error(`Usage ledger errorKind must be null or one of ${ERROR_KINDS.join(', ')}`);
  }
  return value as UsageErrorKind;
}

function requireId(value: unknown): string {
  const id = requireNonEmptyString(value, 'id');
  if (!UUID_PATTERN.test(id)) {
    throw new Error('Usage ledger id must look like a UUID');
  }
  return id;
}

/**
 * HTTP 429 responses map to `rate_limit` and the literal string "timeout" in
 * the error message maps to `timeout`; every other error is `other`. Only
 * failed turns carry an errorKind — answered and cancelled turns are null.
 */
export function classifyErrorKind(outcome: UsageOutcome, error: unknown): UsageErrorKind {
  if (outcome !== 'failed' || error === null || error === undefined) return null;
  const message = error instanceof Error ? error.message : String(error);
  if (/\b429\b/.test(message)) return 'rate_limit';
  if (/timeout/i.test(message)) return 'timeout';
  return 'other';
}

export function buildModelTurnRecord(input: {
  id: string;
  occurredAt: string;
  sessionKey: string;
  agentId: string;
  taskKind: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  reportedModel: string | null;
  location: UsageLocation;
  fallback: boolean;
  costUsd: number | null;
  durationMs: number;
  steps: number;
  toolCalls: number;
  outcome: UsageOutcome;
  errorKind: UsageErrorKind;
}): ModelTurnUsageRecord {
  return {
    schemaVersion: 1,
    recordType: 'model_turn',
    id: requireId(input.id),
    occurredAt: requireIsoTimestamp(input.occurredAt),
    sessionKey: requireSessionKey(input.sessionKey),
    agentId: requireNonEmptyString(input.agentId, 'agentId'),
    taskKind: requireNonEmptyString(input.taskKind, 'taskKind'),
    providerId: requireNonEmptyString(input.providerId, 'providerId'),
    providerLabel: requireNonEmptyString(input.providerLabel, 'providerLabel'),
    modelId: requireNonEmptyString(input.modelId, 'modelId'),
    reportedModel: input.reportedModel === null || input.reportedModel === undefined
      ? null
      : requireNonEmptyString(input.reportedModel, 'reportedModel'),
    location: requireLocation(input.location),
    fallback: Boolean(input.fallback),
    costUsd: requireCostUsd(input.costUsd),
    durationMs: requireNonNegativeInteger(Math.round(input.durationMs), 'durationMs'),
    steps: requireNonNegativeInteger(input.steps, 'steps'),
    toolCalls: requireNonNegativeInteger(input.toolCalls, 'toolCalls'),
    outcome: requireOutcome(input.outcome),
    errorKind: requireErrorKind(input.errorKind),
  };
}

export function buildApprovalRecord(input: {
  id: string;
  occurredAt: string;
  sessionKey: string;
  agentId: string;
  decision: 'approved' | 'rejected';
  actionKind: string;
}): ApprovalUsageRecord {
  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    throw new Error('Usage ledger approval decision must be "approved" or "rejected"');
  }
  return {
    schemaVersion: 1,
    recordType: 'approval',
    id: requireId(input.id),
    occurredAt: requireIsoTimestamp(input.occurredAt),
    sessionKey: requireSessionKey(input.sessionKey),
    agentId: requireNonEmptyString(input.agentId, 'agentId'),
    decision: input.decision,
    actionKind: requireNonEmptyString(input.actionKind, 'actionKind'),
  };
}

/** One UTC-month file per the contract: `aw-usage-YYYY-MM.jsonl`. */
export function usageLedgerFileName(occurredAtIso: string): string {
  const date = new Date(occurredAtIso);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Usage ledger occurredAt must be a valid ISO-8601 timestamp');
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `aw-usage-${year}-${month}.jsonl`;
}

/** One JSON object per line, UTF-8, LF — no trailing newline is added here; the writer appends it. */
export function serializeUsageLedgerRecord(record: UsageLedgerRecord): string {
  return JSON.stringify(record);
}
