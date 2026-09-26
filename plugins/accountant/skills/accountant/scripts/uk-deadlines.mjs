var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/domain/accounting/ukDeadlines.ts
function parseYmd(value) {
  const match = DATE.exec(value.trim());
  if (!match) throw new Error(`Expected a date as YYYY-MM-DD, received "${value}"`);
  const ymd = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  if (ymd.m < 1 || ymd.m > 12 || ymd.d < 1 || ymd.d > daysInMonth(ymd.y, ymd.m)) {
    throw new Error(`Not a real calendar date: "${value}"`);
  }
  return ymd;
}
function addMonths(date, months) {
  const index = date.y * 12 + (date.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = index % 12 + 1;
  const monthEnd = date.d === daysInMonth(date.y, date.m);
  return { y, m, d: monthEnd ? daysInMonth(y, m) : Math.min(date.d, daysInMonth(y, m)) };
}
function ukCompanyDeadlines(input) {
  const periodEnd = parseYmd(input.periodEnd);
  const today = parseYmd(input.today);
  const horizon = addMonths(today, input.horizonMonths ?? 15);
  const lookback = addMonths(today, -3);
  const items = [];
  const push = (item) => {
    items.push({ ...item, due: format(item.due) });
  };
  for (const end of [periodEnd, addMonths(periodEnd, 12)]) {
    const label = format(end);
    push({
      id: `ct-payment-${label}`,
      title: `Corporation Tax payment for period ending ${label}`,
      due: addDays(addMonths(end, 9), 1),
      authority: "HMRC",
      basis: "9 months and 1 day after the end of the accounting period"
    });
    push({
      id: `accounts-${label}`,
      title: `Annual accounts to Companies House for period ending ${label}`,
      due: addMonths(end, 9),
      authority: "Companies House",
      basis: "9 months after the accounting reference date (private company, not first accounts)"
    });
    push({
      id: `ct600-${label}`,
      title: `Company Tax Return (CT600) for period ending ${label}`,
      due: addMonths(end, 12),
      authority: "HMRC",
      basis: "12 months after the end of the accounting period"
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
        authority: "HMRC",
        basis: "1 calendar month and 7 days after the VAT period ends (Making Tax Digital)"
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
        authority: "Companies House",
        basis: "Within 14 days after the review period ends"
      });
    }
  }
  if (input.payroll) {
    for (let offset = 0; offset <= (input.horizonMonths ?? 15); offset += 1) {
      const month = addMonths({ y: today.y, m: today.m, d: 1 }, offset);
      if (toEpochDay({ ...month, d: 22 }) < toEpochDay(today)) continue;
      push({
        id: `paye-${format(month).slice(0, 7)}`,
        title: `PAYE and NIC payment for the tax month ending 5 ${monthName(month.m)} ${month.y}`,
        due: { ...month, d: 22 },
        authority: "HMRC",
        basis: "Paid electronically by the 22nd after the tax month ends on the 5th"
      });
      if (toEpochDay({ ...month, d: 19 }) >= toEpochDay(today)) push({
        id: `eps-${format(month).slice(0, 7)}`,
        title: `Employer Payment Summary (if reclaiming statutory pay or no employees paid) for the tax month ending 5 ${monthName(month.m)} ${month.y}`,
        due: { ...month, d: 19 },
        authority: "HMRC",
        basis: "By the 19th after the tax month ends"
      });
    }
    for (const year of [today.y, today.y + 1]) {
      push({
        id: `p11d-${year}`,
        title: `P11D and P11D(b) for the tax year ending 5 April ${year}`,
        due: { y: year, m: 7, d: 6 },
        authority: "HMRC",
        basis: "6 July after the tax year ends"
      });
      push({
        id: `class1a-${year}`,
        title: `Class 1A National Insurance on benefits for the tax year ending 5 April ${year}`,
        due: { y: year, m: 7, d: 22 },
        authority: "HMRC",
        basis: "Paid electronically by 22 July after the tax year ends"
      });
    }
  }
  const todayDay = toEpochDay(today);
  const seen = /* @__PURE__ */ new Set();
  return items.filter((item) => {
    const day = toEpochDay(parseYmd(item.due));
    if (seen.has(item.id) || day < toEpochDay(lookback) || day > toEpochDay(horizon)) return false;
    seen.add(item.id);
    return true;
  }).map((item) => {
    const daysUntil = toEpochDay(parseYmd(item.due)) - todayDay;
    const status = daysUntil < 0 ? "overdue" : daysUntil <= 30 ? "due_soon" : "upcoming";
    return { ...item, daysUntil, status };
  }).sort((left, right) => left.due.localeCompare(right.due) || left.id.localeCompare(right.id));
}
var DATE, daysInMonth, format, toEpochDay, fromEpochDay, addDays, vatQuarterEndMonths, monthName;
var init_ukDeadlines = __esm({
  "src/domain/accounting/ukDeadlines.ts"() {
    "use strict";
    DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
    daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
    format = ({ y, m, d }) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    toEpochDay = ({ y, m, d }) => Math.floor(Date.UTC(y, m - 1, d) / 864e5);
    fromEpochDay = (day) => {
      const date = new Date(day * 864e5);
      return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
    };
    addDays = (date, days) => fromEpochDay(toEpochDay(date) + days);
    vatQuarterEndMonths = {
      1: [3, 6, 9, 12],
      2: [1, 4, 7, 10],
      3: [2, 5, 8, 11]
    };
    monthName = (m) => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1];
  }
});

// scripts/plugin-export/cli-uk-deadlines.ts
var require_cli_uk_deadlines = __commonJS({
  "scripts/plugin-export/cli-uk-deadlines.ts"() {
    init_ukDeadlines();
    function todayIso() {
      const now = /* @__PURE__ */ new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    }
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
    var args = parseArgs(process.argv.slice(2));
    var periodEnd = asString(args["period-end"]);
    if (!periodEnd) fail("Missing required --period-end YYYY-MM-DD");
    var vatStagger;
    var vatStaggerRaw = asString(args["vat-stagger"]);
    if (vatStaggerRaw !== void 0) {
      const parsed = Number(vatStaggerRaw);
      if (parsed !== 1 && parsed !== 2 && parsed !== 3) fail("--vat-stagger must be 1, 2, or 3");
      vatStagger = parsed;
    }
    var confirmationStatementDate = asString(args["confirmation"]);
    var payroll = args["payroll"] === true;
    var horizonMonths;
    var horizonRaw = asString(args["horizon"]);
    if (horizonRaw !== void 0) {
      const parsed = Number(horizonRaw);
      if (!Number.isInteger(parsed) || parsed < 1) fail("--horizon must be a positive integer number of months");
      horizonMonths = parsed;
    }
    var today = asString(args["today"]) ?? todayIso();
    try {
      const deadlines = ukCompanyDeadlines({
        periodEnd,
        vatStagger,
        confirmationStatementDate,
        payroll,
        horizonMonths,
        today
      });
      process.stdout.write(`${JSON.stringify({
        today,
        assumptions: "Private limited company, not large for Corporation Tax instalments, not its first accounts. Weekends and bank holidays do not move HMRC deadlines. Confirm on gov.uk before relying on a date.",
        deadlines
      }, null, 2)}
`);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }
});
export default require_cli_uk_deadlines();
