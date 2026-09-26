/**
 * Statutory filing and payment dates for a UK private limited company that is not
 * "large" for Corporation Tax instalments. Pure calendar arithmetic: callers pass
 * dates as YYYY-MM-DD and receive the same, so no timezone can shift a deadline.
 */

export type UkDeadlineInput = {
  /** Last day of the accounting period, e.g. 2026-03-31. */
  periodEnd: string;
  /** VAT stagger: 1 = quarters ending Mar/Jun/Sep/Dec, 2 = Apr/Jul/Oct/Jan, 3 = May/Aug/Nov/Feb. */
  vatStagger?: 1 | 2 | 3;
  /** Confirmation statement review date (the "made up to" date). */
  confirmationStatementDate?: string;
  /** Include monthly PAYE, EPS, and annual P11D dates. */
  payroll?: boolean;
  /** Reference date for status and the reporting window. */
  today: string;
  /** How far ahead to list, in months. */
  horizonMonths?: number;
};

export type UkDeadline = {
  id: string;
  title: string;
  due: string;
  authority: 'HMRC' | 'Companies House';
  basis: string;
  daysUntil: number;
  status: 'overdue' | 'due_soon' | 'upcoming';
};

type YMD = { y: number; m: number; d: number };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseYmd(value: string): YMD {
  const match = DATE.exec(value.trim());
  if (!match) throw new Error(`Expected a date as YYYY-MM-DD, received "${value}"`);
  const ymd = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  if (ymd.m < 1 || ymd.m > 12 || ymd.d < 1 || ymd.d > daysInMonth(ymd.y, ymd.m)) {
    throw new Error(`Not a real calendar date: "${value}"`);
  }
  return ymd;
}

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
const format = ({ y, m, d }: YMD): string => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const toEpochDay = ({ y, m, d }: YMD): number => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
const fromEpochDay = (day: number): YMD => {
  const date = new Date(day * 86_400_000);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
};

