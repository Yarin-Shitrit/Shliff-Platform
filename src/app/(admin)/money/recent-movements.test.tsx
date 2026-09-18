/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { Movement } from '@/lib/money/ledger';
import type { SourceCell } from '@/lib/money/trace';
import { sourceKey } from '@/lib/money/overview';
import { RecentMovements } from './recent-movements';

function move(overrides: Partial<Movement> = {}): Movement {
  return {
    id: 'm1', source: 'ledger', occurredOn: new Date('2026-09-12T00:00:00Z'),
    direction: 'in', amountAgorot: 1850000, description: 'מסיבת גיוס — אוקטובר',
    accountId: 'a1', accountName: 'קופת מסיבות', seasonId: 's1', eventId: null,
    transferGroupId: null, sourceBlockId: 'b1', sourceRow: 41,
    ...overrides,
  };
}

const sources = new Map<string, SourceCell>([[sourceKey('ledger_entries', 'm1'), {
  blockId: 'b1', sheetId: 'sh1', sheetName: 'תנועות קופה',
  filename: 'קופת קאמפ 2026.xlsx', sheetRow: 41, reference: 'תנועות קופה!A41',
}]]);

describe('RecentMovements', () => {
  it('puts an amount in the column that matches its direction, and dashes the other', () => {
    render(<RecentMovements rows={[move(), move({ id: 'm2', direction: 'out', amountAgorot: 4130000,
                                                  description: 'שכירות גנרטור', sourceBlockId: null,
                                                  sourceRow: null })]}
                            total={31} sources={sources} scope="?season=s1" seasonName="ברן 26" />);
    const rows = screen.getAllByRole('row');
    const incoming = rows.find((row) => row.textContent?.includes('מסיבת גיוס'))!;
    // Columns: תאריך(0) תיאור(1) חשבון(2) נכנס(3) יצא(4) מקור(5). Checking
    // the row as a whole would pass with the amount in either column.
    expect(within(incoming).getAllByRole('cell')[3].textContent).toContain('18,500');
    expect(within(incoming).getAllByRole('cell')[4].textContent).toBe('—');
  });

  it('shows the date as DD/MM/YY with slashes, the way Excel and the banks do', () => {
    render(<RecentMovements rows={[move()]} total={1} sources={sources}
                            scope="?season=s1" seasonName="ברן 26" />);
    expect(screen.getByText('12/09/26')).toBeTruthy();
  });

  it('says לא צוין in a word when a movement names no account', () => {
    render(<RecentMovements rows={[move({ accountId: null, accountName: null })]}
                            total={1} sources={sources} scope="?season=s1" seasonName="ברן 26" />);
    expect(screen.getByText('לא צוין')).toBeTruthy();
  });

  it('traces a promoted movement to its cell and calls a dues payment what it is', () => {
    render(<RecentMovements total={2} sources={sources} scope="?season=s1" seasonName="ברן 26"
                            rows={[move(), move({ id: 'm3', source: 'dues',
                                                  description: 'דמי קאמפ — יונתן מזרחי',
                                                  sourceBlockId: null, sourceRow: null })]} />);
    expect(screen.getByText('תנועות קופה!A41')).toBeTruthy();
    expect(screen.getByText('נרשם ידנית')).toBeTruthy();
  });

  // `payments` has no provenance columns, so a dues payment can never resolve
  // to a cell. A lookup keyed only on the id would find the ledger entry that
  // happens to share it and claim a workbook row that is not this row's.
  it('never borrows a ledger entry\'s cell for a dues payment of the same id', () => {
    render(<RecentMovements total={1} sources={sources} scope="?season=s1" seasonName="ברן 26"
                            rows={[move({ source: 'dues', description: 'דמי קאמפ — יונתן מזרחי' })]} />);
    expect(screen.queryByText('תנועות קופה!A41')).toBeNull();
    expect(screen.getByText('נרשם ידנית')).toBeTruthy();
  });

  it('carries the reader on to the whole ledger, with its count', () => {
    render(<RecentMovements rows={[move()]} total={31} sources={sources}
                            scope="?season=s1" seasonName="ברן 26" />);
    const link = screen.getByRole('link', { name: /לכל 31 התנועות/ });
    expect(link.getAttribute('href')).toBe('/money/ledger?season=s1');
  });

  it('never draws a running balance, which five rows across accounts cannot support', () => {
    render(<RecentMovements rows={[move()]} total={1} sources={sources}
                            scope="?season=s1" seasonName="ברן 26" />);
    expect(screen.queryByRole('columnheader', { name: 'יתרה' })).toBeNull();
  });

  it('invites an import instead of an empty table for a season with no movements', () => {
    render(<RecentMovements rows={[]} total={0} sources={new Map()}
                            scope="?season=s1" seasonName="ברן 26" />);
    // The kit owns the sentence (C10); the screen supplies the noun and the
    // season.
    expect(screen.getByText(/אין תנועות בברן 26/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('link', { name: 'לדף הייבוא' }).getAttribute('href')).toBe('/upload');
  });
});
