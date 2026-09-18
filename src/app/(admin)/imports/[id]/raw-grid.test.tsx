/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { GridRow } from '@/lib/import/review';
import { RawGrid } from './raw-grid';

const rows: GridRow[] = [
  { sheetRow: 3, cells: ['תאריך', 'פירוט', 'יצא', 'נכנס'], state: 'header', message: null },
  { sheetRow: 4, cells: ['05/07/26', 'תשלום גנרטור', '4200', ''], state: 'written', message: null },
  { sheetRow: 5, cells: ['14/07/26', 'נועה ל.', '', '1200'], state: 'noted',
    message: 'השם ״נועה ל.״ לא זוהה — נשמר כטקסט וממתין לקישור' },
  { sheetRow: 6, cells: ['', 'סה״כ', '6700', '4700'], state: 'refused',
    message: 'שורת סה״כ היא סכום מחושב, לא תנועה' },
];

function renderGrid(filter: 'all' | 'written' | 'refused' = 'all') {
  return render(
    <RawGrid uploadId="u1" blockId="b1" left={1} rows={rows} filter={filter} />,
  );
}

describe('RawGrid', () => {
  it('heads each column with its Excel letter', () => {
    renderGrid();
    const head = screen.getAllByRole('row')[0];
    expect(within(head).getByText('A').tagName).toBe('BDI');
    expect(within(head).getByText('D').tagName).toBe('BDI');
  });

  /** W3: the absolute sheet row is what a trace renders and what a lead types
   *  into Excel's name box. The index within the block is never shown. */
  it('numbers each row by its absolute position in the sheet', () => {
    renderGrid();
    expect(screen.getByText('4').tagName).toBe('BDI');
    expect(screen.getByText('6').tagName).toBe('BDI');
  });

  /** This screen shows refusals; it does not word them. Every sentence here
   *  is the promoter's own, from `Refusal.message`. */
  it('shows the refusal in place, in the promoter’s own words', () => {
    renderGrid();
    expect(screen.getByText('לא נכתב: שורת סה״כ היא סכום מחושב, לא תנועה')).toBeTruthy();
  });

  /**
   * Every noted row links, and none of them is sniffed to decide which kind
   * of note it is. A note can be an unrecognised name, a dateless debt or a
   * flagged arithmetic line, and reading the Hebrew to route the link would
   * be a second, weaker copy of a classification the promoter already made.
   */
  it('marks a row written with a note and sends it to לטיפול', () => {
    renderGrid();
    expect(screen.getByText(
      /נכתב עם הערה: השם ״נועה ל.״ לא זוהה — נשמר כטקסט וממתין לקישור/,
    )).toBeTruthy();
    expect(screen.getByRole('link', { name: 'לטיפול' }).getAttribute('href'))
      .toBe('/inbox');
  });

  it('counts each filter on its own control', () => {
    renderGrid();
    expect(screen.getByRole('link', { name: /הכול/ }).textContent).toContain('3');
    expect(screen.getByRole('link', { name: /ייכתבו/ }).textContent).toContain('2');
    expect(screen.getByRole('link', { name: /נדחו/ }).textContent).toContain('1');
  });

  /** R6: the filter is a URL, so the grid stays a Server Component and a
   *  59-row table never ships to the browser as client state. */
  it('keeps the open block when the filter changes', () => {
    renderGrid();
    expect(screen.getByRole('link', { name: /נדחו/ }).getAttribute('href'))
      .toBe('/imports/u1?block=b1&rows=refused');
    expect(screen.getByRole('link', { name: /הכול/ }).getAttribute('href'))
      .toBe('/imports/u1?block=b1');
  });

  it('shows only the refused rows under נדחו, and keeps the header', () => {
    renderGrid('refused');
    expect(screen.queryByText('תשלום גנרטור')).toBeNull();
    expect(screen.getByText('סה״כ')).toBeTruthy();
    expect(screen.getByText('תאריך')).toBeTruthy();
  });

  it('shows written and noted rows together under ייכתבו', () => {
    renderGrid('written');
    expect(screen.getByText('תשלום גנרטור')).toBeTruthy();
    expect(screen.getByText('נועה ל.')).toBeTruthy();
    expect(screen.queryByText('סה״כ')).toBeNull();
  });

  it('celebrates rather than apologising when nothing was refused', () => {
    render(
      <RawGrid uploadId="u1" blockId="b1" left={1} filter="refused"
        rows={[rows[0], rows[1]]} />,
    );
    expect(screen.getByText('אף שורה לא נדחתה')).toBeTruthy();
  });

  it('says a filter is empty without calling it good news', () => {
    render(
      <RawGrid uploadId="u1" blockId="b1" left={1} filter="written"
        rows={[rows[0], rows[3]]} />,
    );
    expect(screen.getByText('אין שורות בתצוגה הזו')).toBeTruthy();
    expect(screen.queryByText('אף שורה לא נדחתה')).toBeNull();
  });
});
