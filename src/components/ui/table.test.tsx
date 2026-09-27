/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Table } from './table';
import type { TableColumn, TableRowModel } from './table';

type Person = { name: string; state: string; balance: string };

const columns: ReadonlyArray<TableColumn<Person>> = [
  { key: 'name', header: 'שם', card: 'title', cell: (p) => p.name },
  { key: 'state', header: 'דמי קאמפ', card: 'meta', cell: (p) => p.state },
  { key: 'balance', header: 'יתרה', card: 'figure', cell: (p) => <bdi>{p.balance}</bdi>, numeric: true },
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
   *
   * It fired once, deliberately, for plan 12's card reflow, and the snapshot
   * below was re-recorded only after the change was **proved** additive: with
   * the new `role`, `data-label` and `data-card` attributes stripped back out,
   * the markup equals the previous snapshot byte for byte. No element, class,
   * attribute or text node was removed or altered — the reflow adds and
   * nothing else.
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
    expect(container.innerHTML).toMatchInlineSnapshot(`"<div class="_wrap_464089 _compact_464089"><table role="table" class="_table_464089"><caption class="sr-only">רשימת אנשים</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col" class="_w0_464089"><input class="_check_464089" aria-label="בחירת כל השורות" aria-checked="mixed" type="checkbox"></th><th role="columnheader" scope="col" class="">שם</th><th role="columnheader" scope="col" class="">דמי קאמפ</th><th role="columnheader" scope="col" class="_numeric_464089 num">יתרה</th><th role="columnheader" scope="col" class="_w0_464089"></th></tr></thead><tbody role="rowgroup"><tr role="row" class="_groupRow_464089"><th role="rowheader" scope="rowgroup" colspan="5">ספטמבר 2026</th></tr><tr role="row" data-tone="default" class=""><td role="cell" data-card="select" class="_w0_464089"><input class="_check_464089" aria-label="בחירת a" type="checkbox"></td><td role="cell" data-label="שם" data-card="title" class="">רוני אדלר</td><td role="cell" data-label="דמי קאמפ" data-card="meta" class="">שולם</td><td role="cell" data-label="יתרה" data-card="figure" class="_numeric_464089 num"><bdi>—</bdi></td><td role="cell" data-card="action" class="_w0_464089 _actions_464089"><button type="button">אפשרויות לרוני אדלר</button></td></tr><tr role="row" data-tone="bad" class="_selected_464089"><td role="cell" data-card="select" class="_w0_464089"><input class="_check_464089" aria-label="בחירת b" type="checkbox" checked=""></td><td role="cell" data-label="שם" data-card="title" class="">איתי כהן</td><td role="cell" data-label="דמי קאמפ" data-card="meta" class="">טרם שילם</td><td role="cell" data-label="יתרה" data-card="figure" class="_numeric_464089 num"><bdi>1,200 ₪</bdi></td><td role="cell" data-card="action" class="_w0_464089 _actions_464089"><button type="button">אפשרויות לאיתי כהן</button></td></tr></tbody><tfoot><tr><td colspan="3" class=""><bdi>35</bdi> אנשים</td><td class="_numeric_464089 num"><bdi>12,200 ₪</bdi></td></tr></tfoot></table></div>"`);
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

describe('Table — the action column has a name too', () => {
  const rowActions = (p: Person) => <button type="button">{`אפשרויות ל${p.name}`}</button>;

  /**
   * A `srHeader` for the column `Table` generates itself. An ordinary column
   * whose header renders empty already has one; the action column had no way
   * to be named at all, so it read as a blank column header.
   */
  it('names the action column for assistive technology without drawing a heading', () => {
    render(
      <Table
        caption="רשימת אנשים"
        columns={columns}
        rows={rows}
        rowActions={rowActions}
        rowActionsHeader="פעולות"
      />,
    );
    const header = screen.getByRole('columnheader', { name: 'פעולות' });
    expect(header.textContent).toBe('פעולות');
    expect(header.querySelector('.sr-only')).not.toBeNull();
  });

  it('leaves that header blank when no name is given', () => {
    render(<Table caption="רשימת אנשים" columns={columns} rows={rows} rowActions={rowActions} />);
    expect(screen.queryByRole('columnheader', { name: 'פעולות' })).toBeNull();
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(4);
    expect(headers[3].textContent).toBe('');
  });
});

/**
 * jsdom applies no CSS Module, so what this asserts is the marker the
 * stylesheet keys its `opacity: 1` on — the same contract the card-reflow
 * tests below settle for. The visible result was checked by hand in a real
 * browser: before the marker, the ledger's repair control measured
 * `opacity: 0` on a row nobody was hovering.
 */
describe('Table — an action slot that is not hidden behind a hover', () => {
  const rowActions = (p: Person) => <button type="button">{`שיוך ${p.name}`}</button>;

  it('marks every action cell visible when asked to', () => {
    const { container } = render(
      <Table caption="רשימת אנשים" columns={columns} rows={rows} rowActions={rowActions} rowActionsVisible />,
    );
    const cells = container.querySelectorAll('td[data-card="action"]');
    expect(cells.length).toBe(rows.length);
    cells.forEach((cell) => { expect(cell.className).toMatch(/visible/); });
  });

  it('leaves the slot hover-revealed by default', () => {
    const { container } = render(
      <Table caption="רשימת אנשים" columns={columns} rows={rows} rowActions={rowActions} />,
    );
    const cell = container.querySelector('td[data-card="action"]')!;
    expect(cell.className).not.toMatch(/visible/);
  });
});

/**
 * The card reflow (plan 12, Task 2). Below 767.98px the same `<table>` becomes
 * a list of cards: every column keeps its cell and the card role only decides
 * where in the card it lands. There is no `'hidden'` role, deliberately — the
 * phone sees every column the laptop sees, rearranged.
 *
 * jsdom applies no CSS Module, so what these assert is the *contract that
 * makes the reflow possible* — the labels, the roles and the clipped header —
 * and not the reflow itself. That gap is closed by hand under the plan's
 * Definition of done, and no assertion here claims more than it proves.
 */
describe('Table, once it has to fit a phone', () => {
  it('gives every cell the name of its column, so a card can label it', () => {
    const { container } = render(<Table caption="רשימת אנשים" columns={columns} rows={rows} />);
    const labels = Array.from(container.querySelectorAll('tbody td'))
      .slice(0, 3)
      .map((td) => td.getAttribute('data-label'));
    expect(labels).toEqual(['שם', 'דמי קאמפ', 'יתרה']);
  });

  it('records where each cell lands in the card', () => {
    const { container } = render(<Table caption="רשימת אנשים" columns={columns} rows={rows} />);
    const cards = Array.from(container.querySelectorAll('tbody td'))
      .slice(0, 3)
      .map((td) => td.getAttribute('data-card'));
    expect(cards).toEqual(['title', 'meta', 'figure']);
  });

  it('labels the columns Table generates for itself, which have no descriptor', () => {
    const { container } = render(
      <Table
        caption="רשימת אנשים"
        columns={columns}
        rows={rows}
        selection={{
          selectedIds: new Set<string>(),
          onToggleRow: () => {},
          onToggleAll: () => {},
          rowCheckboxLabel: () => 'בחירת שורה',
          allCheckboxLabel: 'בחירת כל השורות',
        }}
        rowActions={() => <button type="button">עריכה</button>}
        rowActionsHeader="פעולות"
      />,
    );
    const first = container.querySelectorAll('tbody tr')[0];
    const cells = Array.from(first.querySelectorAll('td'));
    expect(cells[0].getAttribute('data-card')).toBe('select');
    expect(cells[cells.length - 1].getAttribute('data-card')).toBe('action');
    expect(cells[cells.length - 1].getAttribute('data-label')).toBe('פעולות');
  });

  it('reasserts the table roles a block layout would otherwise drop', () => {
    const { container } = render(<Table caption="רשימת אנשים" columns={columns} rows={rows} />);
    expect(container.querySelector('table')?.getAttribute('role')).toBe('table');
    expect(container.querySelector('thead')?.getAttribute('role')).toBe('rowgroup');
    expect(container.querySelector('tbody')?.getAttribute('role')).toBe('rowgroup');
    expect(container.querySelector('tbody tr')?.getAttribute('role')).toBe('row');
    expect(container.querySelector('tbody td')?.getAttribute('role')).toBe('cell');
    expect(container.querySelector('thead th')?.getAttribute('role')).toBe('columnheader');
  });

  it('keeps the header row in the accessibility tree at every width', () => {
    render(<Table caption="רשימת אנשים" columns={columns} rows={rows} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['שם', 'דמי קאמפ', 'יתרה']);
    expect(headers[0].getAttribute('scope')).toBe('col');
  });

  /**
   * The header row is *clipped*, never `display: none`: a phone that drops the
   * header out of the accessibility tree leaves every cell in every card with
   * no column name, which is the one thing E4 asks a reflowed table for. The
   * clip is what the `data-label` above is the visible counterpart of.
   */
  it('clips the header on a phone rather than removing it', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/ui/table.module.css'), 'utf8');
    const phone = css.slice(css.indexOf('@media (max-width: 767.98px)'));
    expect(phone).toContain('clip-path: inset(50%)');
    expect(phone).not.toMatch(/thead\s*\{[^}]*display:\s*none/);
  });
});
