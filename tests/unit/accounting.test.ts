import { describe, expect, it } from 'vitest';
import { addMonths, parseYmd, ukCompanyDeadlines } from '../../src/domain/accounting/ukDeadlines';
import { parseAmount, parseCsv, parseLedgerDate, summarizeLedger } from '../../src/domain/accounting/ledger';

describe('ukCompanyDeadlines', () => {
  const find = (items: ReturnType<typeof ukCompanyDeadlines>, id: string) => items.find((item) => item.id === id);

  it('computes Corporation Tax, accounts, and CT600 dates from a 31 March year end', () => {
    const items = ukCompanyDeadlines({ periodEnd: '2026-03-31', today: '2026-09-26' });
    expect(find(items, 'accounts-2026-03-31')?.due).toBe('2026-12-31');
    expect(find(items, 'ct-payment-2026-03-31')?.due).toBe('2027-01-01');
    expect(find(items, 'ct600-2026-03-31')?.due).toBe('2027-03-31');
    expect(find(items, 'accounts-2026-03-31')).toMatchObject({ authority: 'Companies House', status: 'upcoming', daysUntil: 96 });
  });

  it('keeps month-end dates at month end and handles leap years', () => {
    expect(addMonths(parseYmd('2027-08-31'), 6)).toEqual({ y: 2028, m: 2, d: 29 });
    expect(addMonths(parseYmd('2026-02-28'), 1)).toEqual({ y: 2026, m: 3, d: 31 });
    expect(addMonths(parseYmd('2026-01-15'), 1)).toEqual({ y: 2026, m: 2, d: 15 });
    const items = ukCompanyDeadlines({ periodEnd: '2026-02-28', today: '2026-03-01' });
    expect(find(items, 'accounts-2026-02-28')?.due).toBe('2026-11-30');
  });

  it('lists VAT quarters for the stagger with the one month and seven days rule', () => {
    const items = ukCompanyDeadlines({ periodEnd: '2026-03-31', vatStagger: 1, today: '2026-09-26', horizonMonths: 6 });
    expect(find(items, 'vat-2026-06-30')).toMatchObject({ due: '2026-08-07', status: 'overdue' });
    expect(find(items, 'vat-2026-09-30')).toMatchObject({ due: '2026-11-07', status: 'upcoming' });
    expect(find(items, 'vat-2026-12-31')?.due).toBe('2027-02-07');
  });

  it('adds payroll and confirmation statement dates when asked, sorted by due date', () => {
    const items = ukCompanyDeadlines({
      periodEnd: '2026-03-31', payroll: true, confirmationStatementDate: '2026-10-05', today: '2026-09-26', horizonMonths: 2,
    });
    expect(find(items, 'paye-2026-10')).toMatchObject({ due: '2026-10-22', status: 'due_soon' });
    expect(find(items, 'paye-2026-09')).toBeUndefined();
    expect(find(items, 'confirmation-2026-10-05')?.due).toBe('2026-10-19');
    expect(items.map((item) => item.due)).toEqual([...items.map((item) => item.due)].sort());
  });

  it('rejects impossible dates instead of guessing', () => {
    expect(() => ukCompanyDeadlines({ periodEnd: '2026-02-30', today: '2026-09-26' })).toThrow('Not a real calendar date');
    expect(() => ukCompanyDeadlines({ periodEnd: '31/03/2026', today: '2026-09-26' })).toThrow('YYYY-MM-DD');
  });
});

