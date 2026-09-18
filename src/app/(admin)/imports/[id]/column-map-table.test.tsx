/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ColumnRow } from '@/lib/import/review';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import { ColumnMapTable } from './column-map-table';

/** Already in `columnRows`' own order: unsure first, whatever the workbook's. */
const rows: ColumnRow[] = [
  { column: 6, label: 'F', header: 'הערות', samples: ['שילם בביט', 'לבדוק מול שירה'],
    field: null, confidence: null },
  { column: 2, label: 'B', header: 'פירוט', samples: ['תשלום גנרטור', 'קניות מטבח', 'דלק'],
    field: 'description', confidence: 0.8 },
  { column: 1, label: 'A', header: 'תאריך', samples: ['05/07/26', '08/07/26', '11/07/26'],
    field: 'date', confidence: 1 },
];

function renderTable(draft: ColumnMapping[] = [
  { column: 2, field: 'description', confidence: 0.8 },
  { column: 1, field: 'date', confidence: 1 },
]) {
  const onDraftChange = vi.fn();
  render(
    <ColumnMapTable
      blockId="b1" archetype="ledger" rows={rows}
      draft={draft} onDraftChange={onDraftChange}
    />,
  );
  return onDraftChange;
}

describe('ColumnMapTable', () => {
  /**
   * R11: the A1 letter is what keeps the reordering below safe.
   *
   * Scoped to the first cell, because the row carries the letter twice — once
   * visibly beside the header, once inside the select's own screen-reader
   * label. An unscoped `getByText('A')` matches both and throws.
   */
  it('shows the file’s header with its Excel letter', () => {
    renderTable();
    const row = screen.getByRole('row', { name: /תאריך/ });
    const cell = within(row).getAllByRole('cell')[0];
    expect(within(cell).getByText('A').tagName).toBe('BDI');
    expect(within(cell).getByText('תאריך')).toBeTruthy();
  });

  it('shows three sample values from the column', () => {
    renderTable();
    const row = screen.getByRole('row', { name: /פירוט/ });
    expect(row.textContent).toContain('תשלום גנרטור');
    expect(row.textContent).toContain('קניות מטבח');
    expect(row.textContent).toContain('דלק');
  });

  it('names the target field in Hebrew rather than as an identifier', () => {
    renderTable();
    expect(screen.getByDisplayValue('תאריך התנועה')).toBeTruthy();
    expect(screen.queryByText('A → date')).toBeNull();
  });

  it('gives confidence a word and never a percentage', () => {
    renderTable();
    expect(screen.getAllByText(/^(בטוח|כנראה|לא בטוח)$/).length).toBe(3);
    expect(screen.queryByText(/%/)).toBeNull();
  });

  /**
   * The order is `columnRows`' and this component must not re-impose the
   * workbook's. Sorting by column here would silently bury the row the screen
   * exists to surface — the one the system has least to say about.
   */
  it('keeps the unsure row first, whatever its place in the workbook', () => {
    renderTable();
    const headers = screen.getAllByRole('row').slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(headers).toEqual(['הערותF', 'פירוטB', 'תאריךA']);
  });

  it('shows an unmapped column as not imported, with its toggle already on', () => {
    renderTable();
    const toggle = screen.getByRole('button', { name: 'לא לייבא את עמודה F' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByDisplayValue('לא מיובא')).toBeTruthy();
  });

  it('removes a column from the draft when לא לייבא is switched on', () => {
    const onDraftChange = renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'לא לייבא את עמודה A' }));
    expect(onDraftChange).toHaveBeenCalledWith([
      { column: 2, field: 'description', confidence: 0.8 },
    ]);
  });

  /** A field a lead chose by hand is a statement, not a guess — the same
   *  confidence `mapColumns` gives an exact header match. */
  it('adds a column to the draft when a field is chosen for it', () => {
    const onDraftChange = renderTable();
    fireEvent.change(screen.getByLabelText('השדה של עמודה F'), {
      target: { value: 'description' },
    });
    expect(onDraftChange).toHaveBeenCalledWith(expect.arrayContaining([
      { column: 6, field: 'description', confidence: 1 },
    ]));
  });

  /**
   * Switching the exclusion off on a column nothing mapped has to put some
   * field in the select, and there is no right answer to infer. It offers the
   * first field as a visible starting point in an unsaved draft — never a
   * stored guess, and the lead sees exactly what they would be saving.
   */
  it('puts a visible field in the select when an exclusion is switched off', () => {
    const onDraftChange = renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'לא לייבא את עמודה F' }));
    expect(onDraftChange).toHaveBeenCalledWith(expect.arrayContaining([
      { column: 6, field: 'date', confidence: 1 },
    ]));
  });

  it('says what an unmapped column costs, so it reads as a choice', () => {
    renderTable();
    expect(screen.getByText(
      'עמודה שלא מופתה לא נכתבת — היא נשארת בגיליון ואפשר לחזור אליה.',
    )).toBeTruthy();
  });

  it('gives the table a caption rather than five bare columns', () => {
    renderTable();
    expect(screen.getByRole('table', { name: 'התאמת העמודות' })).toBeTruthy();
  });
});
