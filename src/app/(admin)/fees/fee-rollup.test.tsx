/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SeasonFeeSummary, UnpaidMember } from '@/lib/fees/summary';
import { FeeRollup, missingDuesSentence } from './fee-rollup';

const SEASON = '8f2b1c4e-0000-4000-8000-000000000001';

/**
 * A6 widened `SeasonFeeSummary` with `unpaid`, and this literal is exactly the
 * one the ledger flagged as no longer typechecking. `FeeRollup` never reads it
 * — the נותר tile's two counts come from `viewCounts`, over the same rows the
 * table renders — but a fixture that contradicted `unpaidCount: 12` would be a
 * lie waiting to be copied into the next test, so the twelve are generated.
 */
const NAMES = ['איתי כהן', 'עומר ביטון', 'שירה אברהם', 'רוני אדלר'];
const UNPAID: UnpaidMember[] = Array.from({ length: 12 }, (_, index) => ({
  personId: `p-unpaid-${index}`,
  displayName: NAMES[index % NAMES.length],
  dueId: `d-${index}`,
  kind: 'flat',
  amountAgorot: 120000,
  paidAgorot: 0,
  outstandingAgorot: 120000,
}));

const SUMMARY: SeasonFeeSummary = {
  seasonId: SEASON, seasonName: 'ברן 26', flatRateAgorot: 120000,
  memberCount: 35, flatCount: 28, exceptionCount: 5,
  expectedAgorot: 3650000, collectedAgorot: 2430000, outstandingAgorot: 1220000,
  unpaidCount: 12, missingDues: ['ליאור קפלן', 'תמר גולן'],
  offsetAgorot: 600000, offsetPersonCount: 5, unattributedAgorot: 0,
  unpaid: UNPAID,
};

const COUNTS = {
  all: 35, unpaid: 9, partial: 3, paid: 21, exception: 5, offset: 5, nodue: 2,
};

function renderRollup() {
  return render(
    <FeeRollup summary={SUMMARY} counts={COUNTS} seasonId={SEASON} view="all" />,
  );
}

/**
 * A tile's accessible name is its whole contents — label, value, bar name and
 * derivation — so the plan's `/^נגבה$/` could never match one. Going from the
 * label's own text node to the link that encloses it is exact where the name
 * regex was not: `getByText` defaults to an exact match, so `נגבה` finds the
 * second tile and never `נגבה בקיזוז`.
 */
const tileHref = (label: string) =>
  screen.getByText(label).closest('a')?.getAttribute('href');

describe('FeeRollup', () => {
  it('shows the four figures a lead opens this screen for', () => {
    renderRollup();
    expect(screen.getByText('צפי גבייה')).toBeDefined();
    expect(screen.getByText('נגבה')).toBeDefined();
    expect(screen.getByText('נותר לגבות')).toBeDefined();
    expect(screen.getByText('נגבה בקיזוז')).toBeDefined();
  });

  it('links each tile to the view it filters', () => {
    renderRollup();
    expect(tileHref('צפי גבייה')).toBe(`/fees?season=${SEASON}`);
    expect(tileHref('נגבה בקיזוז')).toBe(`/fees?season=${SEASON}&view=offset`);
    expect(tileHref('נותר לגבות')).toBe(`/fees?season=${SEASON}&view=unpaid`);
    expect(tileHref('נגבה')).toBe(`/fees?season=${SEASON}&view=paid`);
  });

  it('explains every number rather than stating it bare', () => {
    renderRollup();
    expect(screen.getByText(/בתעריף רגיל/).textContent).toBe('28 בתעריף רגיל · 5 חריגים');
    expect(screen.getByText(/67%/)).toBeDefined();
    expect(screen.getByText(/קיזזו מול חוב/).textContent)
      .toBe('5 חברים קיזזו מול חוב שהקאמפ חייב להם');
  });

  it('names both halves of the outstanding total, since one link cannot', () => {
    renderRollup();
    const tile = screen.getByRole('link', { name: /נותר לגבות/ });
    expect(tile.textContent).toContain('9 טרם שילמו');
    expect(tile.textContent).toContain('3 שילמו חלקית');
  });

  it('does not divide by zero on a season that has issued nothing', () => {
    render(<FeeRollup
      summary={{ ...SUMMARY, expectedAgorot: 0, collectedAgorot: 0, outstandingAgorot: 0 }}
      counts={{ ...COUNTS, all: 0 }} seasonId={SEASON} view="all"
    />);
    expect(screen.getByText(/0%/)).toBeDefined();
  });
});

/**
 * I12. The plan's copy read `חבר אחד ברשימת {season} עדיין בלי חיוב כלל.` —
 * a masculine singular noun for a person of unknown gender, which `persons`
 * does not record. The sentence is now about the חיוב that was never issued,
 * which is what the banner is actually reporting and what its button acts on.
 *
 * Watch it fail by restoring the plan's own wording: `חבר אחד ברשימת …`.
 */
describe('missingDuesSentence', () => {
  it('says how many dues were never issued, without inventing a gender', () => {
    expect(missingDuesSentence(1, 'ברן 26'))
      .toBe('חיוב אחד ברשימת ברן 26 עדיין לא הונפק, ולכן הוא חסר מצפי הגבייה.');
    expect(missingDuesSentence(4, 'ברן 26'))
      .toBe('4 חיובים ברשימת ברן 26 עדיין לא הונפקו, ולכן הם חסרים מצפי הגבייה.');
  });

  it('names no person and no gendered noun, at either count', () => {
    for (const count of [1, 4]) {
      expect(missingDuesSentence(count, 'ברן 26'))
        .not.toMatch(/חבר |חברה |חבר\b|שילמה|שילם |פטורה|הוביל |החליט /);
    }
  });
});