describe('ledger arithmetic', () => {
  it('parses quoted CSV fields, UK amounts, and UK dates', () => {
    expect(parseCsv('a,b\n"x, y","He said ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'He said "hi"']]);
    expect(parseAmount('£1,234.50')).toBe(1234.5);
    expect(parseAmount('(12.00)')).toBe(-12);
    expect(parseAmount('abc')).toBeNull();
    expect(parseLedgerDate('31/03/2026')).toBe('2026-03-31');
    expect(parseLedgerDate('5 Apr 2026')).toBe('2026-04-05');
    expect(parseLedgerDate('2026-06-30T00:00:00')).toBe('2026-06-30');
  });

  it('summarizes a bank export with separate paid-in and paid-out columns', () => {
    const csv = [
      'Date,Description,Paid out,Paid in,Category',
      '01/06/2026,Client invoice 104,,"4,800.00",Sales',
      '03/06/2026,HMRC VAT,960.00,,Tax',
      '03/06/2026,HMRC VAT,960.00,,Tax',
      '15/07/2026,Accountant fee,250.00,,Professional fees',
      '16/07/2026,Unreadable,n/a,,Other',
    ].join('\n');
    const summary = summarizeLedger(csv);
    expect(summary.usedColumns).toMatchObject({ date: 'Date', debit: 'Paid out', credit: 'Paid in', groupBy: 'Category' });
    expect(summary.totals).toEqual({ inflow: 4800, outflow: 2170, net: 2630 });
    expect(summary.byMonth).toEqual([
      { month: '2026-06', inflow: 4800, outflow: 1920, net: 2880, rows: 3 },
      { month: '2026-07', inflow: 0, outflow: 250, net: -250, rows: 1 },
    ]);
    expect(summary.byGroup[0]).toEqual({ group: 'Sales', net: 4800, rows: 1 });
    expect(summary.possibleDuplicates).toEqual([{ rows: [3, 4], date: '2026-06-03', amount: -960, description: 'hmrc vat' }]);
    expect(summary.unparsedRows).toEqual([6]);
    expect(summary.firstDate).toBe('2026-06-01');
    expect(summary.lastDate).toBe('2026-07-15');
  });

  it('uses a signed amount column and explains unknown columns', () => {
    const csv = 'Date,Account,Amount\n2026-04-01,Sales,100\n2026-04-02,Rent,-40.5\n';
    expect(summarizeLedger(csv).totals).toEqual({ inflow: 100, outflow: 40.5, net: 59.5 });
    expect(() => summarizeLedger(csv, { groupBy: 'Contact' })).toThrow('Column "Contact" is not in this file');
    expect(() => summarizeLedger('Date,Note\n2026-01-01,hi')).toThrow('No amount, debit, or credit column');
  });
});

describe('accounting tools', () => {
  it('returns deadlines with the reference date and a GOV.UK source', async () => {
    const { createUkDeadlinesTool } = await import('../../src/infrastructure/accounting/accountingTools');
    const tool = createUkDeadlinesTool(() => '2026-09-26');
    const result = await tool.execute(tool.inputSchema.parse({ periodEnd: '2026-03-31' }), { workspaceId: '', signal: new AbortController().signal });
    expect(result.output).toMatchObject({ today: '2026-09-26' });
    expect(result.sourceReferences[0]).toMatchObject({ type: 'web' });
    expect(() => tool.inputSchema.parse({ periodEnd: '31 March' })).toThrow();
  });

  it('summarizes only CSV files read through the workspace gateway', async () => {
    const { ledgerSummaryTool } = await import('../../src/infrastructure/accounting/accountingTools');
    const gateway = {
      readFile: async () => ({ content: 'Date,Amount\n2026-04-01,10\n2026-04-02,-4\n', source: 'x' }),
    } as never;
    const context = { workspaceId: 'books', signal: new AbortController().signal, workspaceGateway: gateway };
    const result = await ledgerSummaryTool.execute({ workspaceId: 'books', relativePath: 'bank/april.csv' }, context);
    expect(result.output).toMatchObject({ totals: { inflow: 10, outflow: 4, net: 6 } });
    expect(result.sourceReferences).toEqual([{ type: 'file', workspaceId: 'books', relativePath: 'bank/april.csv' }]);
    await expect(ledgerSummaryTool.execute({ workspaceId: 'books', relativePath: 'secrets.env' }, context)).rejects.toThrow('Only CSV');
  });
});
