/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { BudgetLineActuals } from '@/lib/money/budget';
import { groupBudgetByCategory, budgetTotals } from '@/lib/money/budget';
import { sourceKey } from '@/lib/money/overview';
import type { SourceCell } from '@/lib/money/trace';
import { BudgetTable } from './budget-table';

function line(overrides: Partial<BudgetLineActuals> = {}): BudgetLineActuals {
  return {
    id: 'b1', label: 'מים וקרח', quantityText: null, quantityNumAgorot: null,
    unitCostAgorot: null, totalAgorot: 620000, rationale: null, category: 'camp',
    arithmeticOff: false, sourceBlockId: null, sourceRow: null,
    spentAgorot: 174000, remainingAgorot: 446000, overAgorot: 0,
    ...overrides,
  };
}

function tableFor(lines: BudgetLineActuals[], sources = new Map<string, SourceCell>()) {
  return render(<BudgetTable groups={groupBudgetByCategory(lines)}
                             totals={budgetTotals(lines)} sources={sources}
                             seasonName="ברן 26" />);
}

describe('BudgetTable', () => {
  it('gives every line a DOM anchor, so /money#budget-<id> lands on it', () => {
    const { container } = tableFor([line({ id: 'b1' })]);
    const row = container.querySelector('#budget-b1');
    expect(row).not.toBeNull();
    expect(row?.tagName).toBe('TR');
  });

  it('heads the planned column בתקציב, because the row now carries three amounts', () => {
    tableFor([line()]);
    expect(screen.getByRole('columnheader', { name: 'בתקציב' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'הוצא עד כה' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'נותר' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'סה״כ' })).toBeNull();
  });

  it('writes a group row per category with its count and its subtotal', () => {
    tableFor([line(), line({ id: 'b2', category: 'dancefloor', totalAgorot: 1200000 })]);
    expect(screen.getByText(/קאמפ · 1 סעיפים · 6,200 ₪/)).toBeTruthy();
    expect(screen.getByText(/רחבה · 1 סעיפים · 12,000 ₪/)).toBeTruthy();
  });

  // `12,000kw`, `מכולה`, `תפריט שלם לשבוע` — the workbook's own words, kept
  // as written. Nothing here parses or reformats them.
  it('prints the quantity exactly as the workbook wrote it', () => {
    tableFor([line({ quantityText: '12,000kw', unitCostAgorot: 750000 })]);
    expect(screen.getByText(/12,000kw/)).toBeTruthy();
  });

  it('prints a non-numeric quantity with no unit price beside it', () => {
    tableFor([line({ quantityText: 'תפריט שלם לשבוע', unitCostAgorot: null })]);
    // The `×` would live in the quantity line beside the text, so the check
    // is on the whole line, not on the `<bdi>` that holds only the words.
    const quantityLine = screen.getByText(/תפריט שלם לשבוע/).parentElement!;
    expect(quantityLine.textContent).not.toContain('×');
  });

  it('says חריגה in words on an overspent line, never a negative remainder', () => {
    tableFor([line({ label: 'מטבח ואוכל', totalAgorot: 840000, spentAgorot: 872000,
                     remainingAgorot: 0, overAgorot: 32000 })]);
    expect(screen.getByText(/חריגה/).textContent).toContain('320');
    expect(screen.queryByText(/-320/)).toBeNull();
  });

  it('flags bad arithmetic inline without hiding the line or its total', () => {
    tableFor([line({ label: 'ביטוח ואישורים', arithmeticOff: true, totalAgorot: 387500 })]);
    const flag = screen.getByText('החשבון לא מסתדר');
    // `Pill` takes no `title`, so the tooltip sits on the wrapper that the
    // pill is placed in — the word is the accessible carrier either way (R3).
    expect(flag.closest('[title]')!.getAttribute('title'))
      .toBe('כמות × מחיר ליחידה אינו שווה לסה״כ');
    // Scoped to the flagged line's own row: the group subtotal and the
    // footer carry 3,875 too, so a document-wide query proves nothing about
    // whether the line itself still shows its total.
    expect(within(flag.closest('tr')!).getByText(/3,875/)).toBeTruthy();
  });

  it('shows each line its source cell, and נרשם ידנית for a line a lead typed', () => {
    const sources = new Map<string, SourceCell>([[sourceKey('budget_lines', 'b1'), {
      blockId: 'bl1', sheetId: 's1', sheetName: 'תקציב 26', filename: 'קופת קאמפ 2026.xlsx',
      sheetRow: 7, reference: 'תקציב 26!C7',
    }]]);
    tableFor([line(), line({ id: 'b2', label: 'סאונד רחבה', category: 'dancefloor' })], sources);
    expect(screen.getByText('תקציב 26!C7')).toBeTruthy();
    expect(screen.getByText('נרשם ידנית')).toBeTruthy();
  });

  it('foots with every line counted and the three totals', () => {
    tableFor([line(), line({ id: 'b2', category: 'dancefloor', totalAgorot: 1200000,
                             spentAgorot: 600000, remainingAgorot: 600000 })]);
    const foot = screen.getByRole('table').querySelector('tfoot')!;
    expect(foot.textContent).toContain('2 סעיפים');
    expect(foot.textContent).toContain('18,200');
    expect(foot.textContent).toContain('7,740');
    expect(foot.textContent).toContain('10,460');
  });

  it('invites an import rather than showing an empty table for a season with no budget', () => {
    tableFor([]);
    // The kit owns this sentence (C10), so the screen supplies the noun and
    // the season and nothing else — eleven lists, one dialect.
    expect(screen.getByText(/אין סעיפי תקציב בברן 26/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('link', { name: 'לדף הייבוא' }).getAttribute('href')).toBe('/upload');
  });

  it('dashes a line nothing has been spent against, rather than a lying zero', () => {
    tableFor([line({ spentAgorot: 0, remainingAgorot: 620000 })]);
    // The footer's own `0 ₪` is a true total and stays; what must not appear
    // is a `0 ₪` in the line's own `הוצא עד כה` cell, where it would read as
    // a recorded figure rather than as nothing recorded.
    const body = screen.getByRole('table').querySelector('tbody')!;
    expect(within(body).queryByText('0 ₪')).toBeNull();
    expect(within(body).getAllByText('—').length).toBeGreaterThan(0);
  });
});
