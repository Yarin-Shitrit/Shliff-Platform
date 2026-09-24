/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AcquisitionRow } from '@/lib/logistics/acquisitions';
import { AcquisitionsTable } from './acquisitions-table';

function row(over: Partial<AcquisitionRow> = {}): AcquisitionRow {
  return {
    seasonId: 's26', id: 'a1', name: 'מקדחה רוטטת', category: 'build', quantityNeeded: 1,
    source: 'buy_new', estimatedAgorot: 40000, actualAgorot: 38000,
    assignee: { id: 'p1', name: 'איתי כהן' }, lender: null,
    budgetLineId: null, arrivedItemId: null, status: 'ordered',
    updatedAt: new Date('2026-09-14T10:00:00Z'), updatedBy: null,
    ...over,
  };
}

const EMPTY = <p>אין פריטים</p>;

function mount(rows: AcquisitionRow[]) {
  return render(
    <AcquisitionsTable
      rows={rows}
      params={{}}
      shownEstimatedAgorot={40000}
      shownActualAgorot={38000}
      empty={EMPTY}
    />,
  );
}

describe('AcquisitionsTable', () => {
  it('names every column in Hebrew and nothing in English', () => {
    mount([row()]);
    const table = screen.getByRole('table');
    for (const header of within(table).getAllByRole('columnheader')) {
      expect(header.textContent ?? '').not.toMatch(/[A-Za-z]/);
    }
  });

  it('says the status in words, never in colour alone', () => {
    mount([row()]);
    expect(screen.getByText('הוזמן')).toBeTruthy();
  });

  it('marks a real amount as hand-entered, because there is no purchase file', () => {
    // R11. The estimate carries no chip: it is a plan, not a figure anyone
    // could have imported.
    mount([row()]);
    expect(screen.getAllByText('נרשם ידנית').length).toBeGreaterThan(0);
  });

  it('gives an unpriced row a dash rather than a zero', () => {
    // A zero would claim the camp expects it to be free. The dash says
    // nobody has priced it.
    mount([row({ estimatedAgorot: null, actualAgorot: null })]);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('names the lender on a borrowed row, because somebody has to get it back', () => {
    mount([row({ source: 'borrow_member', lender: { id: 'p2', name: 'מיכל רוזן' } })]);
    expect(screen.getByText(/מיכל רוזן/)).toBeTruthy();
  });

  it('links a row to its own drawer, so a refresh keeps it open', () => {
    mount([row()]);
    const links = screen.getAllByRole('link');
    expect(links.some((a) => (a.getAttribute('href') ?? '').includes('peek=a1'))).toBe(true);
  });

  it('marks a camp-wide row on the row itself, and no other', () => {
    // R5: a row that belongs to every season says so where it is read, so a
    // lead going through one year's list can tell which lines were written
    // for it and which came along because they always apply.
    mount([row(), row({ id: 'a2', name: 'גנרטור', seasonId: null })]);
    const shared = screen.getByRole('link', { name: 'גנרטור' }).closest('tr');
    const own = screen.getByRole('link', { name: 'מקדחה רוטטת' }).closest('tr');
    expect(within(shared as HTMLElement).getByText('כלל־קאמפי')).toBeTruthy();
    expect(within(own as HTMLElement).queryByText('כלל־קאמפי')).toBeNull();
  });

  it('links the person responsible to their own page', () => {
    mount([row()]);
    const links = screen.getAllByRole('link');
    expect(links.some((a) => a.getAttribute('href') === '/members/p1')).toBe(true);
  });

  it('shows the empty state it was handed rather than an empty grid', () => {
    mount([]);
    expect(screen.getByText('אין פריטים')).toBeTruthy();
  });
});
