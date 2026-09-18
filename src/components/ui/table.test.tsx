/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { Table } from './table';
import type { TableColumn, TableRowModel } from './table';

type Person = { name: string; state: string; balance: string };

const columns: ReadonlyArray<TableColumn<Person>> = [
  { key: 'name', header: 'שם', cell: (p) => p.name },
  { key: 'state', header: 'דמי קאמפ', cell: (p) => p.state },
  { key: 'balance', header: 'יתרה', cell: (p) => <bdi>{p.balance}</bdi>, numeric: true },
];

const rows: ReadonlyArray<TableRowModel<Person>> = [
  { id: 'a', data: { name: 'רוני אדלר', state: 'שולם', balance: '—' } },
  { id: 'b', data: { name: 'איתי כהן', state: 'טרם שילם', balance: '1,200 ₪' }, tone: 'bad' },
];

describe('Table', () => {
  it('is named for assistive technology by its caption', () => {
    render(<Table caption="רשימת אנשים" columns={columns} rows={rows} />);
    expect(screen.getByRole('table', { name: 'רשימת אנשים' })).toBeTruthy();
  });

  it('renders one row per model, in the order it was handed them', () => {
    render(<Table caption="רשימת אנשים" columns={columns} rows={rows} />);
    const body = screen.getAllByRole('rowgroup')[1];
    const names = within(body).getAllByRole('row').map((r) => r.textContent ?? '');
    expect(names[0]).toContain('רוני אדלר');
    expect(names[1]).toContain('איתי כהן');
  });

  it('marks a numeric column so place values line up (A10)', () => {
    render(<Table caption="רשימת אנשים" columns={columns} rows={rows} />);
    const header = screen.getByRole('columnheader', { name: 'יתרה' });
    expect(header.className).toContain('numeric');
  });

  it('carries a row tone so a danger row reads as one without relying on colour', () => {
    render(<Table caption="רשימת אנשים" columns={columns} rows={rows} />);
    const body = screen.getAllByRole('rowgroup')[1];
    const [, second] = within(body).getAllByRole('row');
    expect(second.getAttribute('data-tone')).toBe('bad');
  });

  it('emits a group heading row whenever the group changes, and only then', () => {
    const grouped: ReadonlyArray<TableRowModel<Person>> = [
      { id: 'a', data: rows[0].data, group: 'ספטמבר 2026' },
      { id: 'b', data: rows[1].data, group: 'ספטמבר 2026' },
      { id: 'c', data: { name: 'נועה לוי', state: 'שולם', balance: '—' }, group: 'אוגוסט 2026' },
    ];
    render(<Table caption="תנועות" columns={columns} rows={grouped} />);
    expect(screen.getAllByRole('rowheader', { name: 'ספטמבר 2026' })).toHaveLength(1);
    expect(screen.getAllByRole('rowheader', { name: 'אוגוסט 2026' })).toHaveLength(1);
  });

  it('renders a totals row that may span columns', () => {
    render(
      <Table
        caption="רשימת אנשים"
        columns={columns}
        rows={rows}
        totals={[
          { key: 'label', content: <><bdi>35</bdi> אנשים</>, colSpan: 2 },
          { key: 'sum', content: <bdi>12,200 ₪</bdi>, numeric: true },
        ]}
      />,
    );
    const foot = screen.getAllByRole('rowgroup')[2];
    expect(within(foot).getByText('12,200 ₪')).toBeTruthy();
  });

  it('adds a checkbox column when selection is offered and toggles one row', () => {
    const onToggleRow = vi.fn();
    render(
      <Table
        caption="רשימת אנשים"
        columns={columns}
        rows={rows}
        selection={{
          selectedIds: new Set(['b']),
          onToggleRow,
          onToggleAll: vi.fn(),
          rowCheckboxLabel: (id) => (id === 'a' ? 'בחירת רוני אדלר' : 'בחירת איתי כהן'),
          allCheckboxLabel: 'בחירת כל השורות',
        }}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'בחירת רוני אדלר' }));
    expect(onToggleRow).toHaveBeenCalledWith('a');
    expect(
      (screen.getByRole('checkbox', { name: 'בחירת איתי כהן' }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('puts the header checkbox in the mixed state when some but not all are selected', () => {
    render(
      <Table
        caption="רשימת אנשים"
        columns={columns}
        rows={rows}
        selection={{
          selectedIds: new Set(['b']),
          onToggleRow: vi.fn(),
          onToggleAll: vi.fn(),
          rowCheckboxLabel: () => 'בחירה',
          allCheckboxLabel: 'בחירת כל השורות',
        }}
      />,
    );
    expect(
      screen.getByRole('checkbox', { name: 'בחירת כל השורות' }).getAttribute('aria-checked'),
    ).toBe('mixed');
  });

  it('renders the hover action slot inside the row', () => {
    render(
      <Table
        caption="רשימת אנשים"
        columns={columns}
        rows={rows}
        rowActions={(p) => <button type="button">{`אפשרויות ל${p.name}`}</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'אפשרויות לרוני אדלר' })).toBeTruthy();
  });

  it('shows the empty node instead of a body when there are no rows', () => {
    render(
      <Table caption="רשימת אנשים" columns={columns} rows={[]} empty={<p>אין תוצאות לסינון הזה</p>} />,
    );
    expect(screen.getByText('אין תוצאות לסינון הזה')).toBeTruthy();
    expect(screen.queryByText('רוני אדלר')).toBeNull();
  });
});
