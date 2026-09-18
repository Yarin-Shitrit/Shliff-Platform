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

describe('Table — the additive guarantee', () => {
  /**
   * The net under the concurrent screen lanes: recorded against the
   * implementation as it stood before `totalsLabel` existed, from every prop a
   * screen was able to pass at that point. If a later change alters what those
   * screens render, this fails and nothing else has to notice.
   */
  it('renders the pre-totalsLabel prop set byte for byte', () => {
    const { container } = render(
      <Table
        caption="רשימת אנשים"
        columns={columns}
        rows={[{ id: 'a', data: rows[0].data, group: 'ספטמבר 2026' }, rows[1]]}
        selection={{
          selectedIds: new Set(['b']),
          onToggleRow: vi.fn(),
          onToggleAll: vi.fn(),
          rowCheckboxLabel: (id) => `בחירת ${id}`,
          allCheckboxLabel: 'בחירת כל השורות',
        }}
        rowActions={(p) => <button type="button">{`אפשרויות ל${p.name}`}</button>}
        totals={[
          { key: 'label', content: <><bdi>35</bdi> אנשים</>, colSpan: 3 },
          { key: 'sum', content: <bdi>12,200 ₪</bdi>, numeric: true },
        ]}
        density="compact"
      />,
    );
    expect(container.innerHTML).toMatchInlineSnapshot(`"<div class="_wrap_464089 _compact_464089"><table class="_table_464089"><caption class="sr-only">רשימת אנשים</caption><thead><tr><th scope="col" class="_w0_464089"><input class="_check_464089" aria-label="בחירת כל השורות" aria-checked="mixed" type="checkbox"></th><th scope="col" class="">שם</th><th scope="col" class="">דמי קאמפ</th><th scope="col" class="_numeric_464089 num">יתרה</th><th scope="col" class="_w0_464089"></th></tr></thead><tbody><tr class="_groupRow_464089"><th scope="rowgroup" colspan="5">ספטמבר 2026</th></tr><tr data-tone="default" class=""><td class="_w0_464089"><input class="_check_464089" aria-label="בחירת a" type="checkbox"></td><td class="">רוני אדלר</td><td class="">שולם</td><td class="_numeric_464089 num"><bdi>—</bdi></td><td class="_w0_464089 _actions_464089"><button type="button">אפשרויות לרוני אדלר</button></td></tr><tr data-tone="bad" class="_selected_464089"><td class="_w0_464089"><input class="_check_464089" aria-label="בחירת b" type="checkbox" checked=""></td><td class="">איתי כהן</td><td class="">טרם שילם</td><td class="_numeric_464089 num"><bdi>1,200 ₪</bdi></td><td class="_w0_464089 _actions_464089"><button type="button">אפשרויות לאיתי כהן</button></td></tr></tbody><tfoot><tr><td colspan="3" class=""><bdi>35</bdi> אנשים</td><td class="_numeric_464089 num"><bdi>12,200 ₪</bdi></td></tr></tfoot></table></div>"`);
  });
});

describe('Table — a totals row that can be found (A26)', () => {
  const totals = [
    { key: 'label', content: <><bdi>35</bdi> אנשים</>, colSpan: 2 },
    { key: 'sum', content: <bdi>12,200 ₪</bdi>, numeric: true },
  ];

  it('names the footer, so a totals row can be queried and announced as סיכום', () => {
    render(<Table caption="רשימת אנשים" columns={columns} rows={rows} totals={totals} totalsLabel="סיכום" />);
    const foot = screen.getByRole('rowgroup', { name: 'סיכום' });
    expect(within(foot).getByText('12,200 ₪')).toBeTruthy();
  });

  it('leaves the footer unnamed when no name is given, so no screen gains one it did not ask for', () => {
    render(<Table caption="רשימת אנשים" columns={columns} rows={rows} totals={totals} />);
    expect(screen.queryByRole('rowgroup', { name: 'סיכום' })).toBeNull();
    expect(screen.getAllByRole('rowgroup')).toHaveLength(3);
  });
});
