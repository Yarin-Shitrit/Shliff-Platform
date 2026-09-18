/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { EMPTY_TITLES, emptyStateBody } from '@/components/ui/empty-state';
import { render, screen, within } from '@testing-library/react';
import type { ObligationRow } from '@/lib/money/obligations';
import type { SourceCell } from '@/lib/money/trace';
import { sourceKey } from '@/lib/money/overview';
import { ObligationsTable } from './obligations-table';

function row(overrides: Partial<ObligationRow> = {}): ObligationRow {
  return {
    id: 'o1', direction: 'camp_owes', partyPersonId: 'p1', partyName: null,
    displayParty: 'אורי', description: 'החזר על קרח', amountAgorot: 30000,
    settledAgorot: 0, outstandingAgorot: 30000, settled: false, unnamed: false,
    openedOn: null,
    seasonId: 's1', sourceBlockId: null, sourceRow: null, settlements: [],
    ...overrides,
  };
}

const cell: SourceCell = {
  blockId: 'b1', sheetId: 'sh1', sheetName: 'סיכום כללי', filename: 'קופת קאמפ 25.xlsx',
  sheetRow: 31, reference: 'סיכום כללי!A31',
};

describe('ObligationsTable', () => {
  // The bug this component exists to fix: `למי` headed both tables, so a
  // reader of the right-hand table was told the camp owed the money it was
  // owed. The header is derived from `direction` inside the component, so a
  // caller cannot put it back.
  it('heads the party column למי when the camp owes, and ממי when it is owed', () => {
    const { unmount } = render(
      <ObligationsTable direction="camp_owes" rows={[row()]} sources={new Map()} scope="?season=s1" />,
    );
    expect(screen.getByRole('columnheader', { name: 'למי' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'ממי' })).toBeNull();
    unmount();

    render(
      <ObligationsTable direction="owed_to_camp" rows={[row({ direction: 'owed_to_camp' })]}
                        sources={new Map()} scope="?season=s1" />,
    );
    expect(screen.getByRole('columnheader', { name: 'ממי' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'למי' })).toBeNull();
  });

  it('links a named party to their page and the debt to its drawer', () => {
    render(<ObligationsTable direction="camp_owes" rows={[row()]} sources={new Map()} scope="?season=s1" />);
    expect(screen.getByRole('link', { name: 'אורי' }).getAttribute('href')).toBe('/members/p1');
    expect(screen.getByRole('link', { name: 'החזר על קרח' }).getAttribute('href'))
      .toBe('/money/debts?season=s1&peek=o1');
  });

  it('names an unlinked party without inventing a link to a person who has no page', () => {
    render(<ObligationsTable direction="camp_owes" sources={new Map()} scope="?season=s1"
                             rows={[row({ partyPersonId: null, partyName: 'דנה', displayParty: 'דנה' })]} />);
    expect(screen.getByText('דנה')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'דנה' })).toBeNull();
  });

  it('refuses a party for an unnamed debt and says so in a word', () => {
    render(<ObligationsTable direction="camp_owes" sources={new Map()} scope="?season=s1"
                             rows={[row({ id: 'o2', displayParty: null, partyPersonId: null, unnamed: true,
                                          description: 'מקפיא באיחסון נוסף', amountAgorot: 50000,
                                          outstandingAgorot: 50000 })]} />);
    expect(screen.getByText('חסר שם')).toBeTruthy();
  });

  it('shows the workbook cell a debt came from, and נרשם ידנית when there is none', () => {
    const sources = new Map([[sourceKey('obligations', 'o1'), cell]]);
    render(<ObligationsTable direction="camp_owes" sources={sources} scope="?season=s1"
                             rows={[row(), row({ id: 'o3', description: 'החזר לטלי' })]} />);
    expect(screen.getByText('סיכום כללי!A31')).toBeTruthy();
    expect(screen.getByText('נרשם ידנית')).toBeTruthy();
  });

  it('shows what is outstanding, not the original amount, on a partly settled debt', () => {
    render(<ObligationsTable direction="camp_owes" sources={new Map()} scope="?season=s1"
                             rows={[row({ amountAgorot: 1524000, settledAgorot: 1433000,
                                          outstandingAgorot: 91000 })]} />);
    // Scoped to the body: with one row the footer carries the same 910, so a
    // whole-table query finds two and discriminates nothing.
    const body = screen.getByRole('table').querySelector('tbody')!;
    expect(within(body).getByText(/910/)).toBeTruthy();
    expect(within(body).queryByText(/15,240/)).toBeNull();
  });

  it('foots with the count and the sum of what is still open', () => {
    render(<ObligationsTable direction="camp_owes" sources={new Map()} scope="?season=s1"
                             rows={[row({ outstandingAgorot: 91000 }),
                                    row({ id: 'o4', outstandingAgorot: 124000 })]} />);
    const foot = screen.getByRole('table').querySelector('tfoot')!;
    expect(foot.textContent).toContain('2 חובות');
    expect(foot.textContent).toContain('2,150');
  });

  // The settlement chain — `חוב יוסף → 6,000 → five ברן 26 dues` — belongs on
  // /money/debts (D8), which has the room to show it as one visible chain.
  // Two tables side by side at 1440px cannot carry six columns each.
  it('leaves the original amount and the קוזז meter to the debts screen', () => {
    render(<ObligationsTable direction="camp_owes" sources={new Map()} scope="?season=s1"
                             rows={[row({ amountAgorot: 1524000, settledAgorot: 1433000,
                                          outstandingAgorot: 91000 })]} />);
    expect(screen.queryByRole('columnheader', { name: 'סכום' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'קוזז' })).toBeNull();
  });
});

/**
 * E1: an empty state is an invitation, not an apology — and never silence.
 *
 * With no rows this drew an empty table body under a totals row reading
 * `0 חובות` and `0 ₪`. Two zeroes and a blank space is the one shape the
 * platform's own rules forbid twice over: a figure that would always read
 * zero is not drawn, and an empty list says what kind of empty it is. Owing
 * nobody is the good outcome, so it says so.
 */
describe('ObligationsTable when there is nothing owed', () => {
  it('says the direction is clear rather than drawing an empty grid', () => {
    render(
      <ObligationsTable
        direction="camp_owes"
        rows={[]}
        sources={new Map()}
        scope="?season=s26"
      />,
    );
    /*
     * The kit owns the copy (C10), so this asserts the kind rather than a
     * sentence this file would otherwise be a second copy of.
     *
     * Not asserted: that the empty state is announced. The kit renders a
     * heading in a plain div, with no `role="status"`, so an empty state
     * arriving after a filter change is silent to a screen reader. That is a
     * real kit gap and it is reported rather than patched here — asserting it
     * from a screen test would be pinning a behaviour this file cannot give.
     */
    expect(screen.getByRole('heading', { name: EMPTY_TITLES['all-clear'] })).toBeTruthy();
    expect(screen.getByText(emptyStateBody({ kind: 'all-clear' }))).toBeTruthy();
  });

  it('draws no totals row of zeroes under it', () => {
    render(
      <ObligationsTable
        direction="owed_to_camp"
        rows={[]}
        sources={new Map()}
        scope="?season=s26"
      />,
    );
    expect(screen.queryByText('0 חובות')).toBeNull();
  });
});
