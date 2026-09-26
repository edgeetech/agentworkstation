/**
 * Deterministic arithmetic over bookkeeping CSV exports (bank statements, Xero
 * general ledger, account transactions). Models narrate; this code does the sums.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

/** Parses "£1,234.50", "(12.00)", "-3.2", "1.234,50" is not supported (UK exports use dot decimals). */
export function parseAmount(value: string | undefined): number | null {
  if (value === undefined) return null;
  let text = value.trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  text = text.replace(/[£$€\s,]/g, '');
  if (text.endsWith('-')) { negative = !negative; text = text.slice(0, -1); }
  if (!/^[-+]?\d*\.?\d+$/.test(text)) return null;
  const amount = Number(text);
  return negative ? -amount : amount;
}

/** Accepts ISO dates and UK day-first dates (31/03/2026, 31-03-26, 31 Mar 2026). */
export function parseLedgerDate(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (match) {
    const year = match[3]!.length === 2 ? `20${match[3]}` : match[3]!;
    return `${year}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}`;
  }
  match = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(text);
  if (match) {
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(match[2]!.toLowerCase());
    if (month >= 0) return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1]!.padStart(2, '0')}`;
  }
  return null;
}

export type LedgerSummaryOptions = {
  dateColumn?: string;
  amountColumn?: string;
  debitColumn?: string;
  creditColumn?: string;
  groupBy?: string;
  descriptionColumn?: string;
};

export type LedgerSummary = {
  columns: string[];
  rowCount: number;
  usedColumns: { date?: string; amount?: string; debit?: string; credit?: string; groupBy?: string; description?: string };
  firstDate: string | null;
  lastDate: string | null;
  totals: { inflow: number; outflow: number; net: number };
  byMonth: Array<{ month: string; inflow: number; outflow: number; net: number; rows: number }>;
  byGroup: Array<{ group: string; net: number; rows: number }>;
  possibleDuplicates: Array<{ rows: number[]; date: string | null; amount: number; description: string }>;
  unparsedRows: number[];
};

const round = (value: number): number => Math.round(value * 100) / 100;

const findColumn = (headers: string[], explicit: string | undefined, patterns: RegExp[]): number => {
  if (explicit) {
    const index = headers.findIndex((header) => header.trim().toLowerCase() === explicit.trim().toLowerCase());
    if (index < 0) throw new Error(`Column "${explicit}" is not in this file. Columns: ${headers.join(', ')}`);
    return index;
  }
  for (const pattern of patterns) {
    const index = headers.findIndex((header) => pattern.test(header.trim()));
    if (index >= 0) return index;
  }
  return -1;
};

export function summarizeLedger(text: string, options: LedgerSummaryOptions = {}): LedgerSummary {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The file needs a header row and at least one data row.');
  const headers = rows[0]!.map((header) => header.trim());
  const dateIndex = findColumn(headers, options.dateColumn, [/^date$/i, /date/i]);
  const debitIndex = findColumn(headers, options.debitColumn, [/^debit/i, /^paid out/i, /^money out/i, /^spent/i]);
  const creditIndex = findColumn(headers, options.creditColumn, [/^credit/i, /^paid in/i, /^money in/i, /^received/i]);
  const amountIndex = options.amountColumn || (debitIndex < 0 && creditIndex < 0)
    ? findColumn(headers, options.amountColumn, [/^amount$/i, /^net$/i, /^gross$/i, /amount/i, /^value$/i, /^total$/i])
    : -1;
  if (amountIndex < 0 && debitIndex < 0 && creditIndex < 0) {
    throw new Error(`No amount, debit, or credit column found. Columns: ${headers.join(', ')}`);
  }
  const groupIndex = options.groupBy ? findColumn(headers, options.groupBy, []) : findColumn(headers, undefined, [/^account$/i, /^account name$/i, /^category$/i, /^type$/i]);
  const descriptionIndex = findColumn(headers, options.descriptionColumn, [/^description$/i, /^narrative$/i, /^reference$/i, /^payee$/i, /^details$/i, /description|narrative|payee|memo/i]);

  let inflow = 0;
  let outflow = 0;
  const months = new Map<string, { inflow: number; outflow: number; rows: number }>();
  const groups = new Map<string, { net: number; rows: number }>();
  const fingerprints = new Map<string, number[]>();
  const unparsedRows: number[] = [];
  let firstDate: string | null = null;
  let lastDate: string | null = null;

  rows.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2;
    let amount: number | null;
    if (amountIndex >= 0) {
      amount = parseAmount(row[amountIndex]);
    } else {
      const debit = debitIndex >= 0 ? parseAmount(row[debitIndex]) : null;
      const credit = creditIndex >= 0 ? parseAmount(row[creditIndex]) : null;
      amount = debit === null && credit === null ? null : (credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (amount === null) { unparsedRows.push(rowNumber); return; }
    const date = dateIndex >= 0 ? parseLedgerDate(row[dateIndex]) : null;
    if (date) {
      if (!firstDate || date < firstDate) firstDate = date;
      if (!lastDate || date > lastDate) lastDate = date;
    }
    if (amount >= 0) inflow += amount; else outflow += -amount;
    const month = date?.slice(0, 7) ?? 'undated';
    const bucket = months.get(month) ?? { inflow: 0, outflow: 0, rows: 0 };
    if (amount >= 0) bucket.inflow += amount; else bucket.outflow += -amount;
    bucket.rows += 1;
    months.set(month, bucket);
    if (groupIndex >= 0) {
      const key = row[groupIndex]?.trim() || '(blank)';
      const group = groups.get(key) ?? { net: 0, rows: 0 };
      group.net += amount;
      group.rows += 1;
      groups.set(key, group);
    }
    const description = descriptionIndex >= 0 ? row[descriptionIndex]?.trim() ?? '' : '';
    const fingerprint = `${date ?? ''}|${amount.toFixed(2)}|${description.toLowerCase()}`;
    fingerprints.set(fingerprint, [...(fingerprints.get(fingerprint) ?? []), rowNumber]);
  });

  return {
    columns: headers,
    rowCount: rows.length - 1,
    usedColumns: {
      ...(dateIndex >= 0 ? { date: headers[dateIndex] } : {}),
      ...(amountIndex >= 0 ? { amount: headers[amountIndex] } : {}),
      ...(amountIndex < 0 && debitIndex >= 0 ? { debit: headers[debitIndex] } : {}),
      ...(amountIndex < 0 && creditIndex >= 0 ? { credit: headers[creditIndex] } : {}),
      ...(groupIndex >= 0 ? { groupBy: headers[groupIndex] } : {}),
      ...(descriptionIndex >= 0 ? { description: headers[descriptionIndex] } : {}),
    },
    firstDate,
    lastDate,
    totals: { inflow: round(inflow), outflow: round(outflow), net: round(inflow - outflow) },
    byMonth: [...months.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, value]) => ({
        month, inflow: round(value.inflow), outflow: round(value.outflow), net: round(value.inflow - value.outflow), rows: value.rows,
      })),
    byGroup: [...groups.entries()]
      .map(([group, value]) => ({ group, net: round(value.net), rows: value.rows }))
      .sort((left, right) => Math.abs(right.net) - Math.abs(left.net))
      .slice(0, 40),
    possibleDuplicates: [...fingerprints.entries()]
      .filter(([, rowNumbers]) => rowNumbers.length > 1)
      .slice(0, 25)
      .map(([fingerprint, rowNumbers]) => {
        const [date, amount, description] = fingerprint.split('|');
        return { rows: rowNumbers, date: date || null, amount: Number(amount), description: description ?? '' };
      }),
    unparsedRows: unparsedRows.slice(0, 50),
  };
}
