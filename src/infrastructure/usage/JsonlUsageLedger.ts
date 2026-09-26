import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
// A relative path is required here (not the `@application/*` alias): this is a runtime
// value import and the build has no bundler-alias resolution step, only a tsconfig
// `paths` entry used for type-checking. Every other infra file crossing into
// application/domain does so with `import type` only, which is erased at build time.
import {
  serializeUsageLedgerRecord,
  usageLedgerFileName,
  type UsageLedgerPort,
  type UsageLedgerRecord,
} from '../../application/usage/usageLedger';

/** First 16 hex characters of sha256(sessionId) — stable, but never reversible to the chat session id. */
export function hashSessionKey(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
}

/**
 * Appends one JSON object per line to `<usageDir>/aw-usage-YYYY-MM.jsonl` (UTC month of
 * `record.occurredAt`), creating the directory and file as needed. This is observation
 * only: a write failure must never interrupt the chat path, so every error is logged to
 * stderr and swallowed.
 */
export class JsonlUsageLedger implements UsageLedgerPort {
  constructor(private readonly usageDir: string) {}

  async append(record: UsageLedgerRecord): Promise<void> {
    try {
      await fs.mkdir(this.usageDir, { recursive: true });
      const filePath = path.join(this.usageDir, usageLedgerFileName(record.occurredAt));
      await fs.appendFile(filePath, `${serializeUsageLedgerRecord(record)}\n`, 'utf8');
    } catch (error) {
      process.stderr.write(`[usage-ledger] failed to append record: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}
