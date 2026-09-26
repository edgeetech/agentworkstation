import { ukCompanyDeadlines } from '../../src/domain/accounting/ukDeadlines';

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

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

const args = parseArgs(process.argv.slice(2));
const periodEnd = asString(args['period-end']);
if (!periodEnd) fail('Missing required --period-end YYYY-MM-DD');

let vatStagger: 1 | 2 | 3 | undefined;
const vatStaggerRaw = asString(args['vat-stagger']);
if (vatStaggerRaw !== undefined) {
  const parsed = Number(vatStaggerRaw);
  if (parsed !== 1 && parsed !== 2 && parsed !== 3) fail('--vat-stagger must be 1, 2, or 3');
  vatStagger = parsed;
}

const confirmationStatementDate = asString(args['confirmation']);
const payroll = args['payroll'] === true;

let horizonMonths: number | undefined;
const horizonRaw = asString(args['horizon']);
if (horizonRaw !== undefined) {
  const parsed = Number(horizonRaw);
  if (!Number.isInteger(parsed) || parsed < 1) fail('--horizon must be a positive integer number of months');
  horizonMonths = parsed;
}

const today = asString(args['today']) ?? todayIso();

try {
  const deadlines = ukCompanyDeadlines({
    periodEnd,
    vatStagger,
    confirmationStatementDate,
    payroll,
    horizonMonths,
    today,
  });
  process.stdout.write(`${JSON.stringify({
    today,
    assumptions: 'Private limited company, not large for Corporation Tax instalments, not its first accounts. '
      + 'Weekends and bank holidays do not move HMRC deadlines. Confirm on gov.uk before relying on a date.',
    deadlines,
  }, null, 2)}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
