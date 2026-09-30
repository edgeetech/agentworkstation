var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/domain/accounting/ledger.ts
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}
function parseAmount(value) {
  if (value === void 0) return null;
  let text = value.trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[£$€\s,]/g, "");
  if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  if (!/^[-+]?\d*\.?\d+$/.test(text)) return null;
  const amount = Number(text);
  return negative ? -amount : amount;
}
function parseLedgerDate(value) {
  if (!value) return null;
  const text = value.trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  match = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(text);
  if (match) {
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[2].toLowerCase());
    if (month >= 0) return `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  return null;
}
function summarizeLedger(text, options = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("The file needs a header row and at least one data row.");
  const headers = rows[0].map((header) => header.trim());
  const dateIndex = findColumn(headers, options.dateColumn, [/^date$/i, /date/i]);
  const debitIndex = findColumn(headers, options.debitColumn, [/^debit/i, /^paid out/i, /^money out/i, /^spent/i]);
  const creditIndex = findColumn(headers, options.creditColumn, [/^credit/i, /^paid in/i, /^money in/i, /^received/i]);
  const amountIndex = options.amountColumn || debitIndex < 0 && creditIndex < 0 ? findColumn(headers, options.amountColumn, [/^amount$/i, /^net$/i, /^gross$/i, /amount/i, /^value$/i, /^total$/i]) : -1;
  if (amountIndex < 0 && debitIndex < 0 && creditIndex < 0) {
    throw new Error(`No amount, debit, or credit column found. Columns: ${headers.join(", ")}`);
  }
  const groupIndex = options.groupBy ? findColumn(headers, options.groupBy, []) : findColumn(headers, void 0, [/^account$/i, /^account name$/i, /^category$/i, /^type$/i]);
  const descriptionIndex = findColumn(headers, options.descriptionColumn, [/^description$/i, /^narrative$/i, /^reference$/i, /^payee$/i, /^details$/i, /description|narrative|payee|memo/i]);
  let inflow = 0;
  let outflow = 0;
  const months = /* @__PURE__ */ new Map();
  const groups = /* @__PURE__ */ new Map();
  const fingerprints = /* @__PURE__ */ new Map();
  const unparsedRows = [];
  let firstDate = null;
  let lastDate = null;
  rows.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2;
    let amount;
    if (amountIndex >= 0) {
      amount = parseAmount(row[amountIndex]);
    } else {
      const debit = debitIndex >= 0 ? parseAmount(row[debitIndex]) : null;
      const credit = creditIndex >= 0 ? parseAmount(row[creditIndex]) : null;
      amount = debit === null && credit === null ? null : (credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (amount === null) {
      unparsedRows.push(rowNumber);
      return;
    }
    const date = dateIndex >= 0 ? parseLedgerDate(row[dateIndex]) : null;
    if (date) {
      if (!firstDate || date < firstDate) firstDate = date;
      if (!lastDate || date > lastDate) lastDate = date;
    }
    if (amount >= 0) inflow += amount;
    else outflow += -amount;
    const month = date?.slice(0, 7) ?? "undated";
    const bucket = months.get(month) ?? { inflow: 0, outflow: 0, rows: 0 };
    if (amount >= 0) bucket.inflow += amount;
    else bucket.outflow += -amount;
    bucket.rows += 1;
    months.set(month, bucket);
    if (groupIndex >= 0) {
      const key = row[groupIndex]?.trim() || "(blank)";
      const group = groups.get(key) ?? { net: 0, rows: 0 };
      group.net += amount;
      group.rows += 1;
      groups.set(key, group);
    }
    const description = descriptionIndex >= 0 ? row[descriptionIndex]?.trim() ?? "" : "";
    const fingerprint = `${date ?? ""}|${amount.toFixed(2)}|${description.toLowerCase()}`;
    fingerprints.set(fingerprint, [...fingerprints.get(fingerprint) ?? [], rowNumber]);
  });
  return {
    columns: headers,
    rowCount: rows.length - 1,
    usedColumns: {
      ...dateIndex >= 0 ? { date: headers[dateIndex] } : {},
      ...amountIndex >= 0 ? { amount: headers[amountIndex] } : {},
      ...amountIndex < 0 && debitIndex >= 0 ? { debit: headers[debitIndex] } : {},
      ...amountIndex < 0 && creditIndex >= 0 ? { credit: headers[creditIndex] } : {},
      ...groupIndex >= 0 ? { groupBy: headers[groupIndex] } : {},
      ...descriptionIndex >= 0 ? { description: headers[descriptionIndex] } : {}
    },
    firstDate,
    lastDate,
    totals: { inflow: round(inflow), outflow: round(outflow), net: round(inflow - outflow) },
    byMonth: [...months.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, value]) => ({
      month,
      inflow: round(value.inflow),
      outflow: round(value.outflow),
      net: round(value.inflow - value.outflow),
      rows: value.rows
    })),
    byGroup: [...groups.entries()].map(([group, value]) => ({ group, net: round(value.net), rows: value.rows })).sort((left, right) => Math.abs(right.net) - Math.abs(left.net)).slice(0, 40),
    possibleDuplicates: [...fingerprints.entries()].filter(([, rowNumbers]) => rowNumbers.length > 1).slice(0, 25).map(([fingerprint, rowNumbers]) => {
      const [date, amount, description] = fingerprint.split("|");
      return { rows: rowNumbers, date: date || null, amount: Number(amount), description: description ?? "" };
    }),
    unparsedRows: unparsedRows.slice(0, 50)
  };
}
var round, findColumn;
var init_ledger = __esm({
  "src/domain/accounting/ledger.ts"() {
    "use strict";
    round = (value) => Math.round(value * 100) / 100;
    findColumn = (headers, explicit, patterns) => {
      if (explicit) {
        const index = headers.findIndex((header) => header.trim().toLowerCase() === explicit.trim().toLowerCase());
        if (index < 0) throw new Error(`Column "${explicit}" is not in this file. Columns: ${headers.join(", ")}`);
        return index;
      }
      for (const pattern of patterns) {
        const index = headers.findIndex((header) => pattern.test(header.trim()));
        if (index >= 0) return index;
      }
      return -1;
    };
  }
});

// scripts/plugin-export/cli-summarize-ledger.ts
import fs from "node:fs";
var require_cli_summarize_ledger = __commonJS({
  "scripts/plugin-export/cli-summarize-ledger.ts"() {
    init_ledger();
    function parseArgs(argv) {
      const args2 = {};
      for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token || !token.startsWith("--")) continue;
        const key = token.slice(2);
        const next = argv[index + 1];
        if (next === void 0 || next.startsWith("--")) {
          args2[key] = true;
        } else {
          args2[key] = next;
          index += 1;
        }
      }
      return args2;
    }
    function fail(message) {
      process.stderr.write(`${message}
`);
      process.exit(1);
    }
    function asString(value) {
      return typeof value === "string" ? value : void 0;
    }
    var [filePath, ...rest] = process.argv.slice(2);
    if (!filePath || filePath.startsWith("--")) {
      fail("Usage: summarize-ledger.mjs <file.csv> [--date-column X] [--amount-column X] [--debit-column X] [--credit-column X] [--group-by X]");
    }
    var args = parseArgs(rest);
    try {
      const text = fs.readFileSync(filePath, "utf8");
      const summary = summarizeLedger(text, {
        dateColumn: asString(args["date-column"]),
        amountColumn: asString(args["amount-column"]),
        debitColumn: asString(args["debit-column"]),
        creditColumn: asString(args["credit-column"]),
        groupBy: asString(args["group-by"])
      });
      process.stdout.write(`${JSON.stringify(summary, null, 2)}
`);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }
});
export default require_cli_summarize_ledger();
