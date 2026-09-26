import { describe, expect, it } from 'vitest';
import { deriveDeadlineInput, dueReminders, reminderKey } from '../../src/domain/accounting/reminders';
import type { UkDeadline } from '../../src/domain/accounting/ukDeadlines';

describe('deriveDeadlineInput', () => {
  it('parses a year end given as MM-DD', () => {
    expect(deriveDeadlineInput({ yearEnd: '03-31' }, '2026-09-26')).toMatchObject({ periodEnd: '2026-03-31' });
  });

  it('parses a year end given as YYYY-MM-DD', () => {
    expect(deriveDeadlineInput({ yearEnd: '2026-03-31' }, '2026-09-26')).toMatchObject({ periodEnd: '2026-03-31' });
  });

  it.each([
    ['31 March', '2026-03-31'],
    ['31 Mar', '2026-03-31'],
    ['March 31', '2026-03-31'],
    ['31 Mart', '2026-03-31'],
  ])('parses a year end given as "%s"', (yearEnd, expected) => {
    expect(deriveDeadlineInput({ yearEnd }, '2026-09-26')).toMatchObject({ periodEnd: expected });
  });

  it('rolls the period end back a year when today is before this year\'s date', () => {
    expect(deriveDeadlineInput({ yearEnd: '31 March' }, '2026-02-01')).toMatchObject({ periodEnd: '2025-03-31' });
  });

  it('keeps this year\'s date when today is on or after it', () => {
    expect(deriveDeadlineInput({ yearEnd: '31 March' }, '2026-03-31')).toMatchObject({ periodEnd: '2026-03-31' });
    expect(deriveDeadlineInput({ yearEnd: '31 March' }, '2026-09-26')).toMatchObject({ periodEnd: '2026-03-31' });
  });

  it('uses an explicit numeric VAT stagger', () => {
    expect(deriveDeadlineInput({ yearEnd: '31 March', vatStagger: 2 }, '2026-09-26'))
      .toMatchObject({ periodEnd: '2026-03-31', vatStagger: 2 });
  });

  it('infers the VAT stagger from quarter-end months mentioned in free text', () => {
    const result = deriveDeadlineInput(
      { text: 'Example Ltd, 12345678, year end 31 March, VAT quarters end March June September December, payroll yes' },
      '2026-09-26',
    );
    expect(result).toMatchObject({ periodEnd: '2026-03-31', vatStagger: 1, payroll: true });
  });

  it('infers stagger 2 and 3 from their respective quarter-end months', () => {
    expect(deriveDeadlineInput({ text: 'year end 30 April, VAT quarters end April July October January' }, '2026-09-26'))
      .toMatchObject({ vatStagger: 2 });
    expect(deriveDeadlineInput({ text: 'year end 31 May, VAT quarters end May August November February' }, '2026-09-26'))
      .toMatchObject({ vatStagger: 3 });
  });

  it('does not infer a stagger when VAT registration is explicitly false', () => {
    expect(deriveDeadlineInput({ yearEnd: '31 March', vatRegistered: false, text: 'March June' }, '2026-09-26'))
      .not.toHaveProperty('vatStagger');
  });

  it('reads payroll from a boolean, a yes/no string, or free text', () => {
    expect(deriveDeadlineInput({ yearEnd: '31 March', payroll: true }, '2026-09-26')).toMatchObject({ payroll: true });
    expect(deriveDeadlineInput({ yearEnd: '31 March', payroll: false }, '2026-09-26')).not.toHaveProperty('payroll');
    expect(deriveDeadlineInput({ yearEnd: '31 March', payroll: 'yes' }, '2026-09-26')).toMatchObject({ payroll: true });
    expect(deriveDeadlineInput({ text: 'year end 31 March, bordro var' }, '2026-09-26')).toMatchObject({ payroll: true });
  });

  it('returns null when no year end can be found', () => {
    expect(deriveDeadlineInput({}, '2026-09-26')).toBeNull();
    expect(deriveDeadlineInput({ text: 'no dates here at all' }, '2026-09-26')).toBeNull();
    expect(deriveDeadlineInput(null, '2026-09-26')).toBeNull();
    expect(deriveDeadlineInput('EdgeeTech Ltd', '2026-09-26')).toBeNull();
    expect(deriveDeadlineInput(42, '2026-09-26')).toBeNull();
  });
});

describe('dueReminders', () => {
  const deadline = (overrides: Partial<UkDeadline>): UkDeadline => ({
    id: 'sample',
    title: 'Sample deadline',
    due: '2026-10-01',
    authority: 'HMRC',
    basis: 'test fixture',
    daysUntil: 0,
    status: 'due_soon',
    ...overrides,
  });

  it('includes items due within the window and excludes items outside it', () => {
    const items = [
      deadline({ id: 'soon', daysUntil: 7, status: 'due_soon' }),
      deadline({ id: 'far', daysUntil: 60, status: 'upcoming' }),
    ];
    expect(dueReminders(items, [], '2026-09-26', 14).map((item) => item.id)).toEqual(['soon']);
  });

  it('reports an overdue item once per day while it stays within 30 days late', () => {
    const items = [deadline({ id: 'overdue-recent', daysUntil: -3, status: 'overdue' })];
    expect(dueReminders(items, ['overdue-recent@2026-09-25'], '2026-09-26', 14).map((item) => item.id)).toEqual(['overdue-recent']);
    expect(reminderKey(items[0]!, '2026-09-26')).toBe('overdue-recent@2026-09-26');
    expect(dueReminders(items, ['overdue-recent@2026-09-26'], '2026-09-26', 14)).toEqual([]);
  });

  it('drops overdue items more than 30 days late', () => {
    const items = [deadline({ id: 'overdue-old', daysUntil: -31, status: 'overdue' })];
    expect(dueReminders(items, [], '2026-09-26', 14)).toEqual([]);
  });

  it('de-duplicates upcoming items already notified', () => {
    const items = [deadline({ id: 'soon', daysUntil: 7, status: 'due_soon' })];
    expect(dueReminders(items, ['soon'], '2026-09-26', 14)).toEqual([]);
    expect(dueReminders(items, [], '2026-09-26', 14).map((item) => item.id)).toEqual(['soon']);
  });
});
