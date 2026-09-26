/**
 * Turns whatever onboarding extracted into the Accountant's memory into deadline
 * calculator input, and picks which computed deadlines are worth a notification.
 * Pure and deterministic: no model call, no clock reads (the caller passes `today`).
 */

import type { UkDeadline } from './ukDeadlines';

export type DeadlineDerivedInput = {
  periodEnd: string;
  vatStagger?: 1 | 2 | 3;
  payroll?: boolean;
};

type YMD = { y: number; m: number; d: number };

const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1, ocak: 1,
  february: 2, feb: 2, şubat: 2, subat: 2,
  march: 3, mar: 3, mart: 3,
  april: 4, apr: 4, nisan: 4,
  may: 5, mayıs: 5, mayis: 5,
  june: 6, jun: 6, haziran: 6,
  july: 7, jul: 7, temmuz: 7,
  august: 8, aug: 8, ağustos: 8, agustos: 8,
  september: 9, sep: 9, sept: 9, eylül: 9, eylul: 9,
  october: 10, oct: 10, ekim: 10,
  november: 11, nov: 11, kasım: 11, kasim: 11,
  december: 12, dec: 12, aralık: 12, aralik: 12,
};

const MONTH_PATTERN = Object.keys(MONTH_NAMES).sort((a, b) => b.length - a.length).join('|');

const STAGGER_BY_MONTH: Record<number, 1 | 2 | 3> = {
  3: 1, 6: 1, 9: 1, 12: 1,
  4: 2, 7: 2, 10: 2, 1: 2,
  5: 3, 8: 3, 11: 3, 2: 3,
};

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
const toEpochDay = ({ y, m, d }: YMD): number => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
const format = ({ y, m, d }: YMD): string => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function isValidMonthDay(month: number, day: number): boolean {
  // 2024 is a leap year, so 29 February is accepted regardless of which year the
  // deadline eventually lands in.
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(2024, month);
}

function extractMonthDayFromText(text: string): { month: number; day: number } | null {
  const dayThenMonth = new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_PATTERN})\\b`, 'iu');
  const monthThenDay = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})\\b`, 'iu');
  const dayMatch = dayThenMonth.exec(text);
  if (dayMatch) {
    const month = MONTH_NAMES[dayMatch[2].toLowerCase()]!;
    const day = Number(dayMatch[1]);
    if (isValidMonthDay(month, day)) return { month, day };
  }
  const monthMatch = monthThenDay.exec(text);
  if (monthMatch) {
    const month = MONTH_NAMES[monthMatch[1].toLowerCase()]!;
    const day = Number(monthMatch[2]);
    if (isValidMonthDay(month, day)) return { month, day };
  }
  return null;
}

function parseYearEnd(value: string): { month: number; day: number } | null {
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    return isValidMonthDay(month, day) ? { month, day } : null;
  }
  const monthDayMatch = /^(\d{2})-(\d{2})$/.exec(trimmed);
  if (monthDayMatch) {
    const month = Number(monthDayMatch[1]);
    const day = Number(monthDayMatch[2]);
    return isValidMonthDay(month, day) ? { month, day } : null;
  }
  return extractMonthDayFromText(trimmed);
}

/** The most recent occurrence of month/day on or before `today`, as YYYY-MM-DD. */
function mostRecentPeriodEnd(monthDay: { month: number; day: number }, today: YMD): string {
  const clampedDay = (year: number): number => Math.min(monthDay.day, daysInMonth(year, monthDay.month));
  const candidate: YMD = { y: today.y, m: monthDay.month, d: clampedDay(today.y) };
  const year = toEpochDay(candidate) > toEpochDay(today) ? today.y - 1 : today.y;
  return format({ y: year, m: monthDay.month, d: clampedDay(year) });
}

function monthNameStaggerTally(text: string): Map<1 | 2 | 3, number> {
  const tally = new Map<1 | 2 | 3, number>();
  const monthRegex = new RegExp(`\\b(${MONTH_PATTERN})\\b`, 'giu');
  for (const match of text.matchAll(monthRegex)) {
    const month = MONTH_NAMES[match[1]!.toLowerCase()];
    if (!month) continue;
    const stagger = STAGGER_BY_MONTH[month];
    tally.set(stagger, (tally.get(stagger) ?? 0) + 1);
  }
  return tally;
}

function inferVatStagger(record: Record<string, unknown>, searchText: string): 1 | 2 | 3 | undefined {
  const explicit = record.vatStagger;
  if (explicit === 1 || explicit === 2 || explicit === 3) return explicit;
  if (typeof explicit === 'string' && /^[123]$/.test(explicit.trim())) return Number(explicit.trim()) as 1 | 2 | 3;
  if (record.vatRegistered === false) return undefined;
  const tally = monthNameStaggerTally(searchText);
  if (tally.size === 0) return undefined;
  return [...tally.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]![0];
}

function inferPayroll(record: Record<string, unknown>, searchText: string): boolean | undefined {
  if (typeof record.payroll === 'boolean') return record.payroll;
  if (typeof record.payroll === 'string') {
    const normalized = record.payroll.trim().toLowerCase();
    if (['yes', 'true', 'var', 'evet'].includes(normalized)) return true;
    if (['no', 'false', 'yok', 'hayır', 'hayir'].includes(normalized)) return false;
  }
  if (/\bpayroll\s+yes\b/iu.test(searchText) || /\bbordro\b/iu.test(searchText)) return true;
  return undefined;
}

/**
 * Reads the Accountant's confirmed `accountant.company` memory value (structured
 * object from onboarding extraction, or a `{ text }` deterministic fallback) and
 * turns it into deadline calculator input. Returns null when no year end is found.
 */
export function deriveDeadlineInput(companyMemory: unknown, today: string): DeadlineDerivedInput | null {
  if (!companyMemory || typeof companyMemory !== 'object') return null;
  const record = companyMemory as Record<string, unknown>;
  const todayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today.trim());
  if (!todayMatch) return null;
  const todayYmd: YMD = { y: Number(todayMatch[1]), m: Number(todayMatch[2]), d: Number(todayMatch[3]) };

  const searchText = typeof record.text === 'string' ? record.text : JSON.stringify(record);
  const monthDay = (typeof record.yearEnd === 'string' ? parseYearEnd(record.yearEnd) : null)
    ?? extractMonthDayFromText(searchText);
  if (!monthDay) return null;

  const periodEnd = mostRecentPeriodEnd(monthDay, todayYmd);
  const vatStagger = inferVatStagger(record, searchText);
  const payroll = inferPayroll(record, searchText);

  return {
    periodEnd,
    ...(vatStagger ? { vatStagger } : {}),
    ...(payroll ? { payroll } : {}),
  };
}

/**
 * Overdue items stay urgent until 30 days past due, regardless of prior
 * notifications (an unresolved filing should keep nagging). Upcoming items inside
 * the window are reported once each, tracked by `alreadyNotified`.
 */
/** Due-soon items notify once; overdue items notify once per day until 30 days late. */
export function reminderKey(item: UkDeadline, today: string): string {
  return item.status === 'overdue' ? `${item.id}@${today}` : item.id;
}

export function dueReminders(deadlines: UkDeadline[], alreadyNotified: string[], today: string, windowDays = 14): UkDeadline[] {
  const notified = new Set(alreadyNotified);
  return deadlines.filter((item) => {
    if (notified.has(reminderKey(item, today))) return false;
    if (item.status === 'overdue') return item.daysUntil >= -30;
    return item.daysUntil >= 0 && item.daysUntil <= windowDays;
  });
}
