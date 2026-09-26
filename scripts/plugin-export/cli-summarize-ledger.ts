import fs from 'node:fs';
import { summarizeLedger } from '../../src/domain/accounting/ledger';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token || !token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const [filePath, ...rest] = process.argv.slice(2);
if (!filePath || filePath.startsWith('--')) {
  fail('Usage: summarize-ledger.mjs <file.csv> [--date-column X] [--amount-column X] [--debit-column X] [--credit-column X] [--group-by X]');
}

const args = parseArgs(rest);

try {
  const text = fs.readFileSync(filePath, 'utf8');
  const summary = summarizeLedger(text, {
    dateColumn: asString(args['date-column']),
    amountColumn: asString(args['amount-column']),
    debitColumn: asString(args['debit-column']),
    creditColumn: asString(args['credit-column']),
    groupBy: asString(args['group-by']),
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
