import { z } from 'zod';
import type { AgentTool, ToolResult } from '@application/tools';
import { ukCompanyDeadlines } from '../../domain/accounting/ukDeadlines';
import { summarizeLedger } from '../../domain/accounting/ledger';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

type DeadlineInput = {
  periodEnd: string;
  vatStagger?: 1 | 2 | 3;
  confirmationStatementDate?: string;
  payroll?: boolean;
  horizonMonths?: number;
};

export function createUkDeadlinesTool(today: () => string = todayIso): AgentTool<DeadlineInput, ToolResult> {
  return {
    id: 'accounting.ukDeadlines',
    description: 'Calculate exact statutory filing and payment dates for a UK private limited company (Corporation Tax, '
      + 'Companies House accounts, CT600, VAT quarters, confirmation statement, PAYE, P11D). Always use this instead of '
      + 'calculating dates yourself.',
    inputSchema: z.object({
      periodEnd: isoDate,
      vatStagger: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      confirmationStatementDate: isoDate.optional(),
      payroll: z.boolean().optional(),
      horizonMonths: z.number().int().min(1).max(24).optional(),
    }),
    inputJsonSchema: {
      type: 'object',
      properties: {
        periodEnd: { type: 'string', description: 'Last day of the accounting period, YYYY-MM-DD' },
        vatStagger: { type: 'integer', enum: [1, 2, 3], description: '1: quarters end Mar/Jun/Sep/Dec, 2: Apr/Jul/Oct/Jan, 3: May/Aug/Nov/Feb' },
        confirmationStatementDate: { type: 'string', description: 'Confirmation statement review date, YYYY-MM-DD' },
        payroll: { type: 'boolean', description: 'Include PAYE, EPS, and P11D dates' },
        horizonMonths: { type: 'integer', minimum: 1, maximum: 24 },
      },
      required: ['periodEnd'],
      additionalProperties: false,
    },
    metadata: { readOnly: true, sideEffect: 'none', sensitive: false },
    async execute(input): Promise<ToolResult> {
      const reference = today();
      return {
        output: {
          today: reference,
          assumptions: 'Private limited company, not large for Corporation Tax instalments, not its first accounts. '
            + 'Weekends and bank holidays do not move HMRC deadlines. Confirm on gov.uk before relying on a date.',
          deadlines: ukCompanyDeadlines({ ...input, today: reference }),
        },
        sourceReferences: [{ type: 'web', url: 'https://www.gov.uk/running-a-limited-company', label: 'GOV.UK limited company deadlines' }],
      };
    },
  };
}

type LedgerInput = {
  workspaceId: string;
  relativePath: string;
  dateColumn?: string;
  amountColumn?: string;
  debitColumn?: string;
  creditColumn?: string;
  groupBy?: string;
};

export const ledgerSummaryTool: AgentTool<LedgerInput, ToolResult> = {
  id: 'accounting.summarizeLedger',
  description: 'Total a bookkeeping CSV export from a workspace (bank statement, general ledger, account transactions): '
    + 'inflow, outflow, net, per-month and per-account totals, possible duplicate rows, and rows that could not be read. '
    + 'Always use this for sums instead of adding numbers yourself.',
  inputSchema: z.object({
    workspaceId: z.string().min(1),
    relativePath: z.string().min(1),
    dateColumn: z.string().optional(),
    amountColumn: z.string().optional(),
    debitColumn: z.string().optional(),
    creditColumn: z.string().optional(),
    groupBy: z.string().optional(),
  }),
  inputJsonSchema: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string' },
      relativePath: { type: 'string', description: 'Path of the CSV file inside the workspace' },
      dateColumn: { type: 'string' },
      amountColumn: { type: 'string', description: 'Signed amount column, when the file has one' },
      debitColumn: { type: 'string', description: 'Money-out column, when amounts are split' },
      creditColumn: { type: 'string', description: 'Money-in column, when amounts are split' },
      groupBy: { type: 'string', description: 'Column to total by, such as Account or Category' },
    },
    required: ['workspaceId', 'relativePath'],
    additionalProperties: false,
  },
  metadata: { readOnly: true, sideEffect: 'none', sensitive: true, requiresWorkspace: true },
  async execute(input, context): Promise<ToolResult> {
    if (!context.workspaceGateway) throw new Error('Workspace gateway unavailable');
    if (!/\.(csv|txt)$/i.test(input.relativePath)) throw new Error('Only CSV exports can be summarized.');
    const file = await context.workspaceGateway.readFile(input.workspaceId, input.relativePath);
    const { workspaceId: _workspace, relativePath: _path, ...options } = input;
    return {
      output: summarizeLedger(file.content, options),
      sourceReferences: [{ type: 'file', workspaceId: input.workspaceId, relativePath: input.relativePath }],
    };
  },
};
