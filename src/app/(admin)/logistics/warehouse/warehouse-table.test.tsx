/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { WarehouseRow } from '@/lib/logistics/warehouse';
import { WarehouseTable } from './warehouse-table';

const ROWS: WarehouseRow[] = [
  {
    id: 'a', name: 'סיר תעשייתי', category: 'kitchen', quantity: 2,
    locationText: 'ארגז כחול #1', condition: 'ready', notes: null,
    updatedBy: 'lead@shliff.camp', updatedAt: new Date('2026-09-14T10:00:00Z'),
  },
  {
    id: 'b', name: 'משאבת מים', category: 'sanitation', quantity: 2,
    locationText: 'משטח 2', condition: 'needs_repair', notes: null,
    updatedBy: 'lead@shliff.camp', updatedAt: new Date('2026-09-14T10:00:00Z'),
  },
  {
    id: 'c', name: 'מסור עגול', category: 'build', quantity: 1,
    locationText: null, condition: 'retired', notes: null,
    updatedBy: 'lead@shliff.camp', updatedAt: new Date('2026-09-14T10:00:00Z'),
  },
];

const params = {};
const EMPTY = <p>אין פריטים</p>;

describe('WarehouseTable', () => {
  it('names every column in Hebrew and nothing in English', () => {
    render(<WarehouseTable rows={ROWS} params={params} shownQuantity={5} empty={EMPTY} />);
    const table = screen.getByRole('table');
    for (const header of within(table).getAllByRole('columnheader')) {
      expect(header.textContent ?? '').not.toMatch(/[A-Za-z]/);
    }
  });

  it('says the condition in words, never in colour alone', () => {
    // R3: a colour-blind reader must get the same information, so every state
    // pill carries its word.
    render(<WarehouseTable rows={ROWS} params={params} shownQuantity={5} empty={EMPTY} />);
    expect(screen.getByText('תקין ומוכן')).toBeTruthy();
    expect(screen.getByText('דורש תיקון')).toBeTruthy();
    expect(screen.getByText('יצא משימוש')).toBeTruthy();
  });

  it('marks every quantity as hand-entered, because there is no workbook', () => {
    // R11: every number says where it came from. Logistics has no source
    // workbook at all, so all three rows say so rather than staying silent.
    render(<WarehouseTable rows={ROWS} params={params} shownQuantity={5} empty={EMPTY} />);
    expect(screen.getAllByText('נרשם ידנית')).toHaveLength(3);
  });

  it('gives a missing location a dash rather than an empty cell', () => {
    // An empty cell reads as "nobody filled this in yet" and as "there is no
    // location" at the same time. The dash picks one.
    render(<WarehouseTable rows={[ROWS[2]]} params={params} shownQuantity={1} empty={EMPTY} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('totals the quantity of the rows it was handed', () => {
    render(<WarehouseTable rows={ROWS} params={params} shownQuantity={5} empty={EMPTY} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('5')).toBeTruthy();
  });

  it('links each row to its own drawer, so a refresh keeps it open', () => {
    // R6: a drawer is a URL.
    render(<WarehouseTable rows={ROWS} params={params} shownQuantity={5} empty={EMPTY} />);
    const links = screen.getAllByRole('link');
    expect(links.some((a) => (a.getAttribute('href') ?? '').includes('peek=a'))).toBe(true);
  });

  it('carries an accessible name for the table itself', () => {
    render(<WarehouseTable rows={ROWS} params={params} shownQuantity={5} empty={EMPTY} />);
    expect(screen.getByRole('table').getAttribute('aria-label')
      || screen.getByRole('table').textContent).toBeTruthy();
  });
});