/** Adds calendar months; a month-end date stays a month-end date (the Companies House rule). */
export function addMonths(date: YMD, months: number): YMD {
  const index = date.y * 12 + (date.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const monthEnd = date.d === daysInMonth(date.y, date.m);
  return { y, m, d: monthEnd ? daysInMonth(y, m) : Math.min(date.d, daysInMonth(y, m)) };
}

export const addDays = (date: YMD, days: number): YMD => fromEpochDay(toEpochDay(date) + days);

const vatQuarterEndMonths: Record<1 | 2 | 3, number[]> = {
  1: [3, 6, 9, 12],
  2: [1, 4, 7, 10],
  3: [2, 5, 8, 11],
};

export function ukCompanyDeadlines(input: UkDeadlineInput): UkDeadline[] {
  const periodEnd = parseYmd(input.periodEnd);
  const today = parseYmd(input.today);
  const horizon = addMonths(today, input.horizonMonths ?? 15);
  const lookback = addMonths(today, -3);
  const items: Array<Omit<UkDeadline, 'daysUntil' | 'status'>> = [];
  const push = (item: Omit<UkDeadline, 'daysUntil' | 'status' | 'due'> & { due: YMD }): void => {
    items.push({ ...item, due: format(item.due) });
  };

  // Current period plus the next one, so a user near year end still sees what follows.
  for (const end of [periodEnd, addMonths(periodEnd, 12)]) {
    const label = format(end);
    push({
      id: `ct-payment-${label}`,
      title: `Corporation Tax payment for period ending ${label}`,
      due: addDays(addMonths(end, 9), 1),
      authority: 'HMRC',
      basis: '9 months and 1 day after the end of the accounting period',
    });
    push({
      id: `accounts-${label}`,
      title: `Annual accounts to Companies House for period ending ${label}`,
      due: addMonths(end, 9),
      authority: 'Companies House',
      basis: '9 months after the accounting reference date (private company, not first accounts)',
    });
    push({
      id: `ct600-${label}`,
      title: `Company Tax Return (CT600) for period ending ${label}`,
      due: addMonths(end, 12),
      authority: 'HMRC',
      basis: '12 months after the end of the accounting period',
    });
  }

  if (input.vatStagger) {
    const months = vatQuarterEndMonths[input.vatStagger];
    for (let offset = -6; offset <= (input.horizonMonths ?? 15); offset += 1) {
      const month = addMonths({ y: today.y, m: today.m, d: 1 }, offset);
      if (!months.includes(month.m)) continue;
      const quarterEnd = { ...month, d: daysInMonth(month.y, month.m) };
      push({
        id: `vat-${format(quarterEnd)}`,
        title: `VAT return and payment for quarter ending ${format(quarterEnd)}`,
        due: addDays(addMonths(quarterEnd, 1), 7),
        authority: 'HMRC',
        basis: '1 calendar month and 7 days after the VAT period ends (Making Tax Digital)',
      });
    }
  }

  if (input.confirmationStatementDate) {
    const reviewDate = parseYmd(input.confirmationStatementDate);
    for (const review of [reviewDate, addMonths(reviewDate, 12)]) {
      push({
        id: `confirmation-${format(review)}`,
        title: `Confirmation statement made up to ${format(review)}`,
        due: addDays(review, 14),
        authority: 'Companies House',
        basis: 'Within 14 days after the review period ends',
      });
    }
  }

  if (input.payroll) {
    // Monthly payroll dates already passed are routine and assumed handled; listing
    // them as overdue buries the items that matter.
    for (let offset = 0; offset <= (input.horizonMonths ?? 15); offset += 1) {
      const month = addMonths({ y: today.y, m: today.m, d: 1 }, offset);
      if (toEpochDay({ ...month, d: 22 }) < toEpochDay(today)) continue;
      push({
        id: `paye-${format(month).slice(0, 7)}`,
        title: `PAYE and NIC payment for the tax month ending 5 ${monthName(month.m)} ${month.y}`,
        due: { ...month, d: 22 },
        authority: 'HMRC',
        basis: 'Paid electronically by the 22nd after the tax month ends on the 5th',
      });
      if (toEpochDay({ ...month, d: 19 }) >= toEpochDay(today)) push({
        id: `eps-${format(month).slice(0, 7)}`,
        title: `Employer Payment Summary (if reclaiming statutory pay or no employees paid) for the tax month ending 5 ${monthName(month.m)} ${month.y}`,
        due: { ...month, d: 19 },
        authority: 'HMRC',
        basis: 'By the 19th after the tax month ends',
      });
    }
    for (const year of [today.y, today.y + 1]) {
      push({
        id: `p11d-${year}`,
        title: `P11D and P11D(b) for the tax year ending 5 April ${year}`,
        due: { y: year, m: 7, d: 6 },
        authority: 'HMRC',
        basis: '6 July after the tax year ends',
      });
      push({
        id: `class1a-${year}`,
        title: `Class 1A National Insurance on benefits for the tax year ending 5 April ${year}`,
        due: { y: year, m: 7, d: 22 },
        authority: 'HMRC',
        basis: 'Paid electronically by 22 July after the tax year ends',
      });
    }
  }

  const todayDay = toEpochDay(today);
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const day = toEpochDay(parseYmd(item.due));
      if (seen.has(item.id) || day < toEpochDay(lookback) || day > toEpochDay(horizon)) return false;
      seen.add(item.id);
      return true;
    })
    .map((item) => {
      const daysUntil = toEpochDay(parseYmd(item.due)) - todayDay;
      const status: UkDeadline['status'] = daysUntil < 0 ? 'overdue' : daysUntil <= 30 ? 'due_soon' : 'upcoming';
      return { ...item, daysUntil, status };
    })
    .sort((left, right) => left.due.localeCompare(right.due) || left.id.localeCompare(right.id));
}

const monthName = (m: number): string =>
  ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]!;
